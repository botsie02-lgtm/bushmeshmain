package com.bushmeshmain.security

import org.json.JSONObject
import java.util.Locale

/**
 * Only allowlisted stage identifiers, static error codes and sanitized
 * exception class names enter the exported report. Raw Throwable.message,
 * Keystore aliases, stack traces, public/private keys and key bytes do not.
 */
internal class CurveProbeDiagnostics(private val algorithm: String) {
  companion object {
    private val stageNames = listOf(
      "serviceRegistration",
      "providerSelection",
      "parameterSpec",
      "curvePurposeCompatibility",
      "keyGeneration",
      "keyInfoRetrieval",
      "hardwareSecurityLevel",
      "rfc8410PublicEncoding",
      "ed25519SignVerify",
      "x25519Agreement",
      "keyCleanup",
    )

    private val codes = mapOf(
      "serviceRegistration" to "SERVICE_NOT_REGISTERED",
      "providerSelection" to "ANDROID_KEYSTORE_PROVIDER_UNAVAILABLE",
      "parameterSpec" to "KEY_SPEC_BUILD_FAILED",
      "curvePurposeCompatibility" to "CURVE_OR_PURPOSE_REJECTED",
      "keyGeneration" to "HARDWARE_KEY_GENERATION_FAILED",
      "keyInfoRetrieval" to "KEYINFO_INSPECTION_FAILED",
      "hardwareSecurityLevel" to "TEE_STRONGBOX_VERIFICATION_FAILED",
      "rfc8410PublicEncoding" to "RFC8410_ENCODING_INCOMPATIBLE",
      "ed25519SignVerify" to "SIGN_OR_VERIFY_FAILED",
      "x25519Agreement" to "HARDWARE_AGREEMENT_FAILED",
      "keyCleanup" to "PROBE_KEY_DELETE_FAILED",
    )

    fun safeClass(e: Throwable): String {
      val name = e.javaClass.simpleName
      return if (name.matches(Regex("[A-Za-z][A-Za-z0-9_]{0,63}"))) name else "UnknownException"
    }

    fun safeProvider(value: String): String =
      if (value.matches(Regex("[A-Za-z0-9_.-]{1,64}"))) value else "unclassified"

    fun sanitizedError(stage: String, e: Throwable): JSONObject = JSONObject()
      .put("stage", if (stage == "storageHardware") stage else "unclassified")
      .put("exceptionClass", safeClass(e))
      .put("errorCode", if (stage == "storageHardware") "HARDWARE_STORAGE_UNAVAILABLE" else "UNCLASSIFIED")
      .put("safeMessage", if (stage == "storageHardware")
        "Storage hardware inspection could not be verified" else "Operation not verified")
  }

  private val stages = JSONObject()
  private val details = JSONObject()
  private var firstFailingStage: String? = null
  private var exceptionClass: String? = null
  private var errorCode: String? = null

  init {
    check(algorithm == "Ed25519" || algorithm == "X25519")
    stageNames.forEach { stages.put(it, JSONObject().put("status", "NOT_RUN")) }
  }

  fun <T> run(stage: String, operation: () -> T): T {
    check(stage in stageNames) { "Unrecognized security diagnostic stage" }
    return try {
      val value = operation()
      stages.put(stage, JSONObject().put("status", "PASS"))
      value
    } catch (e: Exception) {
      fail(stage, e)
      throw e
    }
  }

  private fun fail(stage: String, failure: Exception) {
    val code = codes.getValue(stage)
    stages.put(stage, JSONObject().put("status", "FAIL")
      .put("exceptionClass", safeClass(failure))
      .put("errorCode", code)
      .put("safeMessage", when (stage) {
        "serviceRegistration" -> "Exact KeyPairGenerator service not registered in AndroidKeyStore"
        "providerSelection" -> "Explicit AndroidKeyStore provider could not be selected"
        "parameterSpec" -> "Exact Keystore parameter specification could not be constructed"
        "curvePurposeCompatibility" -> "Named curve, digest or key purpose was rejected"
        "keyGeneration" -> "AndroidKeyStore hardware key generation failed"
        "keyInfoRetrieval" -> "AndroidKeyStore KeyFactory could not expose KeyInfo"
        "hardwareSecurityLevel" -> "TEE/StrongBox level or non-exportability not verified"
        "rfc8410PublicEncoding" -> "Exact 32-byte RFC 8410 public key was not returned"
        "ed25519SignVerify" -> "Ed25519 signing or verification failed"
        "x25519Agreement" -> "AndroidKeyStore X25519 agreement failed"
        else -> "Temporary Keystore aliases could not be removed"
      }))
    if (firstFailingStage == null) {
      firstFailingStage = stage
      exceptionClass = safeClass(failure)
      errorCode = code
    }
  }

  fun provider(name: String, value: String) {
    check(name in setOf("keyPairGeneratorProvider", "signatureProvider", "keyAgreementProvider"))
    details.put(name, safeProvider(value))
  }

  fun detail(name: String, value: Any) {
    check(name in setOf("keyInfoAttempts", "hardwareLevel", "rawPublicLength"))
    details.put(name, value)
  }

  fun notApplicable(stage: String) {
    check(stage == "ed25519SignVerify" || stage == "x25519Agreement")
    stages.put(stage, JSONObject().put("status", "NOT_APPLICABLE"))
  }

  fun unavailable(code: String) {
    check(code == "UNSUPPORTED_ANDROID_API" || code == "HARDWARE_STORAGE_UNAVAILABLE")
    if (firstFailingStage == null) {
      firstFailingStage = "precondition"
      errorCode = code
      exceptionClass = "NotRun"
    }
  }

  fun finish(passed: Boolean): JSONObject = JSONObject()
    .put("algorithm", algorithm)
    .put("passed", passed && firstFailingStage == null &&
      stages.getJSONObject("keyCleanup").getString("status") == "PASS")
    .put("firstFailingStage", firstFailingStage ?: JSONObject.NULL)
    .put("exceptionClass", exceptionClass ?: JSONObject.NULL)
    .put("errorCode", errorCode ?: JSONObject.NULL)
    .put("stages", stages)
    .put("details", details)
    .also { result ->
      if (details.has("hardwareLevel")) result.put("hardwareLevel", details.getString("hardwareLevel"))
    }
}
