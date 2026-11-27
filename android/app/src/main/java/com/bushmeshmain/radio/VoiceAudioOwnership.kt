package com.bushmeshmain.radio

/** All access on Android's main looper. Playback and microphone capture
 * are mutually exclusive; critical speech can interrupt the current lease. */
internal object VoiceAudioOwnership {
  val microphone = VoiceMicrophoneOwnership()
  var speaking = false
  var critical = false

  val microphoneBusy: Boolean get() = microphone.busy

  fun interruptRecognition() {
    microphone.interrupt()
  }
}
