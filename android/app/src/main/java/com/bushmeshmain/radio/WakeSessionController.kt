package com.bushmeshmain.radio

/** All controller and lease operations are main-looper confined. */
internal enum class WakePhase { STARTING, LISTENING, SUSPENDED, HANDOVER, STOPPED }
internal enum class WakeReason {
  NONE, MODEL_UNAVAILABLE, PERMISSION_LOST, NOTIFICATION_UNAVAILABLE, FOREGROUND_REQUIRED,
  COMPETING_AUDIO, FOCUS_LOST, ROUTE_CHANGED, CALL_ACTIVE, CAPTURE_FAILED, DETECTOR_FAILED,
  START_TIMEOUT, HANDOVER_TIMEOUT, STOP_REQUESTED, INVALIDATED, SERVICE_DESTROYED, RELEASE_FAILED
}
internal data class WakeHandover(val sessionId: String, val sequence: Long)
internal data class WakeSnapshot(
  val sessionId: String, val phase: WakePhase, val reason: WakeReason,
  val captureGeneration: Long, val captureActive: Boolean, val handover: WakeHandover?,
  val handoverClaimed: Boolean, val captureStarts: Long, val acceptedWakes: Long
)
internal sealed interface WakeCaptureEvent {
  data object Ready : WakeCaptureEvent
  data class Detected(val confidence: Double) : WakeCaptureEvent
  data class Failed(val reason: WakeReason) : WakeCaptureEvent
}
internal interface WakeCapture {
  /** Callback on main looper, including obsolete events already queued. */
  fun start(callback: (WakeCaptureEvent) -> Unit)
  /** Synchronously stop/release audio input. False retains the microphone lease. */
  fun stop(): Boolean
  /** Worker closed the detector. Never rearm before this becomes true. */
  val drained: Boolean
}
internal data class WakeEligibility(
  val permission: Boolean, val notification: Boolean, val foreground: Boolean,
  val callActive: Boolean, val modelReady: Boolean
)

/** Process-memory, one-shot, expiring grant; never persisted across process death. */
internal class WakeStartGate<T>(private val now: () -> Long) {
  private data class Grant<T>(val key: String, val value: T, val expires: Long)
  private var grant: Grant<T>? = null
  fun issue(key: String, value: T): Boolean {
    if (peek() != null) return false
    grant = Grant(key, value, now() + 5000L)
    return true
  }
  fun peek(): T? {
    if (grant?.let { now() >= it.expires } == true) grant = null
    return grant?.value
  }
  fun consume(key: String): T? {
    val value = peek() ?: return null
    if (grant?.key != key) return null
    grant = null
    return value
  }
  fun clear() { grant = null }
}

