package com.bushmesh.w1research

import org.junit.Assert.*
import org.junit.Test

class W1RecoveryRefusalTest {
  private val model = W1RecoveryRefusal
  private fun snapshot(
    state: W1RecoveryRefusal.State, epoch: Long = 8,
    op: String = "operation-01", cleanupFailure: Boolean = false,
    fence: Boolean = false
  ) = W1RecoveryRefusal.Snapshot(state, epoch, op, cleanupFailure, fence)

  private fun evaluate(s: W1RecoveryRefusal.Snapshot,
    epoch: Long = 8, op: String = "operation-01",
    present: Boolean = true, invalidated: Boolean = false
  ): W1RecoveryRefusal.Outcome =
    model.decide(s, epoch, op, present, invalidated)

  @Test fun interruptedPrepareSealAndIdentityCommitMustQuarantine() {
    for (state in listOf(
      W1RecoveryRefusal.State.PREPARING,
      W1RecoveryRefusal.State.SEALED_PENDING,
      W1RecoveryRefusal.State.IDENTITY_COMMITTED
    )) {
      assertEquals(W1RecoveryRefusal.Outcome.QUARANTINE_INCOMPLETE,
        evaluate(snapshot(state)))
    }
  }

  @Test fun processRestartSimulationRemainsDeterministicallyBlocked() {
    val persistentFixture = snapshot(W1RecoveryRefusal.State.ACTIVE)
    val before = evaluate(persistentFixture)
    val after = evaluate(persistentFixture.copy()) // simulates state reloading only
    assertEquals(before, after)
    assertEquals(W1RecoveryRefusal.Outcome.SNAPSHOT_ROLLBACK_UNRESOLVED, after)
    val exception = assertThrows(W1ResearchGate.Refused::class.java) {
      model.requireUsable(after)
    }
    assertEquals(W1ResearchGate.RefusalCode.SNAPSHOT_ROLLBACK_UNRESOLVED, exception.code)
  }

  @Test fun evenFalselyClaimedRollbackFenceCannotActivateWithoutReview() {
    val claim = snapshot(W1RecoveryRefusal.State.ACTIVE, fence = true)
    assertEquals(W1RecoveryRefusal.Outcome.RESEARCH_BLOCKED, evaluate(claim))
    assertThrows(W1ResearchGate.Refused::class.java) {
      model.requireUsable(evaluate(claim))
    }
  }

  @Test fun retiredAndRetiringStatesAreOneWayEvenAfterRollbackOrMissingWrapper() {
    for (state in listOf(W1RecoveryRefusal.State.RETIRING,
      W1RecoveryRefusal.State.RETIRED)) {
      val outcome = evaluate(snapshot(state), present = false)
      assertEquals(W1RecoveryRefusal.Outcome.RETIRED_PERMANENT, outcome)
      val e = assertThrows(W1ResearchGate.Refused::class.java) { model.requireUsable(outcome) }
      assertEquals(W1ResearchGate.RefusalCode.RETIREMENT_IS_FINAL, e.code)
    }
  }

  @Test fun missingAndInvalidatedWrapperHaveDifferentFatalReasons() {
    assertEquals(W1RecoveryRefusal.Outcome.WRAPPER_MISSING,
      evaluate(snapshot(W1RecoveryRefusal.State.ACTIVE), present = false))
    assertEquals(W1RecoveryRefusal.Outcome.WRAPPER_INVALIDATED,
      evaluate(snapshot(W1RecoveryRefusal.State.ACTIVE), invalidated = true))
  }

  @Test fun staleEpochAndConflictingTransactionNeverRecover() {
    assertEquals(W1RecoveryRefusal.Outcome.STALE_EPOCH,
      evaluate(snapshot(W1RecoveryRefusal.State.ACTIVE, epoch = 7)))
    assertEquals(W1RecoveryRefusal.Outcome.CONFLICTING_OPERATION,
      evaluate(snapshot(W1RecoveryRefusal.State.ACTIVE, op = "older-transaction")))
    assertEquals(W1RecoveryRefusal.Outcome.CONFLICTING_OPERATION,
      evaluate(snapshot(W1RecoveryRefusal.State.ACTIVE), op = "replayed-transaction"))
  }

  @Test fun failedAliasDeletionOrOrphanStateMustQuarantine() {
    assertEquals(W1RecoveryRefusal.Outcome.QUARANTINE_FAILED_CLEANUP,
      evaluate(snapshot(W1RecoveryRefusal.State.ACTIVE, cleanupFailure = true)))
    assertEquals(W1RecoveryRefusal.Outcome.QUARANTINE_FAILED_CLEANUP,
      evaluate(snapshot(W1RecoveryRefusal.State.QUARANTINED)))
  }

  @Test fun emptyIdentityNeverAutoGeneratesReplacement() {
    val outcome = evaluate(snapshot(W1RecoveryRefusal.State.ABSENT))
    assertEquals(W1RecoveryRefusal.Outcome.EMPTY, outcome)
    assertThrows(W1ResearchGate.Refused::class.java) { model.requireUsable(outcome) }
  }
}
