package com.bushmeshmain.radio

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Bounded encrypted inbox for ordinary MeshCore channel-text frames received
 * while React Native is absent.
 *
 * Entries use a stable SHA-256 frame ID and are listed non-destructively. The
 * foreground acknowledges IDs only after encrypted message history confirms a
 * durable insert, closing the process-death gap of a destructive drain.
 */
class BushMeshNativeChannelInboxStore(context: Context) {
  data class Entry(
    val id: String,
    val receivedAtMs: Long,
    val frame: ByteArray,
  )

  companion object {
    private const val PREFS_NAME = "bushmesh_native_channel_inbox_v1"
    private const val INBOX_KEY = "encrypted_frames"
    private const val KEY_ALIAS = "bushmesh_native_channel_inbox_aes_v1"
    private const val ENVELOPE_VERSION = "v1"
    private const val AAD = "bushmesh-native-channel-inbox-v1"
    private const val GCM_TAG_BITS = 128
    private const val MAX_ENTRIES = 128
    private const val MAX_FRAME_BYTES = 512
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

    val id = fingerprint(frame)
    val entries = loadMutable()
    if (entries.any { it.id == id }) {
      return
    }

    entries.add(Entry(id, receivedAtMs, frame.copyOf()))
    while (entries.size > MAX_ENTRIES) {
      entries.removeAt(0)
    }
    save(entries)
  }

  @Synchronized
  fun list(maxEntries: Int = MAX_ENTRIES): List<Entry> {
    val entries = loadMutable()
    val count = maxEntries.coerceIn(0, MAX_ENTRIES).coerceAtMost(entries.size)
    return entries
      .take(count)
      .map { Entry(it.id, it.receivedAtMs, it.frame.copyOf()) }
  }

  @Synchronized
  fun acknowledge(ids: Collection<String>): Int {
    if (ids.isEmpty()) {
      return 0
    }

    val acceptedIds = ids
      .asSequence()
      .map { it.trim().lowercase() }
      .filter { it.matches(Regex("^[0-9a-f]{64}$")) }
      .toSet()
    if (acceptedIds.isEmpty()) {
      return 0
    }

    val entries = loadMutable()
    val originalSize = entries.size
    entries.removeAll { acceptedIds.contains(it.id) }
    val removed = originalSize - entries.size
    if (removed == 0) {
      return 0
    }

    if (entries.isEmpty()) {
      val committed = preferences.edit().remove(INBOX_KEY).commit()
      if (!committed) {
        throw IllegalStateException("Bushmesh native channel inbox could not be cleared.")
      }
    } else {
      save(entries)
    }
    return removed
  }

  @Synchronized
  fun size(): Int = loadMutable().size

  private fun loadMutable(): MutableList<Entry> {
    val envelope = preferences.getString(INBOX_KEY, null) ?: return mutableListOf()
    return try {
      val root = JSONObject(decrypt(envelope))
      if (root.optInt("version", -1) != 1) {
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

        // Older v1 entries did not persist an ID. Deriving it from the raw
        // frame migrates them in place without losing queued channel text.
        val derivedId = fingerprint(decoded)
        val storedId = item.optString("id", "").trim().lowercase()
        val id = storedId.takeIf {
          it.matches(Regex("^[0-9a-f]{64}$")) && it == derivedId
        } ?: derivedId

        if (result.none { it.id == id }) {
          result.add(Entry(id, receivedAtMs, decoded))
        }
      }
      result.takeLast(MAX_ENTRIES).toMutableList()
    } catch (_: Exception) {
      preferences.edit().remove(INBOX_KEY).commit()
      mutableListOf()
    }
  }

  private fun save(entries: List<Entry>) {
    val array = JSONArray()
    entries.takeLast(MAX_ENTRIES).forEach { entry ->
      array.put(
        JSONObject()
          .put("id", entry.id)
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
      throw IllegalStateException("Bushmesh native channel inbox could not be persisted.")
    }
  }

  private fun fingerprint(frame: ByteArray): String =
    MessageDigest
      .getInstance("SHA-256")
      .digest(frame)
      .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

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
      throw IllegalStateException("Unsupported Bushmesh native channel inbox envelope.")
    }

    val iv = Base64.decode(parts[1], Base64.NO_WRAP)
    val encrypted = Base64.decode(parts[2], Base64.NO_WRAP)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(
      Cipher.DECRYPT_MODE,
      getOrCreateKey(),
      GCMParameterSpec(GCM_TAG_BITS, iv),
    )
    cipher.updateAAD(AAD.toByteArray(StandardCharsets.UTF_8))
    return String(cipher.doFinal(encrypted), StandardCharsets.UTF_8)
  }
}