package com.bushmeshmain.radio

import android.content.Context
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Native reader/writer for the same encrypted outbox envelope used by the
 * React Native persistence bridge.
 *
 * This class deliberately does not create or rotate keys while reading. A
 * missing/invalid key is surfaced to the caller so background radio code never
 * destroys a queue that the foreground app may still be able to diagnose.
 */
class BushMeshNativeOutboxStore(context: Context) {
  data class Entry(
    val id: String,
    val channelIndex: Int,
    val dataType: Int,
    val payload: ByteArray,
    val priority: String,
    val description: String,
    val identityRef: String?,
    val expiresAtMs: Long?,
    val createdAtMs: Long,
    val maxAttempts: Int,
    val attempts: Int,
    val state: String,
    val nextAttemptAtMs: Long,
    val lastError: String?,
    val acceptedAtMs: Long?,
  )

  data class Snapshot(
    val savedAtMs: Long,
    val entries: List<Entry>,
  )

  companion object {
    private const val STORE_NAME = "bushmesh_secure_runtime_v1"
    private const val OUTBOX_KEY = "encrypted_outbox_snapshot"
    private const val KEY_ALIAS = "bushmesh_outbox_aes_v1"
    private const val ENVELOPE_VERSION = "v1"
    private const val AAD = ENVELOPE_VERSION
    private const val GCM_TAG_BITS = 128
    private const val GCM_IV_BYTES = 12
    private const val SNAPSHOT_VERSION = 1
    private const val MAX_PAYLOAD_BYTES = 163

    private val PRIORITIES = setOf("safety", "control", "message", "position", "bulk")
    private val STATES = setOf("queued", "inflight", "accepted", "failed", "cancelled")
  }

  private val appContext = context.applicationContext
  private val preferences = appContext.getSharedPreferences(STORE_NAME, Context.MODE_PRIVATE)

  fun load(): Snapshot? {
    val envelope = preferences.getString(OUTBOX_KEY, null) ?: return null
    val serialized = decrypt(envelope)
    val root = JSONObject(serialized)

    if (root.optInt("version", -1) != SNAPSHOT_VERSION) {
      throw IllegalStateException("Unsupported Bushmesh native outbox snapshot version.")
    }

    val savedAtMs = requireNonNegativeLong(root, "savedAtMs", "outbox saved time")
    val jsonEntries = root.optJSONArray("entries")
      ?: throw IllegalStateException("Bushmesh native outbox entries are missing.")
    val entries = ArrayList<Entry>(jsonEntries.length())

    for (index in 0 until jsonEntries.length()) {
      val item = jsonEntries.optJSONObject(index)
        ?: throw IllegalStateException("Bushmesh native outbox entry $index is invalid.")
      entries.add(parseEntry(item))
    }

    return Snapshot(savedAtMs = savedAtMs, entries = entries)
  }

  /**
   * Returns only work that may still be transmitted. An entry that was in-flight
   * when the process died is recovered as queued, matching the JS snapshot
   * recovery semantics. Expired traffic is excluded and must never be sent late.
   */
  fun loadRecoverable(nowMs: Long = System.currentTimeMillis()): List<Entry> {
    require(nowMs >= 0L) { "Native outbox recovery time must be non-negative." }
    val snapshot = load() ?: return emptyList()

    return snapshot.entries.mapNotNull { entry ->
      if (entry.state != "queued" && entry.state != "inflight") {
        return@mapNotNull null
      }
      if (entry.expiresAtMs != null && nowMs >= entry.expiresAtMs) {
        return@mapNotNull null
      }
      if (entry.state == "inflight") {
        entry.copy(
          state = "queued",
          nextAttemptAtMs = nowMs,
          lastError = "Recovered by Android after restart while radio acceptance was unknown.",
        )
      } else {
        entry
      }
    }
  }

