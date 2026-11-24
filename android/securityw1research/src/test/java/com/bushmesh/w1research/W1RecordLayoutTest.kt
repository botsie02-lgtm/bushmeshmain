package com.bushmesh.w1research

import org.junit.Assert.*
import org.junit.Test

class W1RecordLayoutTest {
  private fun digest(b: Byte): ByteArray = ByteArray(32) { b }
  private val record = "abcdefghijklmnopqrstuvwx"
  private val op = "op_abc123_1"
  private fun header(
    schema: Int = 1, provider: String = W1ResearchGate.PROVIDER_ID,
    algorithm: String = "Ed25519", purpose: String = "identity-signing",
    epoch: Long = 7, slot: Int = 1,
    binding: ByteArray = digest(11), public: ByteArray = digest(12)
  ) = W1RecordLayout.Header(schema, provider, record, algorithm, purpose,
    1, epoch, public, binding, slot, op)

  private fun expected(
    algorithm: String = "Ed25519", purpose: String = "identity-signing",
    epoch: Long = 7, binding: ByteArray = digest(11),
    recordId: String = record
  ) = W1RecordLayout.Expected(recordId, algorithm, purpose, epoch, binding)

  private val iv = ByteArray(12) { it.toByte() }
  private fun refused(code: W1ResearchGate.RefusalCode, f: () -> Unit) {
    assertEquals(code, assertThrows(W1ResearchGate.Refused::class.java) { f() }.code)
  }

  @Test fun canonicalAadIsDeterministicLengthDelimitedAndDomainSeparated() {
    val first = W1RecordLayout.aadLayout(header(), iv)
    val second = W1RecordLayout.aadLayout(header(), iv.clone())
    assertArrayEquals(first, second)
    assertTrue(first.size > 170)
    val differEpoch = W1RecordLayout.aadLayout(header(epoch = 8), iv)
    val differPurpose = W1RecordLayout.aadLayout(
      header(algorithm = "X25519", purpose = "identity-agreement"), iv)
    val differIv = W1RecordLayout.aadLayout(header(), ByteArray(12) { 99 })
    val differPublic = W1RecordLayout.aadLayout(header(public = digest(77)), iv)
    val differSlot = W1RecordLayout.aadLayout(header(slot = 2), iv)
    for (other in listOf(differEpoch, differPurpose, differIv, differPublic, differSlot)) {
      assertFalse(first.contentEquals(other))
    }
  }

  @Test fun matchingPublicMetadataAndEnvelopeLengthsAreStructurallyValidOnly() {
    val h = header()
    val stored = W1RecordLayout.aadLayout(h, iv)
    W1RecordLayout.inspectEnvelopeShape(h, expected(), iv, stored, 48)
    // This proves ONLY structural compatibility. No actual AES authentication
    // or private payload handling exists, and operating keys always refuses.
    refused(W1ResearchGate.RefusalCode.CRYPTO_PRIMITIVE_NOT_IMPLEMENTED) {
      W1ResearchGate.requestW1Unseal()
    }
  }

  @Test fun rejectsUnsupportedVersionWrongProviderOrUnknownAlgorithm() {
    refused(W1ResearchGate.RefusalCode.UNSUPPORTED_RECORD_VERSION) {
      W1RecordLayout.validateHeader(header(schema = 2))
    }
    refused(W1ResearchGate.RefusalCode.PROVIDER_MISMATCH) {
      W1RecordLayout.validateHeader(header(provider = "android-keystore-curve25519-v1"))
    }
    refused(W1ResearchGate.RefusalCode.ALGORITHM_MISMATCH) {
      W1RecordLayout.validateHeader(header(algorithm = "P-256"))
    }
  }

