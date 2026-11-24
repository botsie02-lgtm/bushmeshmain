package com.bushmesh.w1research

/**
 * Quarantine/refusal model for an UNIMPLEMENTED vault. This code neither
 * opens SQLite nor recovers identity keys. It is a testable proposal about
 * fail-closed behavior at process death, reboot, invalidation or retirement.
 */
object W1RecoveryRefusal {
  enum class State {
    ABSENT, PREPARING, SEALED_PENDING, IDENTITY_COMMITTED,
    ACTIVE, RETIRING, RETIRED, QUARANTINED
  }

  data class Snapshot(
    val state: State,
    val identityEpoch: Long,
    val operationId: String,
    val failedCleanup: Boolean = false,
    val rollbackFenceProven: Boolean = false
  )

  /** No outcome permits key use, even if a test fixture reports an AES TEE. */
  enum class Outcome {
    EMPTY, QUARANTINE_INCOMPLETE, QUARANTINE_FAILED_CLEANUP,
    RETIRED_PERMANENT, MISSING_OR_INVALIDATED_WRAPPER,
    STALE_EPOCH, CONFLICTING_OPERATION, SNAPSHOT_ROLLBACK_UNRESOLVED,
    RESEARCH_BLOCKED
  }

  fun decide(
    saved: Snapshot,
    expectedEpoch: Long,
    expectedOperationId: String,
    wrapperPresent: Boolean,
    wrapperInvalidated: Boolean
  ): Outcome {
    if (saved.state == State.RETIRED || saved.state == State.RETIRING) {
      return Outcome.RETIRED_PERMANENT
    }
    if (saved.failedCleanup || saved.state == State.QUARANTINED) {
      return Outcome.QUARANTINE_FAILED_CLEANUP
    }
    if (saved.state == State.ABSENT) return Outcome.EMPTY
    if (!wrapperPresent || wrapperInvalidated) return Outcome.MISSING_OR_INVALIDATED_WRAPPER
    if (saved.identityEpoch < 1 || saved.identityEpoch != expectedEpoch) return Outcome.STALE_EPOCH
    if (saved.operationId != expectedOperationId) return Outcome.CONFLICTING_OPERATION
    if (saved.state in setOf(State.PREPARING, State.SEALED_PENDING,
                            State.IDENTITY_COMMITTED)) {
      return Outcome.QUARANTINE_INCOMPLETE
    }
    if (!saved.rollbackFenceProven) return Outcome.SNAPSHOT_ROLLBACK_UNRESOLVED
    return Outcome.RESEARCH_BLOCKED
  }

  fun requireUsable(outcome: Outcome): Nothing =
    W1ResearchGate.refuse(when (outcome) {
      Outcome.RETIRED_PERMANENT -> W1ResearchGate.RefusalCode.RETIREMENT_IS_FINAL
      Outcome.MISSING_OR_INVALIDATED_WRAPPER ->
        W1ResearchGate.RefusalCode.WRAPPING_KEY_MISSING
      Outcome.STALE_EPOCH -> W1ResearchGate.RefusalCode.STALE_EPOCH
      Outcome.CONFLICTING_OPERATION -> W1ResearchGate.RefusalCode.OPERATION_CONFLICT
      Outcome.QUARANTINE_FAILED_CLEANUP -> W1ResearchGate.RefusalCode.CLEANUP_FAILED
      Outcome.SNAPSHOT_ROLLBACK_UNRESOLVED ->
        W1ResearchGate.RefusalCode.SNAPSHOT_ROLLBACK_UNRESOLVED
      Outcome.QUARANTINE_INCOMPLETE ->
        W1ResearchGate.RefusalCode.INTERRUPTED_PROVISIONING
      Outcome.EMPTY, Outcome.RESEARCH_BLOCKED ->
        W1ResearchGate.RefusalCode.W1_RESEARCH_NOT_APPROVED
    })
}