  fun saveActive(entries: List<Entry>, savedAtMs: Long = System.currentTimeMillis()) {
    require(savedAtMs >= 0L) { "Native outbox saved time must be non-negative." }

    val root = JSONObject()
      .put("version", SNAPSHOT_VERSION)
      .put("savedAtMs", savedAtMs)
    val jsonEntries = JSONArray()

    entries.forEach { entry ->
      validateEntry(entry)
      if (entry.state != "queued" && entry.state != "inflight") {
        return@forEach
      }

      jsonEntries.put(
        JSONObject()
          .put("id", entry.id)
          .put("channelIndex", entry.channelIndex)
          .put("dataType", entry.dataType)
          .put("payloadBase64", Base64.encodeToString(entry.payload, Base64.NO_WRAP))
          .put("priority", entry.priority)
          .put("description", entry.description)
          .putNullable("identityRef", entry.identityRef)
          .putNullable("expiresAtMs", entry.expiresAtMs)
          .put("createdAtMs", entry.createdAtMs)
          .put("maxAttempts", entry.maxAttempts)
          .put("attempts", entry.attempts)
          .put("state", entry.state)
          .put("nextAttemptAtMs", entry.nextAttemptAtMs)
          .putNullable("lastError", entry.lastError)
          .putNullable("acceptedAtMs", entry.acceptedAtMs),
      )
    }

    root.put("entries", jsonEntries)
    val envelope = encrypt(root.toString())
    if (!preferences.edit().putString(OUTBOX_KEY, envelope).commit()) {
      throw IllegalStateException("Android native outbox storage did not commit the snapshot.")
    }
  }

  fun clear() {
    if (!preferences.edit().remove(OUTBOX_KEY).commit()) {
      throw IllegalStateException("Android native outbox storage did not clear the snapshot.")
    }
  }

  private fun parseEntry(item: JSONObject): Entry {
    val id = item.optString("id", "").takeIf { it.isNotBlank() }
      ?: throw IllegalStateException("Bushmesh native outbox entry id is invalid.")
    val channelIndex = item.optInt("channelIndex", -1)
    val dataType = item.optInt("dataType", -1)
    val payloadBase64 = item.optString("payloadBase64", "")
    val payload = decodeCanonicalBase64(payloadBase64, id)
    val priority = item.optString("priority", "")
    val description = item.optString("description", "")
    val identityRef = item.optNullableString("identityRef")
    val expiresAtMs = item.optNullableLong("expiresAtMs")
    val createdAtMs = requireNonNegativeLong(item, "createdAtMs", "entry $id created time")
    val maxAttempts = item.optInt("maxAttempts", -1)
    val attempts = item.optInt("attempts", -1)
    val state = item.optString("state", "")
    val nextAttemptAtMs = requireNonNegativeLong(item, "nextAttemptAtMs", "entry $id retry time")
    val lastError = item.optNullableString("lastError")
    val acceptedAtMs = item.optNullableLong("acceptedAtMs")

    val entry = Entry(
      id = id,
      channelIndex = channelIndex,
      dataType = dataType,
      payload = payload,
      priority = priority,
      description = description,
      identityRef = identityRef,
      expiresAtMs = expiresAtMs,
      createdAtMs = createdAtMs,
      maxAttempts = maxAttempts,
      attempts = attempts,
      state = state,
      nextAttemptAtMs = nextAttemptAtMs,
      lastError = lastError,
      acceptedAtMs = acceptedAtMs,
    )
    validateEntry(entry)
    return entry
  }

