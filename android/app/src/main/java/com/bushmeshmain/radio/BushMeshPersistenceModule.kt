package com.bushmeshmain.radio

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
    private const val KEY_ALIAS = "bushmesh_outbox_aes_v1"
    private const val ENVELOPE_VERSION = "v1"
    private const val GCM_TAG_BITS = 128
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

      promise.resolve(decrypt(envelope))
    } catch (error: Exception) {
      promise.reject("BUSHMESH_OUTBOX_LOAD_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun saveOutbox(serializedSnapshot: String, promise: Promise) {
    try {
      val envelope = encrypt(serializedSnapshot)
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

  private fun preferences() = reactContext.getSharedPreferences(
    STORE_NAME,
    ReactApplicationContext.MODE_PRIVATE,
  )

  private fun getOrCreateKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
    if (existing != null) {
      return existing
    }

    val generator = KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES,
      "AndroidKeyStore",
    )
    val spec = KeyGenParameterSpec.Builder(
      KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true)
      .build()

    generator.init(spec)
    return generator.generateKey()
  }

  private fun encrypt(plainText: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    val encrypted = cipher.doFinal(plainText.toByteArray(StandardCharsets.UTF_8))
    val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
    val payload = Base64.encodeToString(encrypted, Base64.NO_WRAP)
    return "$ENVELOPE_VERSION:$iv:$payload"
  }

  private fun decrypt(envelope: String): String {
    val parts = envelope.split(':', limit = 3)
    if (parts.size != 3 || parts[0] != ENVELOPE_VERSION) {
      throw IllegalStateException("Unsupported Bushmesh secure outbox envelope.")
    }

    val iv = Base64.decode(parts[1], Base64.NO_WRAP)
    val encrypted = Base64.decode(parts[2], Base64.NO_WRAP)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(
      Cipher.DECRYPT_MODE,
      getOrCreateKey(),
      GCMParameterSpec(GCM_TAG_BITS, iv),
    )
    val plainText = cipher.doFinal(encrypted)
    return String(plainText, StandardCharsets.UTF_8)
  }
}
