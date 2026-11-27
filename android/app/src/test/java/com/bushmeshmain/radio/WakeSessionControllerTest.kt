package com.bushmeshmain.radio

import org.junit.Assert.*
import org.junit.Test

/** Synthetic controller tests only; no recorded audio or actual detector inference. */
class WakeSessionControllerTest {
  private class Capture : WakeCapture {
    lateinit var callback: (WakeCaptureEvent) -> Unit
    var starts = 0
    var stops = 0
    var autoReady = true
    var release = true
    override var drained = true
    override fun start(callback: (WakeCaptureEvent) -> Unit) {
      this.callback = callback; starts++
      if (autoReady) callback(WakeCaptureEvent.Ready)
    }
    override fun stop(): Boolean { stops++; return release }
    fun wake() = callback(WakeCaptureEvent.Detected(0.93))
  }
  private class Fixture {
    var time = 1000L
    var e = WakeEligibility(true, true, true, false, true)
    val mic = VoiceMicrophoneOwnership()
    val playback = VoicePlaybackOwnership()
    val captures = mutableListOf<Capture>()
    val events = mutableListOf<WakeSnapshot>()
    var configure: (Capture) -> Unit = {}
    val session = WakeSessionController("session", mic, playback, { time }, { e },
      { Capture().also { configure(it); captures.add(it) } }, { events.add(it) })
    fun advance(ms: Long = 1000) { time += ms; session.tick() }
    fun start() { assertTrue(session.activate()); assertEquals(WakePhase.LISTENING, session.snapshot().phase) }
    fun stopped(reason: WakeReason) {
      assertEquals(WakePhase.STOPPED, session.snapshot().phase)
      assertEquals(reason, session.snapshot().reason)
      assertFalse(session.snapshot().captureActive)
      assertNull(session.snapshot().handover)
    }
  }

  @Test fun explicitGrantIsSingleUseExpiresAndDoesNotSurviveNewProcess() {
    var now = 100L
    val gate = WakeStartGate<String> { now }
    assertNull(gate.consume("old"))
    assertTrue(gate.issue("one", "owner"))
    assertFalse(gate.issue("two", "other"))
    assertNull(gate.consume("two"))
    assertEquals("owner", gate.consume("one"))
    assertNull(gate.consume("one"))
    assertTrue(gate.issue("three", "owner"))
    now += 5000
    assertNull(gate.consume("three"))
    assertTrue(gate.issue("four", "owner"))
    gate.clear()
    assertNull(gate.consume("four"))
    assertNull(WakeStartGate<String> { now }.consume("four"))
  }

  @Test fun noImplicitStartAndModelPermissionForegroundGates() {
    val cold = Fixture()
    cold.advance(); assertTrue(cold.captures.isEmpty())
    for ((eligibility, reason) in listOf(
      cold.e.copy(permission = false) to WakeReason.PERMISSION_LOST,
      cold.e.copy(notification = false) to WakeReason.NOTIFICATION_UNAVAILABLE,
      cold.e.copy(modelReady = false) to WakeReason.MODEL_UNAVAILABLE,
      cold.e.copy(foreground = false) to WakeReason.FOREGROUND_REQUIRED,
      cold.e.copy(callActive = true) to WakeReason.CALL_ACTIVE
    )) {
      val f = Fixture(); f.e = eligibility
      assertFalse(f.session.activate()); f.stopped(reason)
      assertTrue(f.captures.isEmpty()); assertFalse(f.mic.busy)
    }
  }

  @Test fun actualLeaseIsReleasedBeforeHandoverAndOnlyMatchingKeyCanRearm() {
    val f = Fixture(); f.start()
    val old = f.captures.single()
    assertEquals(VoiceMicrophoneOwnership.Kind.WAKE_DETECTOR, f.mic.owner)
    old.wake()
    val key = checkNotNull(f.session.snapshot().handover)
    assertEquals(WakePhase.HANDOVER, f.session.snapshot().phase)
    assertEquals(1, old.stops); assertFalse(f.mic.busy)
    assertFalse(f.session.claimHandover(key.copy(sequence = 2)))
    assertTrue(f.session.claimHandover(key)); assertFalse(f.session.claimHandover(key))
    assertTrue(f.session.ownsHandover(key))
    val turn = f.mic.claim(VoiceMicrophoneOwnership.Kind.COMMAND, false) {}
    assertNotNull(turn)
    old.wake(); f.advance()
    assertEquals(1L, f.session.snapshot().acceptedWakes)
    assertEquals(1, f.captures.size)
    assertFalse(f.session.completeHandover(key.copy(sessionId = "other")))
    assertTrue(f.session.completeHandover(key))
    assertFalse(f.session.ownsHandover(key))
    f.advance(); assertEquals(1, f.captures.size)
    f.mic.release(turn)
    f.advance(); assertEquals(2, f.captures.size)
    old.wake(); assertEquals(1L, f.session.snapshot().acceptedWakes)
  }

