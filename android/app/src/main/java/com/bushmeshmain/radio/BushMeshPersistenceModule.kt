package com.bushmeshmain.radio

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64OutputStream
import java.io.OutputStream
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class BushMeshPersistenceModule(
  private val reactContext: ReactApplicationContext,
  private val storageName: String = STORE_NAME,
  private val messageKeyAlias: String = MESSAGES_KEY_ALIAS,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val STORE_NAME = "bushmesh_secure_runtime_v1"
    private const val OUTBOX_KEY = "encrypted_outbox_snapshot"
    private const val TRACK_KEY = "encrypted_track_snapshot"
    private const val CONTACTS_KEY = "encrypted_contacts_snapshot"
    // Process-wide fence: a failed rollback must not be followed by another
    // history transaction against SharedPreferences' speculative memory map.
    private val uncertainMessageStores = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private const val MESSAGES_KEY = "encrypted_messages_snapshot"
    private const val MESSAGE_RETENTION_KEY = "encrypted_message_retention_guard_v1"
    private const val MESSAGE_RETENTION_AAD = "v1:message-retention"
    private const val MAP_STATE_KEY = "encrypted_map_state_snapshot"
    private const val FORMATION_KEY = "encrypted_formation_snapshot"
    private const val CANONICAL_RUNTIME_KEY = "encrypted_canonical_runtime_state"
    private const val GPS_PREFERENCES_KEY = "encrypted_gps_preferences_v1"
    private const val DEVICE_PREFERENCES_KEY = "encrypted_device_preferences_v1"
    private const val OUTBOX_KEY_ALIAS = "bushmesh_outbox_aes_v1"
    private const val TRACK_KEY_ALIAS = "bushmesh_track_aes_v1"
    private const val CONTACTS_KEY_ALIAS = "bushmesh_contacts_aes_v1"
    private const val MESSAGES_KEY_ALIAS = "bushmesh_messages_aes_v1"
    private const val MAP_STATE_KEY_ALIAS = "bushmesh_map_state_aes_v1"
    private const val FORMATION_KEY_ALIAS = "bushmesh_formation_aes_v1"
    private const val CANONICAL_RUNTIME_KEY_ALIAS = "bushmesh_canonical_runtime_aes_v1"
    private const val GPS_PREFERENCES_KEY_ALIAS = "bushmesh_gps_preferences_aes_v1"
    private const val DEVICE_PREFERENCES_KEY_ALIAS = "bushmesh_device_preferences_aes_v1"
    private const val CHAT_KEY = "encrypted_chat_preferences_v1"
    private const val CHAT_KEY_ALIAS = "bushmesh_chat_preferences_aes_v1"
    private const val CHAT_ID_ALIAS = "bushmesh_chat_configuration_hmac_v1"
    private const val CHAT_AAD = "v1:chat-preferences"
    private const val ENVELOPE_VERSION = "v1"
    private const val OUTBOX_AAD = ENVELOPE_VERSION
    private const val TRACK_AAD = "$ENVELOPE_VERSION:track"
    private const val CONTACTS_AAD = "$ENVELOPE_VERSION:contacts"
    private const val MESSAGES_AAD = "$ENVELOPE_VERSION:messages"
    private const val MAP_STATE_AAD = "$ENVELOPE_VERSION:map-state"
    private const val FORMATION_AAD = "$ENVELOPE_VERSION:formation"
    private const val CANONICAL_RUNTIME_AAD = "$ENVELOPE_VERSION:canonical-runtime"
    private const val GPS_PREFERENCES_AAD = "$ENVELOPE_VERSION:gps-preferences"
    private const val DEVICE_PREFERENCES_AAD = "$ENVELOPE_VERSION:device-preferences"
    private const val GCM_TAG_BITS = 128
    private const val GCM_IV_BYTES = 12
  }

  override fun getName(): String = "BushMeshPersistence"

  @ReactMethod
  fun loadOutbox(promise: Promise) {
    loadSecureValue(OUTBOX_KEY, OUTBOX_KEY_ALIAS, OUTBOX_AAD, "outbox", "BUSHMESH_OUTBOX_LOAD_FAILED", promise)
  }

  @ReactMethod
  fun saveOutbox(serializedSnapshot: String, promise: Promise) {
    saveSecureValue(OUTBOX_KEY, OUTBOX_KEY_ALIAS, OUTBOX_AAD, "outbox", "BUSHMESH_OUTBOX_SAVE_FAILED", serializedSnapshot, promise)
  }

  @ReactMethod
  fun clearOutbox(promise: Promise) {
    clearSecureValue(OUTBOX_KEY, "outbox", "BUSHMESH_OUTBOX_CLEAR_FAILED", promise)
  }

  @ReactMethod
  fun resetOutboxStorage(promise: Promise) {
    resetStorage(OUTBOX_KEY, OUTBOX_KEY_ALIAS, "BUSHMESH_OUTBOX_RESET_FAILED", "outbox", promise)
  }

  @ReactMethod
  fun loadTrack(promise: Promise) {
    loadSecureValue(TRACK_KEY, TRACK_KEY_ALIAS, TRACK_AAD, "track", "BUSHMESH_TRACK_LOAD_FAILED", promise)
  }

  @ReactMethod
  fun saveTrack(serializedSnapshot: String, promise: Promise) {
    saveSecureValue(TRACK_KEY, TRACK_KEY_ALIAS, TRACK_AAD, "track", "BUSHMESH_TRACK_SAVE_FAILED", serializedSnapshot, promise)
  }

  @ReactMethod
  fun clearTrack(promise: Promise) {
    clearSecureValue(TRACK_KEY, "track", "BUSHMESH_TRACK_CLEAR_FAILED", promise)
  }

  @ReactMethod
  fun resetTrackStorage(promise: Promise) {
    resetStorage(TRACK_KEY, TRACK_KEY_ALIAS, "BUSHMESH_TRACK_RESET_FAILED", "track", promise)
  }

  @ReactMethod
  fun loadContacts(promise: Promise) {
    loadSecureValue(CONTACTS_KEY, CONTACTS_KEY_ALIAS, CONTACTS_AAD, "contacts", "BUSHMESH_CONTACTS_LOAD_FAILED", promise)
  }

  @ReactMethod
  fun saveContacts(serializedSnapshot: String, promise: Promise) {
    saveSecureValue(CONTACTS_KEY, CONTACTS_KEY_ALIAS, CONTACTS_AAD, "contacts", "BUSHMESH_CONTACTS_SAVE_FAILED", serializedSnapshot, promise)
  }

  @ReactMethod
  fun clearContacts(promise: Promise) {
    clearSecureValue(CONTACTS_KEY, "contacts", "BUSHMESH_CONTACTS_CLEAR_FAILED", promise)
  }

  @ReactMethod
  fun resetContactsStorage(promise: Promise) {
    resetStorage(CONTACTS_KEY, CONTACTS_KEY_ALIAS, "BUSHMESH_CONTACTS_RESET_FAILED", "contacts", promise)
  }

  private fun checkMessageStore() {
    check(storageName !in uncertainMessageStores) { "History commit recovery is uncertain. Restart before retrying." }
  }

  private fun messageCapacity(promise: Promise, restoring: Boolean = false) {
    promise.reject("BUSHMESH_HISTORY_CAPACITY", if (restoring)
      "Encrypted history is too large to restore with current memory headroom. Existing storage retained; restart or use a compatible recovery build. Do not reset merely to recover capacity."
      else "Encrypted history exceeds the safe snapshot memory budget. Existing history retained; export or clear selected local history to free capacity. New messages are not confirmed saved.")
  }

  @ReactMethod
  @Synchronized
  fun loadMessages(promise: Promise) {
    try {
      checkMessageStore()
      val prefs = preferences()
      val marker = prefs.getString(MESSAGE_RETENTION_KEY, null)
      val envelope = prefs.getString(MESSAGES_KEY, null)
      if (envelope == null) {
        check(marker == null)
        promise.resolve(null)
        return
      }
      // Preserve compatibility with larger legacy snapshots when enough heap
      // remains; do not overwrite or reset an unreadable snapshot.
      HistorySnapshotBudget.requireRestore(envelope.length.toLong() + (marker?.length ?: 0))
      val snapshot = decrypt(envelope, messageKeyAlias, MESSAGES_AAD, "messages")
      if (marker != null) {
        val guard = MessageRetentionGuard.parse(decrypt(marker, messageKeyAlias, MESSAGE_RETENTION_AAD, "retention"))
        check(guard == MessageRetentionGuard.fromSnapshot(snapshot))
      }
      promise.resolve(snapshot)
    } catch (_: HistoryCapacityException) {
      messageCapacity(promise, restoring = true)
    } catch (_: OutOfMemoryError) {
      messageCapacity(promise, restoring = true)
    } catch (_: Exception) {
      promise.reject("BUSHMESH_MESSAGES_LOAD_FAILED", "Encrypted history could not be verified. Existing storage retained.")
    }
  }

  @ReactMethod
  @Synchronized
  fun saveMessages(serializedSnapshot: String, promise: Promise) {
    saveMessageTransaction(serializedSnapshot, null, promise)
  }

  @ReactMethod
  @Synchronized
  fun saveMessagesWithRetention(serializedSnapshot: String, retentionJson: String, promise: Promise) {
    saveMessageTransaction(serializedSnapshot, retentionJson, promise)
  }

  private fun saveMessageTransaction(snapshot: String, retention: String?, promise: Promise) {
    try {
      checkMessageStore()
      // No full UTF-8 byte array, encryption or Base64 before preflight.
      val snapshotBytes = HistorySnapshotBudget.utf8Bytes(snapshot)
      val retentionBytes = retention?.let { HistorySnapshotBudget.utf8Bytes(it) } ?: 0L
      HistorySnapshotBudget.requireWrite(snapshotBytes + retentionBytes)
      val prefs = preferences()
      val previous = prefs.getString(MESSAGE_RETENTION_KEY, null)
      if (retention == null) {
        check(previous == null) { "History write lacks protected retention ledger." }
      } else {
        val next = MessageRetentionGuard.parse(retention)
        check(next == MessageRetentionGuard.fromSnapshot(snapshot))
        if (previous != null) {
          HistorySnapshotBudget.requireRestore(previous.length.toLong())
          val guard = MessageRetentionGuard.parse(decrypt(previous, messageKeyAlias, MESSAGE_RETENTION_AAD, "retention"))
          check(next.includes(guard))
        }
      }
      val snapshotEnvelope = encryptMessageEnvelope(snapshot, snapshotBytes.toInt(), MESSAGES_AAD)
      val markerEnvelope = retention?.let { encryptMessageEnvelope(it, retentionBytes.toInt(), MESSAGE_RETENTION_AAD) }
      commitMessageValues(prefs, snapshotEnvelope, markerEnvelope)
      promise.resolve(true)
    } catch (_: HistoryCapacityException) {
      messageCapacity(promise)
    } catch (_: OutOfMemoryError) {
      // Last-resort error boundary; preflight is the primary protection.
      if (storageName in uncertainMessageStores) {
        promise.reject("BUSHMESH_MESSAGES_SAVE_FAILED", "History commit is uncertain. Restart before retrying; no save acknowledged.")
      } else {
        messageCapacity(promise)
      }
    } catch (_: Exception) {
      promise.reject("BUSHMESH_MESSAGES_SAVE_FAILED", "Encrypted history and retention could not be committed. No save acknowledged.")
    }
  }

  /** SharedPreferences changes its in-process map before disk commit. Restore
   * both previous values on a failed commit; fence the store if rollback is
   * not confirmed. No later history save may acknowledge speculative data. */
  private fun commitMessageValues(prefs: SharedPreferences, snapshot: String?, marker: String?) {
    val beforeSnapshot = prefs.getString(MESSAGES_KEY, null)
    val beforeMarker = prefs.getString(MESSAGE_RETENTION_KEY, null)
    fun edit(value: String?, guard: String?): SharedPreferences.Editor =
      prefs.edit().putString(MESSAGES_KEY, value).putString(MESSAGE_RETENTION_KEY, guard)
    uncertainMessageStores.add(storageName)
    try {
      check(edit(snapshot, marker).commit())
      uncertainMessageStores.remove(storageName)
    } catch (failure: Exception) {
      if (edit(beforeSnapshot, beforeMarker).commit()) uncertainMessageStores.remove(storageName)
      throw failure
    } catch (failure: OutOfMemoryError) {
      // Rollback also may fail under pressure; keep the fence on failure.
      if (edit(beforeSnapshot, beforeMarker).commit()) uncertainMessageStores.remove(storageName)
      throw failure
    }
  }

  @ReactMethod
  @Synchronized
  fun clearMessages(promise: Promise) {
    try {
      checkMessageStore()
      val prefs = preferences()
      check(!prefs.contains(MESSAGE_RETENTION_KEY))
      commitMessageValues(prefs, null, null)
      promise.resolve(true)
    } catch (_: Exception) {
      promise.reject("BUSHMESH_MESSAGES_CLEAR_FAILED", "Encrypted history clear was not confirmed.")
    } catch (_: OutOfMemoryError) {
      promise.reject("BUSHMESH_MESSAGES_CLEAR_FAILED", "Encrypted history clear was not confirmed.")
    }
  }

  @ReactMethod
  @Synchronized
  fun resetMessagesStorage(promise: Promise) {
    // Existing explicit destructive reset only; no automatic reset on capacity.
    try {
      checkMessageStore()
      commitMessageValues(preferences(), null, null)
      val store = keyStore()
      if (store.containsAlias(messageKeyAlias)) store.deleteEntry(messageKeyAlias)
      getOrCreateKey(messageKeyAlias)
      promise.resolve(true)
    } catch (_: Exception) {
      promise.reject("BUSHMESH_MESSAGES_RESET_FAILED", "Encrypted message storage reset could not be confirmed.")
    }
  }

  @ReactMethod
  fun loadMapState(promise: Promise) {
    loadSecureValue(MAP_STATE_KEY, MAP_STATE_KEY_ALIAS, MAP_STATE_AAD, "map state", "BUSHMESH_MAP_STATE_LOAD_FAILED", promise)
  }

  @ReactMethod
  fun saveMapState(serializedSnapshot: String, promise: Promise) {
    saveSecureValue(MAP_STATE_KEY, MAP_STATE_KEY_ALIAS, MAP_STATE_AAD, "map state", "BUSHMESH_MAP_STATE_SAVE_FAILED", serializedSnapshot, promise)
  }

  @ReactMethod
  fun clearMapState(promise: Promise) {
    clearSecureValue(MAP_STATE_KEY, "map state", "BUSHMESH_MAP_STATE_CLEAR_FAILED", promise)
  }

  @ReactMethod
  fun resetMapStateStorage(promise: Promise) {
    resetStorage(MAP_STATE_KEY, MAP_STATE_KEY_ALIAS, "BUSHMESH_MAP_STATE_RESET_FAILED", "map state", promise)
  }

  @ReactMethod
  fun loadFormation(promise: Promise) {
    loadSecureValue(FORMATION_KEY, FORMATION_KEY_ALIAS, FORMATION_AAD, "formation", "BUSHMESH_FORMATION_LOAD_FAILED", promise)
  }

  @ReactMethod
  fun saveFormation(serializedSnapshot: String, promise: Promise) {
    saveSecureValue(FORMATION_KEY, FORMATION_KEY_ALIAS, FORMATION_AAD, "formation", "BUSHMESH_FORMATION_SAVE_FAILED", serializedSnapshot, promise)
  }

  @ReactMethod
  fun clearFormation(promise: Promise) {
    clearSecureValue(FORMATION_KEY, "formation", "BUSHMESH_FORMATION_CLEAR_FAILED", promise)
  }

  @ReactMethod
  fun resetFormationStorage(promise: Promise) {
    resetStorage(FORMATION_KEY, FORMATION_KEY_ALIAS, "BUSHMESH_FORMATION_RESET_FAILED", "formation", promise)
  }

  @ReactMethod
  fun loadCanonicalRuntimeState(promise: Promise) {
    loadSecureValue(
      CANONICAL_RUNTIME_KEY,
      CANONICAL_RUNTIME_KEY_ALIAS,
      CANONICAL_RUNTIME_AAD,
      "canonical runtime",
      "BUSHMESH_CANONICAL_RUNTIME_LOAD_FAILED",
      promise,
    )
  }

  @ReactMethod
  fun saveCanonicalRuntimeState(serializedState: String, promise: Promise) {
    saveSecureValue(
      CANONICAL_RUNTIME_KEY,
      CANONICAL_RUNTIME_KEY_ALIAS,
      CANONICAL_RUNTIME_AAD,
      "canonical runtime",
      "BUSHMESH_CANONICAL_RUNTIME_SAVE_FAILED",
      serializedState,
      promise,
    )
  }

  @ReactMethod
  fun clearCanonicalRuntimeState(promise: Promise) {
    clearSecureValue(
      CANONICAL_RUNTIME_KEY,
      "canonical runtime",
      "BUSHMESH_CANONICAL_RUNTIME_CLEAR_FAILED",
      promise,
    )
  }

  @ReactMethod
  fun resetCanonicalRuntimeStorage(promise: Promise) {
    resetStorage(
      CANONICAL_RUNTIME_KEY,
      CANONICAL_RUNTIME_KEY_ALIAS,
      "BUSHMESH_CANONICAL_RUNTIME_RESET_FAILED",
      "canonical runtime",
      promise,
    )
  }


  /**
   * Non-sensitive UI preferences use the existing encrypted persistence owner
   * under a distinct key and Keystore alias. This never stores MeshCore channel
   * PSKs, Security v1 private keys or native BLE connection credentials.
   */
  @ReactMethod
  fun loadDevicePreferences(promise: Promise) {
    loadSecureValue(
      DEVICE_PREFERENCES_KEY, DEVICE_PREFERENCES_KEY_ALIAS,
      DEVICE_PREFERENCES_AAD, "device preferences",
      "BUSHMESH_DEVICE_PREFERENCES_LOAD_FAILED", promise,
    )
  }

  @ReactMethod
  fun saveDevicePreferences(serialized: String, promise: Promise) {
    saveSecureValue(
      DEVICE_PREFERENCES_KEY, DEVICE_PREFERENCES_KEY_ALIAS,
      DEVICE_PREFERENCES_AAD, "device preferences",
      "BUSHMESH_DEVICE_PREFERENCES_SAVE_FAILED", serialized, promise,
    )
  }

  @ReactMethod
  fun clearDevicePreferences(promise: Promise) {
    clearSecureValue(
      DEVICE_PREFERENCES_KEY, "device preferences",
      "BUSHMESH_DEVICE_PREFERENCES_CLEAR_FAILED", promise,
    )
  }

  /**
   * Isolated app-private GPS UI settings. Only non-sensitive, whitelisted
   * preferences are sent from JS; this method never stores location fixes.
   * Uses the existing Android Keystore-backed persistence owner.
   */
  @ReactMethod
  fun loadGpsPreferences(promise: Promise) {
    loadSecureValue(
      GPS_PREFERENCES_KEY, GPS_PREFERENCES_KEY_ALIAS,
      GPS_PREFERENCES_AAD, "GPS preferences",
      "BUSHMESH_GPS_PREFERENCES_LOAD_FAILED", promise,
    )
  }

  @ReactMethod
  fun saveGpsPreferences(serialized: String, promise: Promise) {
    saveSecureValue(
      GPS_PREFERENCES_KEY, GPS_PREFERENCES_KEY_ALIAS,
      GPS_PREFERENCES_AAD, "GPS preferences",
      "BUSHMESH_GPS_PREFERENCES_SAVE_FAILED", serialized, promise,
    )
  }

  @ReactMethod
  @Synchronized
  fun loadChatPreferences(promise: Promise) {
    try {
      if (preferences().contains(CHAT_KEY) &&
          (!keyStore().containsAlias(CHAT_KEY_ALIAS) || !keyStore().containsAlias(CHAT_ID_ALIAS))) {
        promise.reject("BUSHMESH_CHAT_LOAD_FAILED", "Protected chat keys unavailable; existing preferences retained.")
        return
      }
    } catch (_: Exception) {
      promise.reject("BUSHMESH_CHAT_LOAD_FAILED", "Protected chat storage unavailable.")
      return
    }
    loadSecureValue(CHAT_KEY, CHAT_KEY_ALIAS, CHAT_AAD, "chat preferences",
      "BUSHMESH_CHAT_LOAD_FAILED", promise)
  }

  @ReactMethod
  @Synchronized
  fun saveChatPreferences(serialized: String, promise: Promise) {
    try {
      val store = keyStore()
      if (!store.containsAlias(CHAT_ID_ALIAS) ||
          (preferences().contains(CHAT_KEY) && !store.containsAlias(CHAT_KEY_ALIAS))) {
        promise.reject("BUSHMESH_CHAT_SAVE_FAILED", "Protected chat keys unavailable; existing preferences retained.")
        return
      }
    } catch (_: Exception) {
      promise.reject("BUSHMESH_CHAT_SAVE_FAILED", "Protected chat storage unavailable.")
      return
    }
    if (serialized.length > 1000000) {
      promise.reject("BUSHMESH_CHAT_SAVE_FAILED", "Chat preferences exceed storage limit.")
      return
    }
    saveSecureValue(CHAT_KEY, CHAT_KEY_ALIAS, CHAT_AAD, "chat preferences",
      "BUSHMESH_CHAT_SAVE_FAILED", serialized, promise)
  }

  // Local opaque configuration identifier; never a network identity or PSK.
  @ReactMethod
  @Synchronized
  fun chatConfigurationId(configuration: String, promise: Promise) {
    try {
      require(configuration.length in 1..1024)
      val store = keyStore()
      val key = store.getKey(CHAT_ID_ALIAS, null) as? SecretKey ?: run {
        check(!preferences().contains(CHAT_KEY)) { "Protected chat identity unavailable." }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(CHAT_ID_ALIAS, KeyProperties.PURPOSE_SIGN)
          .setDigests(KeyProperties.DIGEST_SHA256).build())
        generator.generateKey()
      }
      val mac = Mac.getInstance("HmacSHA256")
      mac.init(key)
      promise.resolve(mac.doFinal(configuration.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 0xff) })
    } catch (_: Exception) {
      promise.reject("BUSHMESH_CHAT_ID_FAILED", "Protected chat identity unavailable.")
    }
  }

  private fun loadSecureValue(
    preferenceKey: String,
    keyAlias: String,
    aad: String,
    label: String,
    errorCode: String,
    promise: Promise,
  ) {
    try {
      val envelope = preferences().getString(preferenceKey, null)
      if (envelope == null) {
        promise.resolve(null)
        return
      }

      promise.resolve(decrypt(envelope, keyAlias, aad, label))
    } catch (error: Exception) {
      promise.reject(errorCode, error.message, error)
    }
  }

  @Synchronized
  private fun saveSecureValue(
    preferenceKey: String,
    keyAlias: String,
    aad: String,
    label: String,
    errorCode: String,
    serializedSnapshot: String,
    promise: Promise,
  ) {
    try {
      checkMessageStore()
      val envelope = encrypt(serializedSnapshot, keyAlias, aad)
      val committed = preferences().edit().putString(preferenceKey, envelope).commit()
      if (!committed) {
        promise.reject(errorCode, "Android secure $label storage did not commit the snapshot.")
        return
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject(errorCode, error.message, error)
    }
  }

  @Synchronized
  private fun clearSecureValue(
    preferenceKey: String,
    label: String,
    errorCode: String,
    promise: Promise,
  ) {
    try {
      checkMessageStore()
      val committed = preferences().edit().remove(preferenceKey).commit()
      if (!committed) {
        promise.reject(errorCode, "Android secure $label storage did not clear the snapshot.")
        return
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject(errorCode, error.message, error)
    }
  }

  private fun preferences() = reactContext.getSharedPreferences(
    storageName,
    Context.MODE_PRIVATE,
  )

  private fun keyStore(): KeyStore =
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun getOrCreateKey(alias: String): SecretKey {
    val keyStore = keyStore()
    val existing = keyStore.getKey(alias, null) as? SecretKey
    if (existing != null) {
      return existing
    }

    val generator = KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES,
      "AndroidKeyStore",
    )
    val spec = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true)
      .build()

    generator.init(spec)
    return generator.generateKey()
  }

  private fun encrypt(
    plainText: String,
    keyAlias: String,
    aad: String,
  ): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(keyAlias))
    cipher.updateAAD(aad.toByteArray(StandardCharsets.UTF_8))
    val encrypted = cipher.doFinal(plainText.toByteArray(StandardCharsets.UTF_8))
    val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
    val payload = Base64.encodeToString(encrypted, Base64.NO_WRAP)
    return "$ENVELOPE_VERSION:$iv:$payload"
  }

  /** Same v1 envelope, nonce and AAD as the existing store. Encrypt bounded
   * UTF-8 chunks and Base64 directly into one pre-sized envelope buffer.
   * No full plaintext byte array, full payload String or concatenation copy.
   * Provider-internal buffering and the final SharedPreferences value remain. */
  private fun encryptMessageEnvelope(text: String, bytes: Int, aad: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(messageKeyAlias))
    cipher.updateAAD(aad.toByteArray(StandardCharsets.UTF_8))
    check(cipher.iv.size == GCM_IV_BYTES)
    val prefix = "$ENVELOPE_VERSION:" + Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":"
    val encodedSize = 4 * ((bytes + GCM_TAG_BITS / 8 + 2) / 3)
    val sink = FixedEnvelopeOutput(prefix, encodedSize)
    val base64 = Base64OutputStream(sink, Base64.NO_WRAP or Base64.NO_CLOSE)
    var offset = 0
    while (offset < text.length) {
      var end = minOf(offset + 8192, text.length)
      // Never split a surrogate pair across chunks.
      if (end < text.length && Character.isHighSurrogate(text[end - 1]) && Character.isLowSurrogate(text[end])) end--
      val chunk = text.substring(offset, end).toByteArray(StandardCharsets.UTF_8)
      try { cipher.update(chunk)?.let { base64.write(it) } }
      finally { chunk.fill(0) }
      offset = end
    }
    base64.write(cipher.doFinal())
    base64.close()
    return sink.finish()
  }

  private class FixedEnvelopeOutput(prefix: String, encodedSize: Int) : OutputStream() {
    private val buffer = ByteArray(prefix.length + encodedSize)
    private var offset = 0
    init { write(prefix.toByteArray(StandardCharsets.US_ASCII)) }
    override fun write(value: Int) {
      check(offset < buffer.size)
      buffer[offset++] = value.toByte()
    }
    override fun write(value: ByteArray, start: Int, length: Int) {
      check(length <= buffer.size - offset)
      value.copyInto(buffer, offset, start, start + length)
      offset += length
    }
    fun finish(): String {
      check(offset == buffer.size)
      return String(buffer, StandardCharsets.US_ASCII)
    }
  }

  private fun decrypt(
    envelope: String,
    keyAlias: String,
    aad: String,
    label: String,
  ): String {
    val parts = envelope.split(':', limit = 3)
    if (parts.size != 3 || parts[0] != ENVELOPE_VERSION) {
      throw IllegalStateException("Unsupported Bushmesh secure $label envelope.")
    }

    val iv = Base64.decode(parts[1], Base64.NO_WRAP)
    val encrypted = Base64.decode(parts[2], Base64.NO_WRAP)
    if (iv.size != GCM_IV_BYTES || encrypted.isEmpty()) {
      throw IllegalStateException("Bushmesh secure $label envelope is malformed.")
    }

    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(
      Cipher.DECRYPT_MODE,
      getOrCreateKey(keyAlias),
      GCMParameterSpec(GCM_TAG_BITS, iv),
    )
    cipher.updateAAD(aad.toByteArray(StandardCharsets.UTF_8))
    val plainText = cipher.doFinal(encrypted)
    return String(plainText, StandardCharsets.UTF_8)
  }

  @Synchronized
  private fun resetStorage(
    preferenceKey: String,
    keyAlias: String,
    errorCode: String,
    label: String,
    promise: Promise,
  ) {
    try {
      checkMessageStore()
      val cleared = preferences().edit().remove(preferenceKey).commit()
      if (!cleared) {
        promise.reject(errorCode, "Android secure $label storage did not clear the unreadable snapshot.")
        return
      }

      val keyStore = keyStore()
      if (keyStore.containsAlias(keyAlias)) {
        keyStore.deleteEntry(keyAlias)
      }
      getOrCreateKey(keyAlias)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject(errorCode, error.message, error)
    }
  }
}
