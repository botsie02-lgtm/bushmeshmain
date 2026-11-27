package com.bushmeshmain.radio

import android.speech.SpeechRecognizer
import org.junit.Assert.*
import org.junit.Test

class OfflineRecognitionPolicyTest {
  @Test fun exactInstalledLanguageWins() {
    assertEquals("installed", offlineLanguageStatus("en-AU", listOf("en-au"), listOf("en-AU"), listOf("en-AU")))
    assertEquals("unknown", offlineLanguageStatus("en-AU", listOf("en-US"), emptyList(), emptyList()))
    assertEquals("pending", offlineLanguageStatus("en-AU", emptyList(), listOf("en-AU"), listOf("en-AU")))
    assertEquals("download-required", offlineLanguageStatus("en-AU", emptyList(), emptyList(), listOf("en-AU")))
  }
  @Test fun englishAlternativesAreExplicitlyValid() {
    assertTrue(isEnglishRecognitionLocale("en-NZ"))
    assertTrue(isEnglishRecognitionLocale("en-US"))
    assertFalse(isEnglishRecognitionLocale("fr-FR"))
    assertFalse(isEnglishRecognitionLocale("en_US"))
  }
  @Test fun providerErrorsAreDistinct() {
    assertEquals("LANGUAGE_UNAVAILABLE", recognitionFailure(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE, "en-AU").first)
    assertEquals("LANGUAGE_NOT_SUPPORTED", recognitionFailure(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, "en-AU").first)
    assertEquals("PERMISSION", recognitionFailure(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS, "en-AU").first)
    assertEquals("AUDIO", recognitionFailure(SpeechRecognizer.ERROR_AUDIO, "en-AU").first)
    assertEquals("TIMEOUT", recognitionFailure(SpeechRecognizer.ERROR_SPEECH_TIMEOUT, "en-AU").first)
    assertEquals("UNAVAILABLE", recognitionFailure(SpeechRecognizer.ERROR_SERVER_DISCONNECTED, "en-AU").first)
  }
}