/** One explicitly authorised service session. No retry after terminal failure. */
internal class WakeSessionController(
  private val id: String,
  private val microphone: VoiceMicrophoneOwnership,
  private val playback: VoicePlaybackOwnership,
  private val now: () -> Long,
  private val eligibility: () -> WakeEligibility,
  private val makeCapture: () -> WakeCapture,
  private val changed: (WakeSnapshot) -> Unit,
) {
  private var phase = WakePhase.SUSPENDED
  private var reason = WakeReason.NONE
  private var activated = false
  private var terminal = false
  private var generation = 0L
  private var lease: VoiceMicrophoneOwnership.Lease? = null
  private var capture: WakeCapture? = null
  private var draining: WakeCapture? = null
  private var deadline = 0L
  private var drainDeadline = 0L
  private var quietUntil = 0L
  private var handover: WakeHandover? = null
  private var claimed = false
  private var starts = 0L
  private var wakes = 0L
  private var ready = false

  fun snapshot() = WakeSnapshot(id, phase, reason, generation,
    ready && microphone.owns(lease), handover, claimed, starts, wakes)

  /** Called only after one-shot grant consumption and service promotion. */
  fun activate(): Boolean {
    if (activated || terminal) return false
    activated = true
    if (!eligibility().foreground) { stop(WakeReason.FOREGROUND_REQUIRED); return false }
    tick()
    return !terminal
  }

  private fun publish() = changed(snapshot())
  private fun transition(next: WakePhase, why: WakeReason) {
    if (phase == next && reason == why) return
    phase = next; reason = why; publish()
  }

  private fun terminateIfIneligible(e: WakeEligibility): Boolean {
    val why = when {
      !e.permission -> WakeReason.PERMISSION_LOST
      !e.notification -> WakeReason.NOTIFICATION_UNAVAILABLE
      !e.modelReady -> WakeReason.MODEL_UNAVAILABLE
      e.callActive -> WakeReason.CALL_ACTIVE
      else -> null
    }
    if (why != null) stop(why)
    return why != null
  }

  /** Service watchdog and live activity reconciliation. */
  fun tick() {
    if (!activated || terminal) return
    val e = eligibility()
    if (terminateIfIneligible(e)) return
    if (draining?.drained == true) draining = null
    if (draining != null && now() >= drainDeadline) { stop(WakeReason.DETECTOR_FAILED); return }
    if (!e.foreground) {
      // Current finite command engine cannot operate in background.
      handover = null; claimed = false
      suspendCapture(WakeReason.FOREGROUND_REQUIRED)
      return
    }
    if (phase == WakePhase.HANDOVER) {
      if (now() >= deadline) stop(WakeReason.HANDOVER_TIMEOUT)
      return
    }
    if (phase == WakePhase.STARTING) {
      if (now() >= deadline) stop(WakeReason.START_TIMEOUT)
      return
    }
    if (phase == WakePhase.LISTENING || draining != null) return
    if (microphone.busy || playback.busy) {
      quietUntil = now() + 750
      transition(WakePhase.SUSPENDED, WakeReason.COMPETING_AUDIO)
      return
    }
    if (now() < quietUntil) return
    startCapture()
  }

  private fun startCapture() {
    val turn = ++generation
    lease = microphone.claim(VoiceMicrophoneOwnership.Kind.WAKE_DETECTOR, playback.busy) {
      if (generation == turn && !terminal) suspendCapture(WakeReason.COMPETING_AUDIO)
    }
    if (lease == null) { transition(WakePhase.SUSPENDED, WakeReason.COMPETING_AUDIO); return }
    ready = false
    deadline = now() + 10_000
    try {
      val next = makeCapture()
      capture = next
      starts++
      transition(WakePhase.STARTING, WakeReason.NONE)
      next.start { event -> accept(turn, event) }
    } catch (_: Exception) { stop(WakeReason.CAPTURE_FAILED) }
  }

  private fun accept(turn: Long, event: WakeCaptureEvent) {
    if (terminal || turn != generation || !microphone.owns(lease)) return
    val e = eligibility()
    if (terminateIfIneligible(e)) return
    if (!e.foreground) { suspendCapture(WakeReason.FOREGROUND_REQUIRED); return }
    when (event) {
      WakeCaptureEvent.Ready -> if (phase == WakePhase.STARTING) {
        ready = true; transition(WakePhase.LISTENING, WakeReason.NONE)
      }
      is WakeCaptureEvent.Failed -> stop(event.reason)
      is WakeCaptureEvent.Detected -> {
        if (phase != WakePhase.LISTENING || !event.confidence.isFinite() || event.confidence !in 0.0..1.0) return
        // Invalidate queued detections BEFORE releasing the physical input.
        if (!releaseCapture()) { stop(WakeReason.RELEASE_FAILED); return }
        wakes++
        handover = WakeHandover(id, wakes); claimed = false
        deadline = now() + 90_000
        transition(WakePhase.HANDOVER, WakeReason.NONE)
      }
    }
  }

  fun claimHandover(key: WakeHandover): Boolean {
    tick()
    if (terminal || phase != WakePhase.HANDOVER || handover != key || claimed ||
      microphone.busy || playback.busy || !eligibility().foreground) return false
    claimed = true; publish(); return true
  }
  fun ownsHandover(key: WakeHandover): Boolean = !terminal && phase == WakePhase.HANDOVER &&
    claimed && handover == key && now() < deadline && eligibility().let {
      it.foreground && it.permission && it.notification && it.modelReady && !it.callActive
    }
  fun completeHandover(key: WakeHandover): Boolean {
    if (terminal || handover != key || phase != WakePhase.HANDOVER) return false
    handover = null; claimed = false; quietUntil = now() + 750
    transition(WakePhase.SUSPENDED, WakeReason.COMPETING_AUDIO)
    return true
  }

  private fun suspendCapture(why: WakeReason) {
    if (!releaseCapture()) { stop(WakeReason.RELEASE_FAILED); return }
    quietUntil = now() + 750
    transition(WakePhase.SUSPENDED, why)
  }

  private fun releaseCapture(): Boolean {
    ready = false
    if (capture != null || lease != null) generation++
    val previous = capture
    if (previous != null) {
      if (!runCatching { previous.stop() }.getOrDefault(false)) return false
      capture = null; draining = previous; drainDeadline = now() + 10_000
    }
    microphone.release(lease); lease = null
    return true
  }

  fun stop(why: WakeReason) {
    if (terminal) return
    terminal = true; handover = null; claimed = false
    val released = releaseCapture()
    transition(WakePhase.STOPPED, if (released) why else WakeReason.RELEASE_FAILED)
    // Failed physical release deliberately retains lease until process death.
  }
}
