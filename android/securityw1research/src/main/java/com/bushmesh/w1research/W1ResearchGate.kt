package com.bushmesh.w1research

/**
 * Explicitly disconnected R1 research gate. Nothing here provisions,
 * unseals, signs, agrees, registers a CryptoProvider or installs an identity.
 *
 * This is NOT a W1 private-key vault implementation. H1 must never choose
 * W1 on failure, and a synthetic TEE wrapper fixture cannot authorise use.
 */
object W1ResearchGate {
  const val PROVIDER_ID = "android-wrapped-software-curve25519-w1"
  const val CAPABILITY_CLASS = "W1_RESEARCH_BLOCKED"
  const val PRIVATE_OPERATIONS = "SOFTWARE_NOT_IMPLEMENTED"
  const val EXTERNAL_ATTESTATION = "NONE"

  enum class Blocker {
    CRYPTO_DEPENDENCY_NOT_APPROVED,
    PRIVATE_MEMORY_CUSTODY_NOT_REVIEWED,
    WRAPPER_ALIAS_LIFECYCLE_NOT_REVIEWED,
    DEVICE_LOCK_POLICY_UNDECIDED,
    CROSS_STORE_RECOVERY_NOT_REVIEWED,
    ROLLBACK_FENCE_MISSING,
    PRODUCTION_ACTIVATION_FORBIDDEN
  }

  enum class RefusalCode {
    W1_RESEARCH_NOT_APPROVED,
    H1_DOWNGRADE_FORBIDDEN,
    CRYPTO_PRIMITIVE_NOT_IMPLEMENTED,
    WRAPPING_KEY_MISSING,
    WRAPPING_KEY_INVALIDATED,
    WRAPPING_KEY_NOT_HARDWARE_VERIFIED,
    WRAPPING_CONFIGURATION_MISMATCH,
    UNSUPPORTED_RECORD_VERSION,
    PROVIDER_MISMATCH,
    PURPOSE_MISMATCH,
    ALGORITHM_MISMATCH,
    INVALID_METADATA,
    STALE_EPOCH,
    OPERATION_CONFLICT,
    RECORD_BINDING_MISMATCH,
    MALFORMED_ENVELOPE,
    INTERRUPTED_PROVISIONING,
    RETIREMENT_IS_FINAL,
    CLEANUP_FAILED,
    SNAPSHOT_ROLLBACK_UNRESOLVED
  }

  /** Message is a fixed enum identifier. No alias, key or exception details. */
  class Refused(val code: RefusalCode) :
    IllegalStateException("W1_RESEARCH_REFUSED:" + code.name)

  data class Status(
    val profile: String = CAPABILITY_CLASS,
    val proposedCustody: String = "TEE_AES_WRAPPED_SOFTWARE_ED25519_X25519",
    val actualPrivateOperations: String = PRIVATE_OPERATIONS,
    val externalAttestation: String = EXTERNAL_ATTESTATION,
    val productionActivationApproved: Boolean = false,
    val runtimeProviderRegistered: Boolean = false,
    val privateKeyGenerationEnabled: Boolean = false,
    val standaloneW1ApkBuilt: Boolean = false,
    val blockers: Set<Blocker> = Blocker.values().toSet()
  )

  fun describe(): Status = Status()

  // No ability to select W1 via a failed H1 probe, even if a fixture
  // claims a valid AES TEE wrapper or an explicit caller requests W1.
  fun afterH1Failure(): Nothing = refuse(RefusalCode.H1_DOWNGRADE_FORBIDDEN)
  fun requestW1Provisioning(): Nothing = refuse(RefusalCode.W1_RESEARCH_NOT_APPROVED)
  fun requestW1Commit(): Nothing = refuse(RefusalCode.W1_RESEARCH_NOT_APPROVED)
  fun requestW1Signing(): Nothing = refuse(RefusalCode.CRYPTO_PRIMITIVE_NOT_IMPLEMENTED)
  fun requestW1Agreement(): Nothing = refuse(RefusalCode.CRYPTO_PRIMITIVE_NOT_IMPLEMENTED)
  fun requestW1Rotation(): Nothing = refuse(RefusalCode.W1_RESEARCH_NOT_APPROVED)
  fun requestW1Retirement(): Nothing = refuse(RefusalCode.W1_RESEARCH_NOT_APPROVED)
  fun requestW1Unseal(): Nothing = refuse(RefusalCode.CRYPTO_PRIMITIVE_NOT_IMPLEMENTED)

  fun refuse(code: RefusalCode): Nothing = throw Refused(code)
}

/** Policy fixture ONLY. This does not call KeyStore or establish KeyInfo. */
object W1WrapperFixturePolicy {
  enum class Level {
    TRUSTED_ENVIRONMENT, STRONGBOX, SOFTWARE, UNKNOWN_SECURE,
    UNKNOWN, UNRECOGNISED, NOT_INSPECTED
  }

  data class Observation(
    val aliasPresent: Boolean,
    val invalidated: Boolean,
    val level: Level,
    val algorithm: String,
    val keyBits: Int,
    val blockMode: String,
    val padding: String,
    val randomizedEncryption: Boolean
  )

  enum class FixtureAssessment { STRUCTURALLY_ELIGIBLE_NOT_DEVICE_PROOF }

  fun assessFixture(o: Observation): FixtureAssessment {
    if (!o.aliasPresent) W1ResearchGate.refuse(
      W1ResearchGate.RefusalCode.WRAPPING_KEY_MISSING)
    if (o.invalidated) W1ResearchGate.refuse(
      W1ResearchGate.RefusalCode.WRAPPING_KEY_INVALIDATED)
    if (o.level != Level.TRUSTED_ENVIRONMENT && o.level != Level.STRONGBOX) {
      W1ResearchGate.refuse(
        W1ResearchGate.RefusalCode.WRAPPING_KEY_NOT_HARDWARE_VERIFIED)
    }
    if (o.algorithm != "AES" || o.keyBits != 256 ||
        o.blockMode != "GCM" || o.padding != "NoPadding" ||
        !o.randomizedEncryption) {
      W1ResearchGate.refuse(
        W1ResearchGate.RefusalCode.WRAPPING_CONFIGURATION_MISMATCH)
    }
    // A caller-supplied fixture is never proof of an actual AndroidKeyStore
    // KeyInfo lookup and cannot bypass the separate refusal gate.
    return FixtureAssessment.STRUCTURALLY_ELIGIBLE_NOT_DEVICE_PROOF
  }
}
