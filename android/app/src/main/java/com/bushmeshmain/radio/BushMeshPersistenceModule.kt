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
    private const val OUTBOX_KEY_ALIAS = "bushmesh_outbox_aes_v1"
    private const val TRACK_KEY_ALIAS = "bushmesh_track_aes_v1"
    private const val ENVELOPE_VERSION = "v1"
    private const val OUTBOX_AAD = ENVELOPE_VERSION
    private const val TRACK_AAD = "$ENVELOPE_VERSION:track"
    private const val GCM_TAG_BITS = 128
    private const val GCM_IV_BYTES = 12
  }

  override fun getName(): String = "BushMeshPersistence"

  @ReactMethod
  fun loadOutbox(promise: Promise) {
    try {
      val envelope = preferences().getString(OUTBOX_KEY, null)
      if (envelope == null) {
        promise.resolve(null)
        return
      }

      promise.resolve(decrypt(envelope, OUTBOX_KEY_ALIAS, OUTBOX_AAD, "outbox"))
    } catch (error: Exception) {
      promise.reject("BUSHMESH_OUTBOX_LOAD_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun saveOutbox(serializedSnapshot: String, promise: Promise) {
    try {
      val envelope = encrypt(serializedSnapshot, OUTBOX_KEY_ALIAS, OUTBOX_AAD)
      val committed = preferences().edit().putString(OUTBOX_KEY, envelope).commit()
      if (!committed) {
        promise.reject(
          "BUSHMESH_OUTBOX_SAVE_FAILED",
          "Android secure outbox storage did not commit the snapshot.",
        )
        return
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_OUTBOX_SAVE_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun clearOutbox(promise: Promise) {
    try {
      val committed = preferences().edit().remove(OUTBOX_KEY).commit()
      if (!committed) {
        promise.reject(
          "BUSHMESH_OUTBOX_CLEAR_FAILED",
          "Android secure outbox storage did not clear the snapshot.",
        )
        return
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_OUTBOX_CLEAR_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun resetOutboxStorage(promise: Promise) {
    resetStorage(
      preferenceKey = OUTBOX_KEY,
      keyAlias = OUTBOX_KEY_ALIAS,
      errorCode = "BUSHMESH_OUTBOX_RESET_FAILED",
      label = "outbox",
      promise = promise,
    )
  }

  @ReactMethod
  fun loadTrack(promise: Promise) {
    try {
      val envelope = preferences().getString(TRACK_KEY, null)
      if (envelope == null) {
        promise.resolve(null)
        return
      }

      promise.resolve(decrypt(envelope, TRACK_KEY_ALIAS, TRACK_AAD, "track"))
    } catch (error: Exception) {
      promise.reject("BUSHMESH_TRACK_LOAD_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun saveTrack(serializedSnapshot: String, promise: Promise) {
    try {
      val envelope = encrypt(serializedSnapshot, TRACK_KEY_ALIAS, TRACK_AAD)
      val committed = preferences().edit().putString(TRACK_KEY, envelope).commit()
      if (!committed) {
        promise.reject(
          "BUSHMESH_TRACK_SAVE_FAILED",
          "Android secure track storage did not commit the snapshot.",
        )
        return
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_TRACK_SAVE_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun clearTrack(promise: Promise) {
    try {
      val committed = preferences().edit().remove(TRACK_KEY).commit()
      if (!committed) {
        promise.reject(
          "BUSHMESH_TRACK_CLEAR_FAILED",
          "Android secure track storage did not clear the snapshot.",
        )
        return
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_TRACK_CLEAR_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun resetTrackStorage(promise: Promise) {
    resetStorage(
      preferenceKey = TRACK_KEY,
      keyAlias = TRACK_KEY_ALIAS,
      errorCode = "BUSHMESH_TRACK_RESET_FAILED",
      label = "track",
      promise = promise,
    )
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
        promise.reject(
          errorCode,
          "Android secure $label storage did not clear the unreadable snapshot.",
        )
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
