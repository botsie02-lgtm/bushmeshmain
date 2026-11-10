package com.bushmeshmain.security

import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

/**
 * A standalone opt-in React Native module. It is registered but never selected
 * by live Security v1, BLE, background radio or convoy code.
 */
class BushMeshSecurityModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {
  private val core = BushMeshSecurityCore(context)
  private val keys = BushMeshCurve25519Keys(core)
  private val rng = SecureRandom()

  override fun getName() = "BushMeshSecurity"

  private fun decode(encoded: String): ByteArray = Base64.decode(encoded, Base64.NO_WRAP)
  private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

  private inline fun execute(promise: Promise, operation: () -> Any?) {
    try {
      promise.resolve(operation())
    } catch (e: Exception) {
      val code = if (e.message == "KEY_NOT_FOUND") "KEY_NOT_FOUND"
        else if (e is IllegalArgumentException) "INVALID_INPUT"
        else "SECURITY_UNAVAILABLE"
      // Never put key bytes, payloads, aliases or ciphertext into JS errors.
      promise.reject(code, "BushMesh Android security operation failed", e)
    }
  }

  @ReactMethod fun probe(promise: Promise) = execute(promise) {
    val details = keys.probe()
    details.put("strongBoxFeature",
      Build.VERSION.SDK_INT >= 28 && reactApplicationContext.packageManager.hasSystemFeature(
        PackageManager.FEATURE_STRONGBOX_KEYSTORE))
    details.put("schemaVersion", 1)
    details.put("hardwareRollbackResistantCounters", false)
    details.put("enabledInApplication", false)
    details.toString()
  }

  @ReactMethod fun read(kind: String, name: String, promise: Promise) = execute(promise) {
    core.get(kind, name)?.let(::encode)
  }

  @ReactMethod fun write(kind: String, name: String, encoded: String, promise: Promise) = execute(promise) {
    val value = decode(encoded)
    try { core.put(kind, name, value) } finally { value.fill(0) }
    null
  }

  @ReactMethod fun remove(kind: String, name: String, promise: Promise) = execute(promise) {
    core.remove(kind, name)
    null
  }

  @ReactMethod fun listMetadata(prefix: String, promise: Promise) = execute(promise) {
    val array = Arguments.createArray()
    core.listMetadata(prefix).forEach(array::pushString)
    array
  }

  @ReactMethod fun setIdentityAtomic(identity: String, handles: String, promise: Promise) =
    execute(promise) { core.setIdentityAtomic(identity, handles); null }

  @ReactMethod fun getNonceHigh(scope: String, promise: Promise) =
    execute(promise) { core.getHigh(scope) }

  @ReactMethod fun reserveNonce(scope: String, minimum: String, promise: Promise) =
    execute(promise) { core.reserveNonce(scope, minimum) }

  @ReactMethod fun advanceNonceHigh(scope: String, value: String, promise: Promise) =
    execute(promise) { core.advanceHigh(scope, value); null }

  @ReactMethod fun acceptReplay(scope: String, counter: String, size: Int, promise: Promise) =
    execute(promise) { core.acceptReplay(scope, counter, size) }

  @ReactMethod fun consumeHandshake(id: String, expiresAt: Double, promise: Promise) =
    execute(promise) {
      require(expiresAt.isFinite() && expiresAt > 0.0 && expiresAt <= 9007199254740991.0)
      core.consumeHandshake(id, expiresAt.toLong())
    }

  @ReactMethod fun commitEpoch(
    txId: String, groupId: String, digest: String, expected: Int, next: Int,
    groupRecordJson: String, keyRef: String, secretB64: String, promise: Promise,
  ) = execute(promise) {
    val secret = decode(secretB64)
    try { core.commitEpoch(txId, groupId, digest, expected, next, groupRecordJson, keyRef, secret) }
    finally { secret.fill(0) }
  }

  @ReactMethod fun epochHigh(groupId: String, promise: Promise) =
    execute(promise) { core.epochHigh(groupId) }

  @ReactMethod fun randomBytes(length: Int, promise: Promise) = execute(promise) {
    require(length in 1..65536)
    val bytes = ByteArray(length).also(rng::nextBytes)
    try { encode(bytes) } finally { bytes.fill(0) }
  }

  @ReactMethod fun sha256(dataB64: String, promise: Promise) = execute(promise) {
    encode(MessageDigest.getInstance("SHA-256").digest(decode(dataB64)))
  }

  @ReactMethod fun hkdf(ikmB64: String, saltB64: String, infoB64: String, length: Int, promise: Promise) =
    execute(promise) {
      require(length in 1..8160)
      val input = decode(ikmB64)
      val salt = decode(saltB64)
      val info = decode(infoB64)
      val mac = Mac.getInstance("HmacSHA256")
      val key = if (salt.isEmpty()) ByteArray(32) else salt
      mac.init(SecretKeySpec(key, "HmacSHA256"))
      val prk = mac.doFinal(input)
      try {
        val out = ByteArray(length)
        var previous = byteArrayOf()
        var offset = 0
        var index = 1
        while (offset < length) {
          mac.init(SecretKeySpec(prk, "HmacSHA256"))
          mac.update(previous)
          mac.update(info)
          mac.update(index.toByte())
          previous = mac.doFinal()
          val count = minOf(32, length - offset)
          previous.copyInto(out, offset, 0, count)
          offset += count
          index++
        }
        try { encode(out) } finally { out.fill(0); previous.fill(0) }
      } finally { prk.fill(0); input.fill(0) }
    }

  @ReactMethod fun aead(
    encrypt: Boolean, keyB64: String, nonceB64: String, payloadB64: String,
    aadB64: String, promise: Promise,
  ) = execute(promise) {
    val key = decode(keyB64)
    val nonce = decode(nonceB64)
    val payload = decode(payloadB64)
    val aad = decode(aadB64)
    try {
      require(key.size == 32 && nonce.size == 12)
      if (!encrypt) require(payload.size >= 16)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(if (encrypt) Cipher.ENCRYPT_MODE else Cipher.DECRYPT_MODE,
        SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
      cipher.updateAAD(aad)
      encode(cipher.doFinal(payload))
    } finally {
      key.fill(0)
      payload.fill(0)
    }
  }

  @ReactMethod fun createKey(algorithm: String, purpose: String, promise: Promise) =
    execute(promise) { keys.create(algorithm, purpose).toString() }

  @ReactMethod fun hasKey(handleJson: String, promise: Promise) =
    execute(promise) { keys.has(JSONObject(handleJson)) }

  @ReactMethod fun deleteKey(handleJson: String, promise: Promise) =
    execute(promise) { keys.delete(JSONObject(handleJson)); null }

  @ReactMethod fun sign(handleJson: String, messageB64: String, promise: Promise) =
    execute(promise) { encode(keys.sign(JSONObject(handleJson), decode(messageB64))) }

  @ReactMethod fun verify(publicB64: String, messageB64: String, signatureB64: String, promise: Promise) =
    execute(promise) { keys.verify(decode(publicB64), decode(messageB64), decode(signatureB64)) }

  @ReactMethod fun agree(handleJson: String, peerB64: String, promise: Promise) =
    execute(promise) {
      val shared = keys.agree(JSONObject(handleJson), decode(peerB64))
      try { encode(shared) } finally { shared.fill(0) }
    }
}
