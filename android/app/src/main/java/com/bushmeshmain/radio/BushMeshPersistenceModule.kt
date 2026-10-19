package com.bushmeshmain.radio

import android.content.Context
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
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class BushMeshPersistenceModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val STORE_NAME = "bushmesh_secure_runtime_v1"
    private const val OUTBOX_KEY = "encrypted_outbox_snapshot"
    private const val TRACK_KEY = "encrypted_track_snapshot"
    private const val CONTACTS_KEY = "encrypted_contacts_snapshot"
    private const val MESSAGES_KEY = "encrypted_messages_snapshot"
    private const val OUTBOX_KEY_ALIAS = "bushmesh_outbox_aes_v1"
    private const val TRACK_KEY_ALIAS = "bushmesh_track_aes_v1"
    private const val CONTACTS_KEY_ALIAS = "bushmesh_contacts_aes_v1"
    private const val MESSAGES_KEY_ALIAS = "bushmesh_messages_aes_v1"
    private const val ENVELOPE_VERSION = "v1"
    private const val OUTBOX_AAD = ENVELOPE_VERSION
    private const val TRACK_AAD = "$ENVELOPE_VERSION:track"
    private const val CONTACTS_AAD = "$ENVELOPE_VERSION:contacts"
    private const val MESSAGES_AAD = "$ENVELOPE_VERSION:messages"
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

  @ReactMethod
  fun loadMessages(promise: Promise) {
    loadSecureValue(MESSAGES_KEY, MESSAGES_KEY_ALIAS, MESSAGES_AAD, "messages", "BUSHMESH_MESSAGES_LOAD_FAILED", promise)
  }

  @ReactMethod
  fun saveMessages(serializedSnapshot: String, promise: Promise) {
    saveSecureValue(MESSAGES_KEY, MESSAGES_KEY_ALIAS, MESSAGES_AAD, "messages", "BUSHMESH_MESSAGES_SAVE_FAILED", serializedSnapshot, promise)
  }

  @ReactMethod
  fun clearMessages(promise: Promise) {
    clearSecureValue(MESSAGES_KEY, "messages", "BUSHMESH_MESSAGES_CLEAR_FAILED", promise)
  }

  @ReactMethod
  fun resetMessagesStorage(promise: Promise) {
    resetStorage(MESSAGES_KEY, MESSAGES_KEY_ALIAS, "BUSHMESH_MESSAGES_RESET_FAILED", "messages", promise)
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

  private fun clearSecureValue(
    preferenceKey: String,
    label: String,
    errorCode: String,
    promise: Promise,
  ) {
    try {
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
    STORE_NAME,
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

  private fun resetStorage(
    preferenceKey: String,
    keyAlias: String,
    errorCode: String,
    label: String,
    promise: Promise,
  ) {
    try {
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
