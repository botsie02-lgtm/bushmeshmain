package com.bushmeshmain.security

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.KeyAgreement
import java.security.PrivateKey
import java.security.Security
import java.security.NoSuchAlgorithmException
import org.json.JSONArray
import org.json.JSONObject

/**
 * Exact Ed25519/X25519 only. No JCA software private keys or silent P-256
 * fallback. Every generated key is re-opened from AndroidKeyStore and verified
 * to have TEE/StrongBox KeyInfo BEFORE a handle can be exposed.
 *
 * Runtime probe is mandatory PER PROCESS; it creates and deletes throwaway
 * hardware keys. This class is not referenced by operational Security v1.
 */
class BushMeshCurve25519Keys(private val store: BushMeshSecurityCore) {
  companion object {
    const val provider = "android-keystore-curve25519-v1"
    private val edSpki = hex("302a300506032b6570032100")
    private val xSpki = hex("302a300506032b656e032100")
    private val random = SecureRandom()
    private fun hex(s: String): ByteArray = s.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
  }

  @Volatile private var passedSelfTest = false

  private fun keystore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun alias(id: String) = "bushmesh_curve_v1_" + id

  private fun id(): String {
    val bytes = ByteArray(18).also(random::nextBytes)
    return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
  }

  private fun assertId(id: String) {
    require(Regex("[A-Za-z0-9_-]{24}").matches(id)) { "Invalid opaque private-key ID" }
  }

  private fun info(privateKey: PrivateKey, attempts: JSONArray? = null): KeyInfo {
    // AOSP and vendor Keystore versions differ in the KeyFactory aliases
    // accepted for KeyInfo. Record each attempt independently. No private
    // key bytes, KeyStore aliases or exception messages enter the report.
    var last: Exception? = null
    for (alg in listOf(privateKey.algorithm, "EC", "Ed25519", "XDH").distinct()) {
      try {
        val factory = KeyFactory.getInstance(alg, "AndroidKeyStore")
        val result = factory.getKeySpec(privateKey, KeyInfo::class.java) as KeyInfo
        attempts?.put(JSONObject()
          .put("algorithm", CurveProbeDiagnostics.safeProvider(alg))
          .put("status", "PASS")
          .put("provider", CurveProbeDiagnostics.safeProvider(factory.provider.name)))
        return result
      } catch (e: Exception) {
        last = e
        attempts?.put(JSONObject()
          .put("algorithm", CurveProbeDiagnostics.safeProvider(alg))
          .put("status", "FAIL")
          .put("exceptionClass", CurveProbeDiagnostics.safeClass(e))
          .put("errorCode", "KEY_FACTORY_OR_KEYSPEC_REJECTED"))
      }
    }
    throw IllegalStateException("Cannot inspect private-key hardware security level", last)
  }

  private fun securityLevel(keyInfo: KeyInfo): String =
    if (Build.VERSION.SDK_INT >= 31) when (keyInfo.securityLevel) {
      KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
      KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
      else -> throw IllegalStateException("Curve25519 key is not hardware backed")
    } else if (keyInfo.isInsideSecureHardware) {
      "hardware-unclassified"
    } else {
      throw IllegalStateException("Curve25519 key is not hardware backed")
    }

  private fun checkHardware(privateKey: PrivateKey): String =
    securityLevel(info(privateKey))

