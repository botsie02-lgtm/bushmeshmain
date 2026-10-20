package com.bushmeshmain.radio

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Durable encrypted queue for Android Auto voice replies.
 *
 * A car reply is not removed until the foreground MeshCore session reports that
 * the companion radio accepted the channel message. This keeps Auto replies
 * truthful across radio outages and process death.
 */
class BushMeshCarReplyStore(context: Context) {
  data class Entry(
    val id: String,
    val channelIndex: Int,
    val channelName: String,
    val text: String,
    val createdAtMs: Long,
    val attempts: Int,
    val lastAttemptAtMs: Long?,
    val lastError: String?,
    val state: String,
  )

  companion object {
    const val STATE_QUEUED = "queued"
    const val STATE_BLOCKED = "blocked"

    private const val PREFS_NAME = "bushmesh_car_replies_v1"
    private const val STORE_KEY = "encrypted_replies"
    private const val KEY_ALIAS = "bushmesh_car_replies_aes_v1"
    private const val ENVELOPE_VERSION = "v1"
    private const val AAD = "bushmesh-car-replies-v1"
    private const val GCM_TAG_BITS = 128
    private const val MAX_ENTRIES = 64
    private const val MAX_TEXT_CHARS = 1024
    private const val MAX_CHANNEL_NAME_CHARS = 80
  }

  private val preferences = context.applicationContext.getSharedPreferences(
    PREFS_NAME,
    Context.MODE_PRIVATE,
  )

  @Synchronized
  fun enqueue(
    channelIndex: Int,
    channelName: String,
    text: String,
    createdAtMs: Long = System.currentTimeMillis(),
  ): Entry {
    require(channelIndex in 0..7) { "Bushmesh car reply channel must be 0..7." }
    require(createdAtMs >= 0L) { "Bushmesh car reply timestamp is invalid." }

    val cleanText = text.trim()
    require(cleanText.isNotEmpty()) { "Bushmesh car reply cannot be empty." }
    require(cleanText.length <= MAX_TEXT_CHARS) {
      "Bushmesh car reply is too large to persist safely."
    }

    val entry = Entry(
      id = UUID.randomUUID().toString(),
      channelIndex = channelIndex,
      channelName = channelName.trim().take(MAX_CHANNEL_NAME_CHARS),
      text = cleanText,
      createdAtMs = createdAtMs,
      attempts = 0,
      lastAttemptAtMs = null,
      lastError = null,
      state = STATE_QUEUED,
    )

    val entries = loadMutable()
    entries.add(entry)
    while (entries.size > MAX_ENTRIES) {
      entries.removeAt(0)
    }
    save(entries)
    return entry
  }

  @Synchronized
  fun listQueued(maxEntries: Int = MAX_ENTRIES): List<Entry> =
    loadMutable()
      .asSequence()
      .filter { it.state == STATE_QUEUED }
      .sortedBy { it.createdAtMs }
      .take(maxEntries.coerceIn(0, MAX_ENTRIES))
      .toList()

  @Synchronized
  fun listBlocked(maxEntries: Int = MAX_ENTRIES): List<Entry> =
    loadMutable()
      .asSequence()
      .filter { it.state == STATE_BLOCKED }
      .sortedByDescending { it.createdAtMs }
      .take(maxEntries.coerceIn(0, MAX_ENTRIES))
      .toList()

  @Synchronized
  fun markAttempt(id: String, error: String? = null): Boolean {
    val entries = loadMutable()
    val index = entries.indexOfFirst { it.id == id }
    if (index < 0) {
      return false
    }
    val current = entries[index]
    entries[index] = current.copy(
      attempts = current.attempts + 1,
      lastAttemptAtMs = System.currentTimeMillis(),
      lastError = error,
    )
    save(entries)
    return true
  }

  @Synchronized
  fun markBlocked(id: String, reason: String): Boolean {
    val entries = loadMutable()
    val index = entries.indexOfFirst { it.id == id }
    if (index < 0) {
      return false
    }
    val current = entries[index]
    entries[index] = current.copy(
      state = STATE_BLOCKED,
      lastAttemptAtMs = System.currentTimeMillis(),
      lastError = reason.trim().take(240),
    )
    save(entries)
    return true
  }

