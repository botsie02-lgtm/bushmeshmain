package com.bushmeshmain.radio

import org.junit.Assert.*
import org.junit.Test

class VoiceMicrophoneOwnershipTest {
  @Test fun explicitClaimAndPlaybackExclusion() {
    val owner = VoiceMicrophoneOwnership()
    assertNull(owner.owner)
    assertNull(owner.claim(VoiceMicrophoneOwnership.Kind.COMMAND, true) {})
    val lease = owner.claim(VoiceMicrophoneOwnership.Kind.HOLD_TO_TALK, false) {}
    assertNotNull(lease)
    assertTrue(owner.owns(lease))
    assertNull(owner.claim(VoiceMicrophoneOwnership.Kind.COMMAND, false) {})
    owner.release(lease)
    assertFalse(owner.busy)
  }

  @Test fun staleLeaseCannotReleaseNewTurn() {
    val owner = VoiceMicrophoneOwnership()
    val first = owner.claim(VoiceMicrophoneOwnership.Kind.COMMAND, false) {}
    owner.release(first)
    val second = owner.claim(VoiceMicrophoneOwnership.Kind.HOLD_TO_TALK, false) {}
    assertNotNull(second)
    owner.release(first)
    assertTrue(owner.owns(second))
    owner.release(second)
    assertFalse(owner.busy)
  }

  @Test fun criticalInterruptionCancelsCurrentOwnerOnlyAndDoesNotRestart() {
    val owner = VoiceMicrophoneOwnership()
    var cancelled = 0
    var lease: VoiceMicrophoneOwnership.Lease? = null
    lease = owner.claim(VoiceMicrophoneOwnership.Kind.COMMAND, false) {
      cancelled++
      owner.release(lease)
    }
    owner.interrupt()
    owner.interrupt()
    assertEquals(1, cancelled)
    assertFalse(owner.busy)
    assertNull(owner.claim(VoiceMicrophoneOwnership.Kind.HOLD_TO_TALK, true) {})
  }

  @Test fun repeatedStartStopDoesNotRetainAnOwner() {
    val owner = VoiceMicrophoneOwnership()
    repeat(100) {
      val turn = owner.claim(VoiceMicrophoneOwnership.Kind.HOLD_TO_TALK, false) {}
      assertNotNull(turn)
      owner.release(turn)
      assertFalse(owner.busy)
    }
  }

  @Test fun earlyReleaseCancelsAndLateReadinessCannotResurrect() {
    val turn = VoiceHeldTurn("first")
    assertEquals(VoiceHeldTurn.Finish.IGNORE, turn.finish("other", false))
    assertEquals(VoiceHeldTurn.Finish.CANCEL, turn.finish("first", false))
    turn.markReady()
    assertEquals(VoiceHeldTurn.Finish.IGNORE, turn.finish("first", false))
  }

  @Test fun readyReleaseStopsExactlyOnceAndCanStillBeCancelled() {
    val turn = VoiceHeldTurn("second")
    turn.markReady()
    assertEquals(VoiceHeldTurn.Finish.STOP, turn.finish("second", false))
    assertEquals(VoiceHeldTurn.Finish.IGNORE, turn.finish("second", false))
    assertEquals(VoiceHeldTurn.Finish.CANCEL, turn.finish("second", true))
    assertEquals(VoiceHeldTurn.Finish.IGNORE, turn.finish("second", true))
  }
}