  private fun generate(
    algorithm: String,
    keyAlias: String,
    diagnostic: CurveProbeDiagnostics? = null,
  ): KeyPair {
    require(Build.VERSION.SDK_INT >= 33) { "Curve25519 KeyMint v2 needs Android 13 or newer" }
    val signing = algorithm == "Ed25519"
    require(signing || algorithm == "X25519")
    val jca = if (signing) "Ed25519" else "XDH"
    diagnostic?.run("serviceRegistration") {
      val registration = Security.getProvider("AndroidKeyStore")
        ?.getService("KeyPairGenerator", jca)
      if (registration == null) throw NoSuchAlgorithmException("SERVICE_NOT_REGISTERED")
    }
    // The requested provider is EXPLICIT, so no software-provider fallback.
    val generator = if (diagnostic != null) diagnostic.run("providerSelection") {
      KeyPairGenerator.getInstance(jca, "AndroidKeyStore").also {
        diagnostic.provider("keyPairGeneratorProvider", it.provider.name)
      }
    } else KeyPairGenerator.getInstance(jca, "AndroidKeyStore")
    val spec = if (diagnostic != null) diagnostic.run("parameterSpec") {
      buildSpec(keyAlias, signing)
    } else buildSpec(keyAlias, signing)
    if (diagnostic != null) diagnostic.run("curvePurposeCompatibility") {
      generator.initialize(spec)
    } else generator.initialize(spec)
    val pair = if (diagnostic != null) diagnostic.run("keyGeneration") {
      generator.generateKeyPair()
    } else generator.generateKeyPair()
    if (diagnostic != null) {
      val attempts = JSONArray()
      val info = diagnostic.run("keyInfoRetrieval") { info(pair.private, attempts) }
      diagnostic.detail("keyInfoAttempts", attempts)
      diagnostic.run("hardwareSecurityLevel") {
        diagnostic.detail("hardwareLevel", securityLevel(info))
        check(pair.private.encoded == null) { "Private key unexpectedly exportable" }
      }
      diagnostic.run("rfc8410PublicEncoding") {
        val raw = rawPublic(pair.public.encoded, algorithm)
        diagnostic.detail("rawPublicLength", raw.size)
      }
    } else {
      checkHardware(pair.private)
      rawPublic(pair.public.encoded, algorithm)
    }
    return pair
  }

  private fun buildSpec(keyAlias: String, signing: Boolean): KeyGenParameterSpec {
    val builder = KeyGenParameterSpec.Builder(
      keyAlias, if (signing) KeyProperties.PURPOSE_SIGN else KeyProperties.PURPOSE_AGREE_KEY,
    ).setAlgorithmParameterSpec(ECGenParameterSpec(if (signing) "ed25519" else "x25519"))
    if (signing) builder.setDigests(KeyProperties.DIGEST_NONE)
    return builder.build()
  }

  private fun rawPublic(encoded: ByteArray, algorithm: String): ByteArray {
    val prefix = if (algorithm == "Ed25519") edSpki else xSpki
    require(encoded.size == prefix.size + 32 && encoded.copyOfRange(0, prefix.size).contentEquals(prefix)) {
      "Provider returned an incompatible public-key encoding"
    }
    return encoded.copyOfRange(prefix.size, encoded.size)
  }

  private fun publicKey(raw: ByteArray, algorithm: String): java.security.PublicKey {
    require(raw.size == 32) { "Security v1 public key must be exactly 32 bytes" }
    val prefix = if (algorithm == "Ed25519") edSpki else xSpki
    val spec = X509EncodedKeySpec(prefix + raw)
    return KeyFactory.getInstance(if (algorithm == "Ed25519") "Ed25519" else "XDH").generatePublic(spec)
  }

  private fun signWith(key: PrivateKey, message: ByteArray): ByteArray {
    val signer = Signature.getInstance("Ed25519")
    signer.initSign(key)
    signer.update(message)
    return signer.sign().also { require(it.size == 64) { "Invalid Ed25519 signature length" } }
  }

  private fun agreeWith(key: PrivateKey, publicKey: java.security.PublicKey): ByteArray {
    val agreement = KeyAgreement.getInstance("XDH", "AndroidKeyStore")
    agreement.init(key)
    agreement.doPhase(publicKey, true)
    val secret = agreement.generateSecret()
    require(secret.size == 32 && secret.any { it != 0.toByte() }) { "Invalid X25519 shared secret" }
    return secret
  }

