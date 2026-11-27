package com.bushmeshmain.radio

import android.os.Debug
import android.os.Process
import android.os.SystemClock
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.vosk.Model
import org.vosk.Recognizer
import java.io.Closeable
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import kotlin.math.min

/**
 * Genuine, file-fed, offline streaming decoder candidate. Compiled only into
 * the opt-in evaluation instrumentation APK. No microphone or network APIs;
 * no wake event emitter and no capability activation in the shipping app.
 */
internal class VoskWakePcmDecoder(
  model: Model,
  constrainedGrammar: Boolean
) : Closeable {
  private val recognizer = if (constrainedGrammar)
    Recognizer(model, 16000f, """["hey bush mesh","[unk]"]""")
  else Recognizer(model, 16000f)

  init { recognizer.setWords(true) }

  /** Endpoint only; a partial or forced EOF must never trigger a command. */
  fun accept(frame: ShortArray, count: Int): Boolean {
    require(count in 1..frame.size && count <= 3200)
    if (!recognizer.acceptWaveForm(frame, count)) return false
    return qualifies(JSONObject(recognizer.result))
  }

  override fun close() { recognizer.close() }

  companion object {
    internal fun qualifies(result: JSONObject): Boolean {
      val text = result.optString("text", "").trim().split(Regex("\\s+"))
      if (text != listOf("hey", "bush", "mesh") && text != listOf("hey", "bushmesh")) return false
      val words = result.optJSONArray("result") ?: return false
      if (words.length() != text.size) return false
      return text.indices.all { index ->
        val word = words.optJSONObject(index) ?: return@all false
        val confidence = word.opt("conf") as? Number ?: return@all false
        word.optString("word") == text[index] &&
          confidence.toDouble().isFinite() && confidence.toDouble() in 0.85..1.0
      }
    }
  }
}

class WakeAudioQualificationTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val assets = instrumentation.context.assets

  private fun copyAssetTree(path: String, destination: File) {
    val children = assets.list(path).orEmpty()
    if (children.isEmpty()) {
      destination.parentFile?.mkdirs()
      assets.open(path).use { input -> destination.outputStream().use { input.copyTo(it) } }
    } else {
      destination.mkdirs()
      for (child in children) copyAssetTree("$path/$child", File(destination, child))
    }
  }

  private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256")
    .digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }

  private fun pcm(bytes: ByteArray): ShortArray {
    require(bytes.size in 44..1_920_044)
    val reader = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    fun tag() = ByteArray(4).also { reader.get(it) }.toString(Charsets.US_ASCII)
    require(tag() == "RIFF")
    require(reader.int == bytes.size - 8)
    require(tag() == "WAVE")
    var format = false
    while (reader.remaining() >= 8) {
      val kind = tag()
      val size = reader.int
      require(size >= 0 && size <= reader.remaining())
      val end = reader.position() + size
      when (kind) {
        "fmt " -> {
          require(size >= 16)
          require(reader.short.toInt() == 1) // PCM
          require(reader.short.toInt() == 1) // mono
          require(reader.int == 16000)
          require(reader.int == 32000)
          require(reader.short.toInt() == 2)
          require(reader.short.toInt() == 16)
          format = true
        }
        "data" -> {
          require(format && size > 0 && size % 2 == 0)
          return ShortArray(size / 2) { reader.short }
        }
      }
      require(end + (size % 2) <= bytes.size)
      reader.position(end + (size % 2))
    }
    error("Missing PCM data")
  }

  @Test fun actualOfflinePcmWakeAndHardNegatives() {
    val directory = File(instrumentation.targetContext.cacheDir, "wake-evaluation-model")
    directory.deleteRecursively()
    try {
      copyAssetTree("wake-model", directory)
      val modelBytes = directory.walkTopDown().filter { it.isFile }.sumOf { it.length() }
      val manifest = JSONArray(assets.open("wake-fixtures/manifest.json").bufferedReader().use { it.readText() })
      assertTrue(manifest.length() > 1)
      val loadStart = SystemClock.elapsedRealtime()
      Model(directory.absolutePath).use { model ->
        val loadMs = SystemClock.elapsedRealtime() - loadStart
        var anyPositive = false
        for (grammar in listOf(false, true)) {
          var positives = 0
          var misses = 0
          var falseActivations = 0
          var negatives = 0
          var durationSamples = 0L
          val cpuStart = Process.getElapsedCpuTime()
          val wallStart = SystemClock.elapsedRealtime()
          for (index in 0 until manifest.length()) {
            val row = manifest.getJSONObject(index)
            val file = row.getString("file")
            require(file.matches(Regex("[A-Za-z0-9_-]+\\.wav")))
            val bytes = assets.open("wake-fixtures/$file").use { it.readBytes() }
            assertEquals(row.getString("sha256"), sha(bytes))
            val data = pcm(bytes)
            durationSamples += data.size
            var detected = false
            VoskWakePcmDecoder(model, grammar).use { decoder ->
              var offset = 0
              while (offset < data.size) {
                val n = min(1600, data.size - offset)
                val frame = data.copyOfRange(offset, offset + n)
                if (decoder.accept(frame, n)) detected = true
                offset += n
              }
            }
            val expected = row.getBoolean("positive")
            when {
              expected && detected -> positives++
              expected -> misses++
              detected -> falseActivations++
              else -> negatives++
            }
          }
          anyPositive = anyPositive || positives > 0
          assertTrue(positives + misses > 0)
          assertTrue(falseActivations + negatives > 0)
          // Aggregate fixture metrics only. No decoded transcripts, recordings,
          // actual users' text or speech payloads are logged.
          Log.i("BushMeshWakeEval", "WAKE_AUDIO_EVAL mode=" +
            (if (grammar) "grammar" else "unconstrained") +
            " positives=$positives misses=$misses false=$falseActivations negatives=$negatives" +
            " samples=$durationSamples modelBytes=$modelBytes loadMs=$loadMs" +
            " cpuMs=${Process.getElapsedCpuTime() - cpuStart}" +
            " wallMs=${SystemClock.elapsedRealtime() - wallStart} pssKiB=${Debug.getPss()}")
        }
        assertTrue("No genuine positive audio endpoint recognized on Android", anyPositive)
      }
    } finally {
      directory.deleteRecursively()
    }
  }

  @Test fun confidenceAndEndpointPolicyRejectsUncertainOrSubstringEvidence() {
    fun result(text: String, words: List<String>, confidence: Double): JSONObject =
      JSONObject().put("text", text).put("result", JSONArray().apply {
        words.forEach { put(JSONObject().put("word", it).put("conf", confidence)) }
      })
    val words = listOf("hey", "bush", "mesh")
    assertTrue(VoskWakePcmDecoder.qualifies(result("hey bush mesh", words, 0.9)))
    assertFalse(VoskWakePcmDecoder.qualifies(result("hey bush mesh", words, 0.6)))
    assertFalse(VoskWakePcmDecoder.qualifies(result("hey bush mesh now", words + "now", 0.99)))
    assertFalse(VoskWakePcmDecoder.qualifies(JSONObject().put("partial", "hey bush mesh")))
    assertFalse(VoskWakePcmDecoder.qualifies(result("hey bush mesh", listOf("hey", "mesh"), 0.99)))
  }
}