  private fun validateEntry(entry: Entry) {
    if (entry.id.isBlank()) {
      throw IllegalStateException("Bushmesh native outbox entry id is invalid.")
    }
    if (entry.channelIndex !in 0..7) {
      throw IllegalStateException("Bushmesh native outbox entry ${entry.id} has an invalid channel.")
    }
    if (entry.dataType !in 1..0xffff) {
      throw IllegalStateException("Bushmesh native outbox entry ${entry.id} has an invalid data type.")
    }
    if (entry.payload.size > MAX_PAYLOAD_BYTES) {
      throw IllegalStateException("Bushmesh native outbox entry ${entry.id} exceeds MeshCore payload capacity.")
    }
    if (!PRIORITIES.contains(entry.priority)) {
      throw IllegalStateException("Bushmesh native outbox entry ${entry.id} has an invalid priority.")
    }
    if (!STATES.contains(entry.state)) {
      throw IllegalStateException("Bushmesh native outbox entry ${entry.id} has an invalid state.")
    }
    if (entry.createdAtMs < 0L || entry.nextAttemptAtMs < 0L) {
      throw IllegalStateException("Bushmesh native outbox entry ${entry.id} has invalid timestamps.")
    }
    if (entry.expiresAtMs != null && entry.expiresAtMs < 0L) {
      throw IllegalStateException("Bushmesh native outbox entry ${entry.id} has invalid expiry.")
    }
    if (entry.acceptedAtMs != null && entry.acceptedAtMs < 0L) {
      throw IllegalStateException("Bushmesh native outbox entry ${entry.id} has invalid acceptance time.")
    }
    if (entry.maxAttempts < 1 || entry.attempts !in 0..entry.maxAttempts) {
      throw IllegalStateException("Bushmesh native outbox entry ${entry.id} has invalid retry metadata.")
    }
  }

  private fun decodeCanonicalBase64(value: String, id: String): ByteArray {
    if (value.isEmpty()) {
      return ByteArray(0)
    }

    return try {
      val decoded = Base64.decode(value, Base64.NO_WRAP)
      val canonical = Base64.encodeToString(decoded, Base64.NO_WRAP)
      if (canonical != value) {
        throw IllegalArgumentException("non-canonical base64")
      }
      decoded
    } catch (error: Exception) {
      throw IllegalStateException("Bushmesh native outbox entry $id has an invalid payload.", error)
    }
  }

  private fun keyStore(): KeyStore =
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun existingKey(): SecretKey {
    val key = keyStore().getKey(KEY_ALIAS, null) as? SecretKey
    return key ?: throw IllegalStateException(
      "Bushmesh outbox encryption key is unavailable to the background service.",
    )
  }

  private fun decrypt(envelope: String): String {
    val parts = envelope.split(':', limit = 3)
    if (parts.size != 3 || parts[0] != ENVELOPE_VERSION) {
      throw IllegalStateException("Unsupported Bushmesh secure outbox envelope.")
    }

    val iv = Base64.decode(parts[1], Base64.NO_WRAP)
    val encrypted = Base64.decode(parts[2], Base64.NO_WRAP)
    if (iv.size != GCM_IV_BYTES || encrypted.isEmpty()) {
      throw IllegalStateException("Bushmesh secure outbox envelope is malformed.")
    }

    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, existingKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
    cipher.updateAAD(AAD.toByteArray(StandardCharsets.UTF_8))
    return String(cipher.doFinal(encrypted), StandardCharsets.UTF_8)
  }

  private fun encrypt(plainText: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, existingKey())
    cipher.updateAAD(AAD.toByteArray(StandardCharsets.UTF_8))
    val encrypted = cipher.doFinal(plainText.toByteArray(StandardCharsets.UTF_8))
    val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
    val payload = Base64.encodeToString(encrypted, Base64.NO_WRAP)
    return "$ENVELOPE_VERSION:$iv:$payload"
  }

  private fun requireNonNegativeLong(
    objectValue: JSONObject,
    key: String,
    label: String,
  ): Long {
    if (!objectValue.has(key) || objectValue.isNull(key)) {
      throw IllegalStateException("Bushmesh native $label is missing.")
    }
    val value = objectValue.optLong(key, -1L)
    if (value < 0L) {
      throw IllegalStateException("Bushmesh native $label is invalid.")
    }
    return value
  }

  private fun JSONObject.optNullableString(key: String): String? {
    if (!has(key) || isNull(key)) {
      return null
    }
    val value = optString(key, "")
    return value.takeIf { it.isNotEmpty() }
  }

  private fun JSONObject.optNullableLong(key: String): Long? {
    if (!has(key) || isNull(key)) {
      return null
    }
    val value = optLong(key, -1L)
    if (value < 0L) {
      throw IllegalStateException("Bushmesh native outbox field $key is invalid.")
    }
    return value
  }

  private fun JSONObject.putNullable(key: String, value: Any?): JSONObject {
    return put(key, value ?: JSONObject.NULL)
  }
}
