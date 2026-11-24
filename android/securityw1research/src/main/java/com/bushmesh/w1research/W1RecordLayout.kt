package com.bushmesh.w1research

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.MessageDigest

/**
 * Public METADATA layout draft ONLY. No private key/seed in this class.
 * Not an AEAD implementation and not a storage authorisation or parser.
 * Structural validation MUST NOT be mistaken for AES-GCM authentication.
 */
object W1RecordLayout {
  const val VERSION = 1
  const val GCM_TAG_BITS = 128
  const val GCM_IV_BYTES = 12
  const val DIGEST_BYTES = 32
  private const val DOMAIN = "bushmesh-w1-vault-v1/aad"
  private val idPattern = Regex("[A-Za-z0-9_-]{24}")
  private val operationPattern = Regex("[A-Za-z0-9._-]{8,64}")

  class Header(
    val schemaVersion: Int,
    val providerId: String,
    val recordId: String,
    val algorithm: String,
    val purpose: String,
    val identityVersion: Int,
    val identityEpoch: Long,
    val publicKeyDigest: ByteArray,
    val identityBindingDigest: ByteArray,
    val wrappingSlotVersion: Int,
    val operationId: String
  )

  /** Public caller context used solely for refusal of wrong/stale bindings. */
  class Expected(
    val recordId: String,
    val algorithm: String,
    val purpose: String,
    val identityEpoch: Long,
    val identityBindingDigest: ByteArray
  )

  private fun deny(code: W1ResearchGate.RefusalCode): Nothing =
    W1ResearchGate.refuse(code)

  fun validateHeader(h: Header) {
    if (h.schemaVersion != VERSION) deny(
      W1ResearchGate.RefusalCode.UNSUPPORTED_RECORD_VERSION)
    if (h.providerId != W1ResearchGate.PROVIDER_ID) deny(
      W1ResearchGate.RefusalCode.PROVIDER_MISMATCH)
    if (!idPattern.matches(h.recordId) || !operationPattern.matches(h.operationId) ||
        h.identityVersion != 1 || h.identityEpoch < 1 || h.wrappingSlotVersion < 1 ||
        h.wrappingSlotVersion > 65535 ||
        h.publicKeyDigest.size != DIGEST_BYTES ||
        h.identityBindingDigest.size != DIGEST_BYTES) {
      deny(W1ResearchGate.RefusalCode.INVALID_METADATA)
    }
    if (h.algorithm != "Ed25519" && h.algorithm != "X25519") deny(
      W1ResearchGate.RefusalCode.ALGORITHM_MISMATCH)
    if (!((h.algorithm == "Ed25519" && h.purpose == "identity-signing") ||
          (h.algorithm == "X25519" && h.purpose == "identity-agreement"))) {
      // Ephemeral W1 keys are deliberately NOT designed/approved here.
      deny(W1ResearchGate.RefusalCode.PURPOSE_MISMATCH)
    }
  }

  fun validateContext(h: Header, expected: Expected) {
    validateHeader(h)
    if (h.recordId != expected.recordId || h.providerId != W1ResearchGate.PROVIDER_ID) {
      deny(W1ResearchGate.RefusalCode.RECORD_BINDING_MISMATCH)
    }
    if (h.algorithm != expected.algorithm) deny(
      W1ResearchGate.RefusalCode.ALGORITHM_MISMATCH)
    if (h.purpose != expected.purpose) deny(
      W1ResearchGate.RefusalCode.PURPOSE_MISMATCH)
    if (h.identityEpoch != expected.identityEpoch) deny(
      W1ResearchGate.RefusalCode.STALE_EPOCH)
    if (expected.identityBindingDigest.size != DIGEST_BYTES ||
        !MessageDigest.isEqual(h.identityBindingDigest, expected.identityBindingDigest)) {
      deny(W1ResearchGate.RefusalCode.RECORD_BINDING_MISMATCH)
    }
  }

  /**
   * Canonical, length-delimited authenticated-data *design*; does not
   * encrypt, decrypt, seal or authenticate any private material.
   * Operation ID and IV are deliberately bound to prevent transplant.
   */
  fun aadLayout(h: Header, iv: ByteArray): ByteArray {
    validateHeader(h)
    if (iv.size != GCM_IV_BYTES) deny(W1ResearchGate.RefusalCode.MALFORMED_ENVELOPE)
    val buffer = ByteArrayOutputStream()
    DataOutputStream(buffer).use { out ->
      fun text(value: String) {
        val bytes = value.toByteArray(Charsets.UTF_8)
        require(bytes.size in 1..128)
        out.writeInt(bytes.size)
        out.write(bytes)
      }
      fun bytes(value: ByteArray) {
        out.writeInt(value.size)
        out.write(value)
      }
      text(DOMAIN)
      out.writeInt(h.schemaVersion)
      text(h.providerId)
      text(h.recordId)
      text(h.algorithm)
      text(h.purpose)
      out.writeInt(h.identityVersion)
      out.writeLong(h.identityEpoch)
      bytes(h.publicKeyDigest)
      bytes(h.identityBindingDigest)
      out.writeInt(h.wrappingSlotVersion)
      text(h.operationId)
      out.writeInt(GCM_TAG_BITS)
      bytes(iv)
    }
    return buffer.toByteArray()
  }

  /**
   * Pure *structural* check. Even a passing result does NOT imply AEAD
   * integrity, correct ciphertext or a valid/usable private key.
   */
  fun inspectEnvelopeShape(
    h: Header, expected: Expected, iv: ByteArray,
    declaredAad: ByteArray, ciphertextWithTagByteCount: Int
  ) {
    validateContext(h, expected)
    if (ciphertextWithTagByteCount < 17 || ciphertextWithTagByteCount > 65536 ||
        iv.size != GCM_IV_BYTES) {
      deny(W1ResearchGate.RefusalCode.MALFORMED_ENVELOPE)
    }
    val canonical = aadLayout(h, iv)
    try {
      if (!MessageDigest.isEqual(canonical, declaredAad)) {
        deny(W1ResearchGate.RefusalCode.RECORD_BINDING_MISMATCH)
      }
    } finally {
      canonical.fill(0)
    }
  }
}
