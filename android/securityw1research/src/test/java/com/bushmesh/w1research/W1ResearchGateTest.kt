package com.bushmesh.w1research

import org.junit.Assert.*
import org.junit.Test

class W1ResearchGateTest {
  private fun refused(expected: W1ResearchGate.RefusalCode, block: () -> Any?) {
    val e = assertThrows(W1ResearchGate.Refused::class.java) { block() }
    assertEquals(expected, e.code)
    assertEquals("W1_RESEARCH_REFUSED:" + expected.name, e.message)
  }

  private fun verifiedFixture() = W1WrapperFixturePolicy.Observation(
    aliasPresent = true, invalidated = false,
    level = W1WrapperFixturePolicy.Level.TRUSTED_ENVIRONMENT,
    algorithm = "AES", keyBits = 256, blockMode = "GCM",
    padding = "NoPadding", randomizedEncryption = true
  )

  @Test fun reportAlwaysSaysResearchBlockedAndSoftwareOperationUnimplemented() {
    val status = W1ResearchGate.describe()
    assertEquals("W1_RESEARCH_BLOCKED", status.profile)
    assertEquals("SOFTWARE_NOT_IMPLEMENTED", status.actualPrivateOperations)
    assertEquals("NONE", status.externalAttestation)
    assertFalse(status.productionActivationApproved)
    assertFalse(status.privateKeyGenerationEnabled)
    assertFalse(status.runtimeProviderRegistered)
    assertFalse(status.standaloneW1ApkBuilt)
    assertEquals(7, status.blockers.size)
  }

  @Test fun noOperationCanProcessSoftwarePrivateKeysOrActivateW1() {
    refused(W1ResearchGate.RefusalCode.W1_RESEARCH_NOT_APPROVED) {
      W1ResearchGate.requestW1Provisioning()
    }
    refused(W1ResearchGate.RefusalCode.W1_RESEARCH_NOT_APPROVED) {
      W1ResearchGate.requestW1Commit()
    }
    refused(W1ResearchGate.RefusalCode.CRYPTO_PRIMITIVE_NOT_IMPLEMENTED) {
      W1ResearchGate.requestW1Signing()
    }
    refused(W1ResearchGate.RefusalCode.CRYPTO_PRIMITIVE_NOT_IMPLEMENTED) {
      W1ResearchGate.requestW1Agreement()
    }
    refused(W1ResearchGate.RefusalCode.CRYPTO_PRIMITIVE_NOT_IMPLEMENTED) {
      W1ResearchGate.requestW1Unseal()
    }
    refused(W1ResearchGate.RefusalCode.W1_RESEARCH_NOT_APPROVED) {
      W1ResearchGate.requestW1Rotation()
    }
    refused(W1ResearchGate.RefusalCode.W1_RESEARCH_NOT_APPROVED) {
      W1ResearchGate.requestW1Retirement()
    }
  }

  @Test fun H1FailureNeverAutomaticallySelectsW1EvenWithSyntheticTee() {
    assertEquals(W1WrapperFixturePolicy.FixtureAssessment.STRUCTURALLY_ELIGIBLE_NOT_DEVICE_PROOF,
      W1WrapperFixturePolicy.assessFixture(verifiedFixture()))
    refused(W1ResearchGate.RefusalCode.H1_DOWNGRADE_FORBIDDEN) {
      W1ResearchGate.afterH1Failure()
    }
    refused(W1ResearchGate.RefusalCode.W1_RESEARCH_NOT_APPROVED) {
      W1ResearchGate.requestW1Provisioning()
    }
  }

  @Test fun onlyExplicitTeeAndStrongboxPassFixtureStructuralAssessment() {
    val eligible = setOf(W1WrapperFixturePolicy.Level.TRUSTED_ENVIRONMENT,
      W1WrapperFixturePolicy.Level.STRONGBOX)
    for (level in W1WrapperFixturePolicy.Level.values()) {
      val fixture = verifiedFixture().copy(level = level)
      if (level in eligible) {
        assertEquals(W1WrapperFixturePolicy.FixtureAssessment.STRUCTURALLY_ELIGIBLE_NOT_DEVICE_PROOF,
          W1WrapperFixturePolicy.assessFixture(fixture))
      } else {
        refused(W1ResearchGate.RefusalCode.WRAPPING_KEY_NOT_HARDWARE_VERIFIED) {
          W1WrapperFixturePolicy.assessFixture(fixture)
        }
      }
    }
  }

  @Test fun missingOrInvalidatedKeystoreWrapperAlwaysRefused() {
    refused(W1ResearchGate.RefusalCode.WRAPPING_KEY_MISSING) {
      W1WrapperFixturePolicy.assessFixture(verifiedFixture().copy(aliasPresent = false))
    }
    refused(W1ResearchGate.RefusalCode.WRAPPING_KEY_INVALIDATED) {
      W1WrapperFixturePolicy.assessFixture(verifiedFixture().copy(invalidated = true))
    }
  }

  @Test fun aesProfileCannotBeDowngraded() {
    val variants = listOf(
      verifiedFixture().copy(algorithm = "ChaCha20"),
      verifiedFixture().copy(keyBits = 128),
      verifiedFixture().copy(blockMode = "CBC"),
      verifiedFixture().copy(padding = "PKCS7Padding"),
      verifiedFixture().copy(randomizedEncryption = false),
    )
    for (variant in variants) {
      refused(W1ResearchGate.RefusalCode.WRAPPING_CONFIGURATION_MISMATCH) {
        W1WrapperFixturePolicy.assessFixture(variant)
      }
    }
  }

  @Test fun noReactNativeBridgeOrPrivateKeyImportContractExists() {
    // Reflection is confined to the research module. It does not prove a
    // secure future vault; CI independently checks production dependencies.
    val methodNames = W1ResearchGate::class.java.declaredMethods.map { it.name }
    assertFalse(methodNames.any { it.contains("exportPrivate", ignoreCase = true) })
    assertFalse(methodNames.any { it.contains("importPrivate", ignoreCase = true) })
    assertFalse(methodNames.any { it.contains("decrypt", ignoreCase = true) })
  }
}
