package com.bushmeshmain.radio

/**
 * Main-looper-confined lease; a delayed callback can only release its own
 * microphone, never another turn or a future keyword detector.
 * No engine, recording, transport or automatic restart is owned here.
 */
internal class VoiceMicrophoneOwnership {
  enum class Kind { COMMAND, HOLD_TO_TALK, WAKE_DETECTOR }
  data class Lease internal constructor(val generation: Long, val kind: Kind)

  private var sequence = 0L
  private var lease: Lease? = null
  private var cancellation: (() -> Unit)? = null

  val owner: Kind? get() = lease?.kind
  val busy: Boolean get() = lease != null

  fun claim(kind: Kind, playbackBusy: Boolean, cancel: () -> Unit): Lease? {
    if (playbackBusy || lease != null) return null
    val next = Lease(++sequence, kind)
    lease = next
    cancellation = cancel
    return next
  }

  fun owns(candidate: Lease?): Boolean = candidate != null && lease === candidate

  fun release(candidate: Lease?) {
    if (!owns(candidate)) return
    lease = null
    cancellation = null
  }

  /** Cancellation must release the lease before playback can start. */
  fun interrupt() {
    cancellation?.invoke()
  }
}

/** One explicit held turn; no restart or release of a different request. */
internal class VoiceHeldTurn(val requestId: String) {
  enum class Finish { IGNORE, CANCEL, STOP }
  private var ready = false
  private var stopRequested = false
  private var cancelled = false

  fun markReady() {
    if (!cancelled && !stopRequested) ready = true
  }

  fun finish(id: String, cancel: Boolean): Finish {
    if (id != requestId || cancelled) return Finish.IGNORE
    // A cancel after release must still terminate the pending final result.
    if (cancel || !ready) {
      cancelled = true
      return Finish.CANCEL
    }
    if (stopRequested) return Finish.IGNORE
    stopRequested = true
    return Finish.STOP
  }
}
