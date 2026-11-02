package com.bushmeshmain.radio

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Bounded encrypted inbox for Bushmesh datagrams received while JS is absent.
 *
 * It stores complete MeshCore 0x1B frames, not decoded domain objects. That lets
 * the foreground app replay them through the exact same parser/replay/TTL logic
 * used for live traffic, avoiding a second protocol implementation in Kotlin.
 */
class BushMeshNativeInboxStore(context: Context) {
  data class Entry(
    val receivedAtMs: Long,
    val frame: ByteArray,
  )

  companion object {
    private const val PREFS_NAME = "bushmesh_native_inbox_v1"
    private const val INBOX_KEY = "encrypted_frames"
    private const val KEY_ALIAS = "bushmesh_native_inbox_aes_v1"
    private const val ENVELOPE_VERSION = "v1"
    private const val AAD = "bushmesh-native-inbox-v1"
    private const val GCM_TAG_BITS = 128
    private const val MAX_ENTRIES = 128
    private const val MAX_FRAME_BYTES = 192
  }

  private val preferences = context.applicationContext.getSharedPreferences(
    PREFS_NAME,
    Context.MODE_PRIVATE,
  )

  @Synchronized
  fun append(frame: ByteArray, receivedAtMs: Long = System.currentTimeMillis()) {
    if (frame.isEmpty() || frame.size > MAX_FRAME_BYTES || receivedAtMs < 0L) {
      return
    }

    val entries = loadMutable()
    entries.add(Entry(receivedAtMs, frame.copyOf()))
    while (entries.size > MAX_ENTRIES) {
      entries.removeAt(0)
    }
    save(entries)
  }

  @Synchronized
  fun drain(maxEntries: Int = MAX_ENTRIES): List<Entry> {
    val entries = loadMutable()
    if (entries.isEmpty()) {
      return emptyList()
    }

    val count = maxEntries.coerceIn(0, MAX_ENTRIES).coerceAtMost(entries.size)
    val result = entries.take(count).map { Entry(it.receivedAtMs, it.frame.copyOf()) }
    val remaining = entries.drop(count)

    if (remaining.isEmpty()) {
      preferences.edit().remove(INBOX_KEY).commit()
    } else {
      save(remaining)
    }
    return result
  }

  @Synchronized
  fun size(): Int = loadMutable().size

  private fun loadMutable(): MutableList<Entry> {
    val envelope = preferences.getString(INBOX_KEY, null) ?: return mutableListOf()
    return try {
      val root = JSONObject(decrypt(envelope))
      val version = root.optInt("version", -1)
      if (version != 1) {
        return mutableListOf()
      }
      val array = root.optJSONArray("entries") ?: JSONArray()
      val result = mutableListOf<Entry>()
      for (index in 0 until array.length()) {
        val item = array.optJSONObject(index) ?: continue
        val receivedAtMs = item.optLong("receivedAtMs", -1L)
        val encoded = item.optString("frameBase64", "")
        if (receivedAtMs < 0L || encoded.isEmpty()) {
          continue
        }
        val decoded = try {
          Base64.decode(encoded, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
          continue
        }
        if (decoded.isEmpty() || decoded.size > MAX_FRAME_BYTES) {
          continue
        }
        result.add(Entry(receivedAtMs, decoded))
      }
      result.takeLast(MAX_ENTRIES).toMutableList()
    } catch (_: Exception) {
      // Corrupt background inbox data must never block the live radio path.
      preferences.edit().remove(INBOX_KEY).commit()
      mutableListOf()
    }
  }

  private fun save(entries: List<Entry>) {
    val array = JSONArray()
    entries.takeLast(MAX_ENTRIES).forEach { entry ->
      array.put(
        JSONObject()
          .put("receivedAtMs", entry.receivedAtMs)
          .put("frameBase64", Base64.encodeToString(entry.frame, Base64.NO_WRAP)),
      )
    }
    val root = JSONObject()
      .put("version", 1)
      .put("entries", array)
    val committed = preferences.edit()
      .putString(INBOX_KEY, encrypt(root.toString()))
      .commit()
    if (!committed) {
      throw IllegalStateException("Bushmesh native inbox could not be persisted.")
    }
  }

  private fun keyStore(): KeyStore =
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun getOrCreateKey(): SecretKey {
    val store = keyStore()
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

    val generator = KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES,
      "AndroidKeyStore",
    )
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  private fun encrypt(plainText: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    cipher.updateAAD(AAD.toByteArray(StandardCharsets.UTF_8))
    val encrypted = cipher.doFinal(plainText.toByteArray(StandardCharsets.UTF_8))
    return listOf(
      ENVELOPE_VERSION,
      Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
      Base64.encodeToString(encrypted, Base64.NO_WRAP),
    ).joinToString(":")
  }

  private fun decrypt(envelope: String): String {
    val parts = envelope.split(':', limit = 3)
    if (parts.size != 3 || parts[0] != ENVELOPE_VERSION) {
      throw IllegalStateException("Unsupported Bushmesh native inbox envelope.")
    }
    val iv = Base64.decode(parts[1], Base64.NO_WRAP)
    val encrypted = Base64.decode(parts[2], Base64.NO_WRAP)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
    cipher.updateAAD(AAD.toByteArray(StandardCharsets.UTF_8))
    return String(cipher.doFinal(encrypted), StandardCharsets.UTF_8)
  }
}
