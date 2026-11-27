package com.bushmeshmain.radio

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.facebook.react.bridge.*

/** A fresh recognizer per explicit turn. Stale callbacks never settle another
 * turn. No platform network recognizer, microphone service or automatic loop. */
class BushMeshSpeechRecognitionModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), LifecycleEventListener {
  private val main = Handler(Looper.getMainLooper())
  private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var engine: SpeechRecognizer? = null
  private var pending: Promise? = null
  private var focus: AudioFocusRequest? = null
  private var timeout: Runnable? = null
  private var generation = 0L
  private var resumed = context.lifecycleState == com.facebook.react.common.LifecycleState.RESUMED
  init { context.addLifecycleEventListener(this) }
  override fun getName() = "BushMeshSpeechRecognition"
  private fun supported() = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
  @ReactMethod fun getStatus(promise: Promise) {
    main.post {
      val available = runCatching { supported() }.getOrDefault(false)
      promise.resolve(Arguments.createMap().apply {
        putBoolean("supported", available)
        putBoolean("listening", pending != null)
        putDouble("apiLevel", Build.VERSION.SDK_INT.toDouble())
        putString("reason", if (available) null else "No on-device recognizer available.")
      })
    }
  }
  private fun release() {
    generation++
    pending = null
    timeout?.let { main.removeCallbacks(it) }; timeout = null
    val previous = engine; engine = null
    runCatching { previous?.cancel() }
    runCatching { previous?.destroy() }
    focus?.let { audio.abandonAudioFocusRequest(it) }; focus = null
    VoiceAudioOwnership.cancelRecognition = null
  }
  private fun fail(code: String, message: String) {
    val p = pending ?: return
    release()
    p.reject("BUSHMESH_STT_" + code, message)
  }
  @ReactMethod fun recognizeOnce(localeTag: String?, promise: Promise) {
    main.post {
      if (pending != null || VoiceAudioOwnership.cancelRecognition != null || VoiceAudioOwnership.speaking) {
        promise.reject("BUSHMESH_STT_BUSY", "Microphone or speech output is busy."); return@post
      }
      if (!resumed || context.currentActivity == null || context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        promise.reject("BUSHMESH_STT_PERMISSION", "Foreground microphone permission required."); return@post
      }
      pending = promise
      val turn = ++generation
      val started = android.os.SystemClock.elapsedRealtime()
      try {
        check(supported())
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
          .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
          .setOnAudioFocusChangeListener({ change ->
            if (change < 0 && generation == turn) fail("FOCUS", "Microphone audio focus lost.")
          }, main).build()
        focus = request
        check(audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
        VoiceAudioOwnership.cancelRecognition = { if (generation == turn) fail("INTERRUPTED", "Interrupted by critical speech.") }
        val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        engine = recognizer
        recognizer.setRecognitionListener(object : RecognitionListener {
          override fun onReadyForSpeech(params: Bundle?) = Unit
          override fun onBeginningOfSpeech() = Unit
          override fun onRmsChanged(rmsdB: Float) = Unit
          override fun onBufferReceived(buffer: ByteArray?) = Unit
          override fun onEndOfSpeech() = Unit
          override fun onPartialResults(partialResults: Bundle?) = Unit
          override fun onEvent(eventType: Int, params: Bundle?) = Unit
          override fun onError(error: Int) {
            if (generation == turn) fail("RECOGNITION", "On-device recognition unavailable or unsuccessful (code $error). Check offline language resources and retry.")
          }
          override fun onResults(results: Bundle?) {
            if (generation != turn) return
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()
            if (!resumed || context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || matches.isEmpty()) {
              fail("NO_MATCH", "No usable foreground recognition result."); return
            }
            val result = Arguments.createMap().apply {
              putString("text", matches.first())
              putDouble("confidence", results?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)?.firstOrNull()?.toDouble() ?: -1.0)
              putDouble("durationMs", (android.os.SystemClock.elapsedRealtime() - started).toDouble())
              putArray("alternatives", Arguments.createArray().apply { matches.drop(1).take(2).forEach { pushString(it) } })
            }
            val p = pending; release(); p?.resolve(result)
          }
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, localeTag ?: "en-AU")
          putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
          putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        }
        timeout = Runnable { if (generation == turn) fail("TIMEOUT", "Listening timed out.") }.also { main.postDelayed(it, 20_000) }
        recognizer.startListening(intent)
      } catch (_: Exception) { fail("START_FAILED", "On-device recognition could not start. Check language resources and audio focus.") }
    }
  }
  @ReactMethod fun stopListening(promise: Promise) {
    main.post { try { engine?.stopListening(); promise.resolve(pending != null) } catch (_: Exception) { fail("STOP_FAILED", "Recognition could not stop."); promise.resolve(false) } }
  }
  @ReactMethod fun cancel(promise: Promise) { main.post { fail("CANCELLED", "Recognition cancelled."); promise.resolve(true) } }
  override fun onHostResume() { main.post { resumed = true } }
  override fun onHostPause() { main.post { resumed = false; fail("SUSPENDED", "Recognition suspended.") } }
  override fun onHostDestroy() = onHostPause()
  override fun invalidate() { context.removeLifecycleEventListener(this); onHostPause(); super.invalidate() }
}
