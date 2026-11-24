package com.bushmeshmain.securityv2

/**
 * Pure JVM-testable predicates for the isolated V2 SQLite provider.
 * None of these checks authenticates an Ed25519 signature or appoints an
 * owner. Admission proofs MUST be checked by an independent authority port.
 */
internal object SecurityV2NativeRules {
  const val MAX_EPOCH = 4_294_967_295L
  private val identifier = Regex("[A-Za-z0-9_.:-]{1,128}")
  private val group = Regex("bmg1_[A-Za-z0-9_-]{8,128}")
  private val sha256 = Regex("[A-Za-z0-9_-]{43}")

  data class Member(
    val deviceId: String,
    val fingerprint: String,
    val keyEpoch: Long,
    val state: String,
    val joinedAt: Long,
    val revokedAt: Long?,
  )

  fun id(value: String) {
    require(identifier.matches(value)) { "INVALID_INPUT: malformed reference" }
  }

  fun groupId(value: String) {
    require(group.matches(value)) { "INVALID_INPUT: malformed group" }
  }

  fun digest(value: String) {
    require(sha256.matches(value)) { "INVALID_INPUT: malformed SHA-256 digest" }
  }

  fun epoch(value: Long) {
    require(value in 1..MAX_EPOCH) { "INVALID_INPUT: epoch outside V2 range" }
  }

  fun advance(previous: Long, next: Long) {
    epoch(previous)
    epoch(next)
    require(previous < MAX_EPOCH && next == previous + 1L) {
      "STALE_EPOCH: epoch CAS must advance exactly once"
    }
  }

  fun key(value: ByteArray) {
    require(value.size == 32) { "KEY_MISSING: expected fresh 32-byte epoch key" }
  }

  fun members(before: List<Member>, after: List<Member>, requester: String): Boolean {
    if (before.size + 1 != after.size || after.size > 256) return false
    if (before.map { it.deviceId }.toSet().size != before.size) return false
    if (after.map { it.deviceId }.toSet().size != after.size) return false
    if (before.any { it.deviceId == requester }) return false
    val byId = after.associateBy { it.deviceId }
    if (!before.all { byId[it.deviceId] == it }) return false
    val joined = byId[requester] ?: return false
    return joined.state == "pending-install" && joined.keyEpoch >= 1L &&
      joined.joinedAt > 0L && joined.revokedAt == null
  }

  /** Reject rollback of any previously observed revoked member/credential. */
  fun recipientTransition(
    old: List<Member>, new: List<Member>,
    previousRevocations: Set<String>, newRevocations: Set<String>,
    previousAuthoritySequence: Long, nextAuthoritySequence: Long,
  ): Boolean {
    if (new.map { it.deviceId }.toSet().size != new.size) return false
    if (!old.all { prior -> new.any { it == prior } }) return false
    if (!newRevocations.containsAll(previousRevocations)) return false
    return nextAuthoritySequence >= previousAuthoritySequence
  }

  fun distinctKey(previous: ByteArray, proposed: ByteArray): Boolean {
    key(previous)
    key(proposed)
    // Fixed-length compare; never approve reuse of the previous key.
    var delta = 0
    for (i in previous.indices) delta = delta or
      (previous[i].toInt() xor proposed[i].toInt())
    return delta != 0
  }
}
