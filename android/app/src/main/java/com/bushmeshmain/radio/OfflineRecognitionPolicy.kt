package com.bushmeshmain.radio

import android.speech.SpeechRecognizer
import java.util.Locale

internal fun isEnglishRecognitionLocale(tag: String): Boolean =
  tag.length in 2..35 && tag.matches(Regex("[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*")) &&
    Locale.forLanguageTag(tag).language == "en"

internal fun offlineLanguageStatus(locale: String, installed: List<String>, pending: List<String>,
                                   downloadable: List<String>): String {
  fun matches(values: List<String>) = values.any { it.equals(locale, ignoreCase = true) }
  return when {
    matches(installed) -> "installed"
    matches(pending) -> "pending"
    matches(downloadable) -> "download-required"
    // A provider's incomplete response is not proof of unsupported language.
    else -> "unknown"
  }
}

internal fun recognitionFailure(error: Int, locale: String): Pair<String, String> = when (error) {
  SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "LANGUAGE_UNAVAILABLE" to
    "$locale offline model unavailable. Open Voice assistant readiness to download it or select an installed English model."
  SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "LANGUAGE_NOT_SUPPORTED" to
    "$locale is not supported by this on-device recognizer. Open Voice assistant readiness and select an installed English model."
  SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "PERMISSION" to
    "Microphone permission denied. Allow microphone access in Android app settings."
  SpeechRecognizer.ERROR_AUDIO -> "AUDIO" to
    "Microphone audio failed. Check the microphone, Bluetooth audio route and other recording apps."
  SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "TIMEOUT" to "No speech detected before timeout. Retry and speak after listening starts."
  SpeechRecognizer.ERROR_NO_MATCH -> "NO_MATCH" to "No speech matched. Speak clearly and retry."
  SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "BUSY" to "On-device recognizer busy. Stop other speech and retry."
  SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "OFFLINE_PROVIDER" to
    "On-device provider could not complete recognition offline. Check the installed model in Voice assistant readiness. No cloud fallback."
  SpeechRecognizer.ERROR_SERVER_DISCONNECTED, SpeechRecognizer.ERROR_SERVER -> "UNAVAILABLE" to
    "On-device recognition service disconnected or failed. Refresh Voice assistant readiness."
  else -> "RECOGNITION" to "On-device recognition failed (code $error). Open Voice assistant readiness and retry."
}