  @Synchronized
  fun acknowledge(id: String): Boolean {
    val entries = loadMutable()
    val changed = entries.removeAll { it.id == id }
    if (!changed) {
      return false
    }
    if (entries.isEmpty()) {
      preferences.edit().remove(STORE_KEY).commit()
    } else {
      save(entries)
    }
    return true
  }

  @Synchronized
  fun queuedCount(): Int = loadMutable().count { it.state == STATE_QUEUED }

  @Synchronized
  fun blockedCount(): Int = loadMutable().count { it.state == STATE_BLOCKED }

  private fun loadMutable(): MutableList<Entry> {
    val envelope = preferences.getString(STORE_KEY, null) ?: return mutableListOf()
    return try {
      val root = JSONObject(decrypt(envelope))
      if (root.optInt("version", -1) != 1) {
        return mutableListOf()
      }

      val array = root.optJSONArray("entries") ?: JSONArray()
      val result = mutableListOf<Entry>()
      for (index in 0 until array.length()) {
        val item = array.optJSONObject(index) ?: continue
        val id = item.optString("id", "")
        val channelIndex = item.optInt("channelIndex", -1)
        val channelName = item.optString("channelName", "")
        val text = item.optString("text", "").trim()
        val createdAtMs = item.optLong("createdAtMs", -1L)
        val attempts = item.optInt("attempts", 0).coerceAtLeast(0)
        val lastAttemptAtMs = if (item.isNull("lastAttemptAtMs")) {
          null
        } else {
          item.optLong("lastAttemptAtMs", -1L).takeIf { it >= 0L }
        }
        val lastError = if (item.isNull("lastError")) {
          null
        } else {
          item.optString("lastError", "").takeIf { it.isNotBlank() }
        }
        val state = item.optString("state", STATE_QUEUED)
          .takeIf { it == STATE_QUEUED || it == STATE_BLOCKED }
          ?: STATE_BLOCKED

        if (
          id.isBlank() ||
          channelIndex !in 0..7 ||
          text.isEmpty() ||
          text.length > MAX_TEXT_CHARS ||
          createdAtMs < 0L
        ) {
          continue
        }

        result.add(
          Entry(
            id = id,
            channelIndex = channelIndex,
            channelName = channelName.take(MAX_CHANNEL_NAME_CHARS),
            text = text,
            createdAtMs = createdAtMs,
            attempts = attempts,
            lastAttemptAtMs = lastAttemptAtMs,
            lastError = lastError,
            state = state,
          ),
        )
      }
      result.takeLast(MAX_ENTRIES).toMutableList()
    } catch (_: Exception) {
      preferences.edit().remove(STORE_KEY).commit()
      mutableListOf()
    }
  }

  private fun save(entries: List<Entry>) {
    val array = JSONArray()
    entries.takeLast(MAX_ENTRIES).forEach { entry ->
      array.put(
        JSONObject()
          .put("id", entry.id)
          .put("channelIndex", entry.channelIndex)
          .put("channelName", entry.channelName)
          .put("text", entry.text)
          .put("createdAtMs", entry.createdAtMs)
          .put("attempts", entry.attempts)
          .put("lastAttemptAtMs", entry.lastAttemptAtMs ?: JSONObject.NULL)
          .put("lastError", entry.lastError ?: JSONObject.NULL)
          .put("state", entry.state),
      )
    }

    val root = JSONObject()
      .put("version", 1)
      .put("entries", array)
    val committed = preferences.edit()
      .putString(STORE_KEY, encrypt(root.toString()))
      .commit()
    if (!committed) {
      throw IllegalStateException("Bushmesh Android Auto reply queue could not be persisted.")
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
      throw IllegalStateException("Unsupported Bushmesh car reply envelope.")
    }
    val iv = Base64.decode(parts[1], Base64.NO_WRAP)
    val encrypted = Base64.decode(parts[2], Base64.NO_WRAP)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
    cipher.updateAAD(AAD.toByteArray(StandardCharsets.UTF_8))
    return String(cipher.doFinal(encrypted), StandardCharsets.UTF_8)
  }
}
