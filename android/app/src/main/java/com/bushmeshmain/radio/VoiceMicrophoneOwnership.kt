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
  private var finished = false

  fun markReady() {
    if (!finished) ready = true
  }

  fun finish(id: String, cancel: Boolean): Finish {
    if (id != requestId || finished) return Finish.IGNORE
    finished = true
    return if (cancel || !ready) Finish.CANCEL else Finish.STOP
  }
}