  /**
   * Each algorithm reports a distinct first failing stage and bounded,
   * hard-coded error code. No exception message, stack trace, alias, public
   * key, signature, shared secret or other material is included.
   *
   * This performs exactly the same KeyGenParameterSpec, KeyInfo, security
   * level and RFC 8410 checks as normal key creation. No fallback.
   */
  @Synchronized fun probe(): JSONObject {
    passedSelfTest = false
    val result = JSONObject()
    result.put("apiLevel", Build.VERSION.SDK_INT)
    result.put("strongBoxFeature", false) // Actual device feature comes from ProbeReport.
    result.put("ed25519", false)
    result.put("x25519", false)
    result.put("enabled", false)
    result.put("diagnosticsSchema", 1)
    val storage = try { store.storageSecurityLevel() } catch (e: Exception) {
      result.put("storageFailure", CurveProbeDiagnostics.sanitizedError("storageHardware", e))
      "unavailable"
    }
    result.put("storageLevel", storage)

    val ed = diagnose("Ed25519", storage != "unavailable")
    val x = diagnose("X25519", storage != "unavailable")
    result.put("ed25519Diagnostics", ed)
    result.put("x25519Diagnostics", x)
    val edSuccess = ed.optBoolean("passed", false)
    val xSuccess = x.optBoolean("passed", false)
    result.put("ed25519", edSuccess)
    result.put("x25519", xSuccess)
    if (edSuccess) result.put("ed25519Level", ed.getString("hardwareLevel"))
    if (xSuccess) result.put("x25519Level", x.getString("hardwareLevel"))
    if (!edSuccess) {
      result.put("ed25519Failure", ed.optString("exceptionClass", "NotRun"))
      result.put("ed25519FailureStage", ed.optString("firstFailingStage", "notRun"))
      result.put("ed25519ErrorCode", ed.optString("errorCode", "UNVERIFIED"))
    }
    if (!xSuccess) {
      result.put("x25519Failure", x.optString("exceptionClass", "NotRun"))
      result.put("x25519FailureStage", x.optString("firstFailingStage", "notRun"))
      result.put("x25519ErrorCode", x.optString("errorCode", "UNVERIFIED"))
    }
    passedSelfTest = edSuccess && xSuccess && storage != "unavailable"
    result.put("enabled", passedSelfTest)
    return result
  }

  private fun diagnose(algorithm: String, storageVerified: Boolean): JSONObject {
    val trace = CurveProbeDiagnostics(algorithm)
    val first = alias(id())
    val second = if (algorithm == "X25519") alias(id()) else null
    var passed = false
    try {
      if (Build.VERSION.SDK_INT < 33) {
        trace.unavailable("UNSUPPORTED_ANDROID_API")
      } else if (!storageVerified) {
        trace.unavailable("HARDWARE_STORAGE_UNAVAILABLE")
      } else if (algorithm == "Ed25519") {
        trace.notApplicable("x25519Agreement")
        val signing = generate("Ed25519", first, trace)
        trace.run("ed25519SignVerify") {
          val message = byteArrayOf(0x42, 0x4d, 0x01)
          val signature = signWith(signing.private, message)
          try {
            val verifier = Signature.getInstance("Ed25519")
            trace.provider("signatureProvider", verifier.provider.name)
            verifier.initVerify(publicKey(rawPublic(signing.public.encoded, "Ed25519"), "Ed25519"))
            verifier.update(message)
            check(verifier.verify(signature)) { "Signature self-test failed" }
          } finally {
            signature.fill(0)
          }
        }
        passed = true
      } else {
        trace.notApplicable("ed25519SignVerify")
        val a = generate("X25519", first, trace)
        trace.run("x25519Agreement") {
          val b = generate("X25519", requireNotNull(second))
          val left = agreeWith(a.private,
            publicKey(rawPublic(b.public.encoded, "X25519"), "X25519"))
          try {
            val right = agreeWith(b.private,
              publicKey(rawPublic(a.public.encoded, "X25519"), "X25519"))
            try {
              check(MessageDigest.isEqual(left, right)) { "Agreement mismatch" }
            } finally { right.fill(0) }
          } finally { left.fill(0) }
        }
        passed = true
      }
    } catch (_: Exception) {
      // The failing stage already contains the sanitized exception details;
      // never include raw vendor exception messages in an exported report.
    } finally {
      try {
        trace.run("keyCleanup") {
          val ks = keystore()
          // Delete BOTH throwaway aliases even when the earlier stage fails.
          for (candidate in listOfNotNull(first, second)) ks.deleteEntry(candidate)
        }
      } catch (_: Exception) {
        passed = false // A cleanup failure can NEVER result in a PASS.
      }
    }
    return trace.finish(passed)
  }