  @Test fun playbackAndCriticalInterruptionWaitForReleaseAndQuietTail() {
    val f = Fixture(); f.start()
    val first = f.captures.single()
    f.mic.interrupt()
    assertFalse(f.mic.busy); assertEquals(1, first.stops)
    assertEquals(WakePhase.SUSPENDED, f.session.snapshot().phase)
    val speech = f.playback.claim(true, f.mic.busy) {}
    assertNotNull(speech)
    f.advance(500); first.wake()
    assertNull(f.session.snapshot().handover)
    f.playback.release(speech)
    f.advance(749); assertEquals(1, f.captures.size)
    f.advance(1); assertEquals(2, f.captures.size)
  }

  @Test fun foregroundLossInvalidatesHandoverAndDoesNotListenUntilForeground() {
    val f = Fixture(); f.start(); f.captures.single().wake()
    val key = checkNotNull(f.session.snapshot().handover)
    assertTrue(f.session.claimHandover(key))
    f.e = f.e.copy(foreground = false); f.advance()
    assertNull(f.session.snapshot().handover); assertFalse(f.session.ownsHandover(key))
    assertFalse(f.mic.busy); assertEquals(WakeReason.FOREGROUND_REQUIRED, f.session.snapshot().reason)
    f.advance(10000); assertEquals(1, f.captures.size)
    f.e = f.e.copy(foreground = true); f.advance()
    assertEquals(2, f.captures.size)
  }

  @Test fun revokedPermissionCallFocusRouteAndStopAreTerminal() {
    for (reason in listOf(WakeReason.PERMISSION_LOST, WakeReason.CALL_ACTIVE,
      WakeReason.FOCUS_LOST, WakeReason.ROUTE_CHANGED, WakeReason.STOP_REQUESTED,
      WakeReason.INVALIDATED, WakeReason.SERVICE_DESTROYED)) {
      val f = Fixture(); f.start(); val old = f.captures.single()
      when (reason) {
        WakeReason.PERMISSION_LOST -> { f.e = f.e.copy(permission = false); f.advance() }
        WakeReason.CALL_ACTIVE -> { f.e = f.e.copy(callActive = true); f.advance() }
        WakeReason.FOCUS_LOST, WakeReason.ROUTE_CHANGED -> old.callback(WakeCaptureEvent.Failed(reason))
        else -> f.session.stop(reason)
      }
      f.stopped(reason); assertFalse(f.mic.busy)
      f.e = WakeEligibility(true, true, true, false, true)
      old.wake(); f.advance(120000)
      assertFalse(f.session.activate()); assertEquals(1, f.captures.size)
    }
  }

  @Test fun startupDrainHandoverTimeoutAndInvalidConfidenceFailClosed() {
    val startup = Fixture(); startup.configure = { it.autoReady = false }
    assertTrue(startup.session.activate()); startup.advance(10000)
    startup.stopped(WakeReason.START_TIMEOUT)
    val drain = Fixture(); drain.start(); val old = drain.captures.single(); old.drained = false
    drain.mic.interrupt(); drain.advance(9999); assertEquals(1, drain.captures.size)
    drain.advance(1); drain.stopped(WakeReason.DETECTOR_FAILED)
    val handover = Fixture(); handover.start(); handover.captures.single().wake()
    handover.advance(90000); handover.stopped(WakeReason.HANDOVER_TIMEOUT)
    val invalid = Fixture(); invalid.start()
    invalid.captures.single().callback(WakeCaptureEvent.Detected(Double.NaN))
    invalid.stopped(WakeReason.DETECTOR_FAILED)
  }

  @Test fun failedPhysicalReleaseNeverAllowsAnotherMicrophoneOrPlayback() {
    val f = Fixture(); f.start(); f.captures.single().release = false
    f.mic.interrupt()
    f.stopped(WakeReason.RELEASE_FAILED)
    assertTrue(f.mic.busy)
    assertNull(f.mic.claim(VoiceMicrophoneOwnership.Kind.COMMAND, false) {})
    assertNull(f.playback.claim(true, f.mic.busy) {})
  }

  @Test fun synchronousStopDuringStartingPublicationCannotOpenMicrophone() {
    val mic = VoiceMicrophoneOwnership()
    val playback = VoicePlaybackOwnership()
    val capture = Capture()
    lateinit var session: WakeSessionController
    session = WakeSessionController("session", mic, playback, { 1000L },
      { WakeEligibility(true, true, true, false, true) }, { capture },
      { if (it.phase == WakePhase.STARTING) session.stop(WakeReason.NOTIFICATION_UNAVAILABLE) })
    assertFalse(session.activate())
    assertEquals(0, capture.starts)
    assertFalse(mic.busy)
    assertEquals(WakePhase.STOPPED, session.snapshot().phase)
  }
}
