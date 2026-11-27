package com.bushmeshmain.radio

/** All access on Android's main looper. Playback and microphone capture
 * are mutually exclusive; critical speech can interrupt the current lease. */
internal object VoiceAudioOwnership {
  val microphone = VoiceMicrophoneOwnership()
  val playback = VoicePlaybackOwnership()

  val speaking: Boolean get() = playback.busy
  val critical: Boolean get() = playback.critical
  val microphoneBusy: Boolean get() = microphone.busy

  fun interruptRecognition() {
    microphone.interrupt()
  }
}

/** Playback lease prevents an old React bridge, audio focus callback or
 * utterance completion from clearing a newer engine's ownership. */
internal class VoicePlaybackOwnership {
  data class Lease internal constructor(val generation: Long, val critical: Boolean)
  private var sequence = 0L
  private var lease: Lease? = null
  private var cancellation: (() -> Unit)? = null

  val busy: Boolean get() = lease != null
  val critical: Boolean get() = lease?.critical == true

  fun claim(critical: Boolean, microphoneBusy: Boolean, cancel: () -> Unit): Lease? {
    if (microphoneBusy || lease != null) return null
    val next = Lease(++sequence, critical)
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

  fun interrupt() {
    cancellation?.invoke()
  }
}