  @Test fun purposeBindingNeverCrossesEd25519AndX25519() {
    refused(W1ResearchGate.RefusalCode.PURPOSE_MISMATCH) {
      W1RecordLayout.validateHeader(header(purpose = "identity-agreement"))
    }
    refused(W1ResearchGate.RefusalCode.PURPOSE_MISMATCH) {
      W1RecordLayout.validateHeader(header(algorithm = "X25519", purpose = "identity-signing"))
    }
    refused(W1ResearchGate.RefusalCode.PURPOSE_MISMATCH) {
      W1RecordLayout.validateHeader(header(algorithm = "X25519", purpose = "session-ephemeral"))
    }
    refused(W1ResearchGate.RefusalCode.PURPOSE_MISMATCH) {
      W1RecordLayout.validateContext(header(), expected(purpose = "identity-agreement"))
    }
  }

  @Test fun staleEpochAndCrossRecordTransplantAreRejected() {
    refused(W1ResearchGate.RefusalCode.STALE_EPOCH) {
      W1RecordLayout.validateContext(header(), expected(epoch = 8))
    }
    refused(W1ResearchGate.RefusalCode.RECORD_BINDING_MISMATCH) {
      W1RecordLayout.validateContext(header(), expected(recordId = "abcdefghijklmnopqrstuvwy"))
    }
    refused(W1ResearchGate.RefusalCode.RECORD_BINDING_MISMATCH) {
      W1RecordLayout.validateContext(header(), expected(binding = digest(99)))
    }
    refused(W1ResearchGate.RefusalCode.ALGORITHM_MISMATCH) {
      W1RecordLayout.validateContext(header(), expected(algorithm = "X25519"))
    }
  }

  @Test fun invalidDigestIdentityEpochAndWrappingSlotRejected() {
    refused(W1ResearchGate.RefusalCode.INVALID_METADATA) {
      W1RecordLayout.validateHeader(header(binding = byteArrayOf(1, 2)))
    }
    refused(W1ResearchGate.RefusalCode.INVALID_METADATA) {
      W1RecordLayout.validateHeader(header(public = ByteArray(31)))
    }
    refused(W1ResearchGate.RefusalCode.INVALID_METADATA) {
      W1RecordLayout.validateHeader(header(epoch = 0))
    }
    refused(W1ResearchGate.RefusalCode.INVALID_METADATA) {
      W1RecordLayout.validateHeader(header(slot = 0))
    }
  }

  @Test fun malformedIvAndCiphertextLengthRejectedWithoutDecryption() {
    refused(W1ResearchGate.RefusalCode.MALFORMED_ENVELOPE) {
      W1RecordLayout.aadLayout(header(), ByteArray(11))
    }
    val aad = W1RecordLayout.aadLayout(header(), iv)
    for (count in listOf(0, 1, 15, 16, 65537)) {
      refused(W1ResearchGate.RefusalCode.MALFORMED_ENVELOPE) {
        W1RecordLayout.inspectEnvelopeShape(header(), expected(), iv, aad, count)
      }
    }
  }

  @Test fun metadataAadTamperRejectedButNoClaimOfCiphertextAuthentication() {
    val aad = W1RecordLayout.aadLayout(header(), iv)
    val tampered = aad.clone().apply { this[lastIndex] = (this[lastIndex].toInt() xor 1).toByte() }
    refused(W1ResearchGate.RefusalCode.RECORD_BINDING_MISMATCH) {
      W1RecordLayout.inspectEnvelopeShape(header(), expected(), iv, tampered, 48)
    }
    refused(W1ResearchGate.RefusalCode.RECORD_BINDING_MISMATCH) {
      W1RecordLayout.inspectEnvelopeShape(header(), expected(), ByteArray(12) { 2 }, aad, 48)
    }
    // AES-GCM integrity/tamper rejection is NOT implemented at R1.
  }

  @Test fun invalidOpaqueIdAndOperationIdRejected() {
    val h = W1RecordLayout.Header(
      1, W1ResearchGate.PROVIDER_ID, "../bad", "Ed25519",
      "identity-signing", 1, 1, digest(1), digest(2), 1, "x"
    )
    refused(W1ResearchGate.RefusalCode.INVALID_METADATA) {
      W1RecordLayout.validateHeader(h)
    }
  }
}
