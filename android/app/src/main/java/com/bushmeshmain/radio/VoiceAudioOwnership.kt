package com.bushmeshmain.radio

/** All access on Android's main looper. No microphone or ordinary playback
 * may overlap; critical speech may cancel recognition. */
internal object VoiceAudioOwnership {
  var cancelRecognition: (() -> Unit)? = null
  var speaking = false
  var critical = false
}