  private fun requireProbe() {
    check(passedSelfTest) { "Hardware Curve25519 self-test has not passed in this process" }
  }

  @Synchronized fun create(algorithm: String, purpose: String): JSONObject {
    requireProbe()
    require(
      (algorithm == "Ed25519" && purpose == "identity-signing") ||
      (algorithm == "X25519" && (purpose == "identity-agreement" || purpose == "session-ephemeral")),
    ) { "Wrong key algorithm or purpose" }
    val keyId = id()
    val keyAlias = alias(keyId)
    try {
      val pair = generate(algorithm, keyAlias)
      val handle = JSONObject().put("provider", provider).put("id", keyId)
        .put("algorithm", algorithm).put("purpose", purpose)
      store.put("meta", "privateHandle/" + keyId, handle.toString().toByteArray(Charsets.UTF_8))
      return JSONObject().put("privateKeyHandle", handle)
        .put("publicKey", Base64.encodeToString(rawPublic(pair.public.encoded, algorithm), Base64.NO_WRAP))
        .put("hardwareLevel", checkHardware(pair.private))
    } catch (e: Exception) {
      keystore().deleteEntry(keyAlias)
      throw e
    }
  }

  private fun resolve(handle: JSONObject, algorithm: String, purpose: String? = null): PrivateKey {
    requireProbe()
    require(handle.getString("provider") == provider)
    val keyId = handle.getString("id")
    assertId(keyId)
    require(handle.getString("algorithm") == algorithm)
    if (purpose != null) require(handle.getString("purpose") == purpose)
    val saved = store.get("meta", "privateHandle/" + keyId)
      ?: throw IllegalStateException("KEY_NOT_FOUND")
    val original = JSONObject(String(saved, Charsets.UTF_8))
    require(original.toString() == handle.toString() ||
      (original.getString("provider") == handle.getString("provider") &&
        original.getString("id") == keyId &&
        original.getString("algorithm") == handle.getString("algorithm") &&
        original.getString("purpose") == handle.getString("purpose")))
    val key = keystore().getKey(alias(keyId), null) as? PrivateKey
      ?: throw IllegalStateException("KEY_NOT_FOUND")
    checkHardware(key)
    return key
  }

  @Synchronized fun has(handle: JSONObject): Boolean {
    requireProbe()
    return try {
      resolve(handle, handle.getString("algorithm"))
      true
    } catch (e: IllegalStateException) {
      if (e.message == "KEY_NOT_FOUND") false else throw e
    }
  }

  @Synchronized fun delete(handle: JSONObject) {
    require(handle.getString("provider") == provider)
    val keyId = handle.getString("id")
    assertId(keyId)
    // No untrusted caller may delete a different provider's key.
    val raw = store.get("meta", "privateHandle/" + keyId) ?: return
    val saved = JSONObject(String(raw, Charsets.UTF_8))
    require(saved.getString("algorithm") == handle.getString("algorithm") &&
      saved.getString("purpose") == handle.getString("purpose"))
    keystore().deleteEntry(alias(keyId))
    store.remove("meta", "privateHandle/" + keyId)
  }

  fun sign(handle: JSONObject, message: ByteArray): ByteArray =
    signWith(resolve(handle, "Ed25519", "identity-signing"), message)

  fun verify(public: ByteArray, message: ByteArray, signature: ByteArray): Boolean {
    if (public.size != 32 || signature.size != 64) return false
    return try {
      val verifier = Signature.getInstance("Ed25519")
      verifier.initVerify(publicKey(public, "Ed25519"))
      verifier.update(message)
      verifier.verify(signature)
    } catch (_: Exception) { false }
  }

  fun agree(handle: JSONObject, public: ByteArray): ByteArray {
    require(handle.getString("purpose") in listOf("identity-agreement", "session-ephemeral"))
    return agreeWith(resolve(handle, "X25519"), publicKey(public, "X25519"))
  }
}
