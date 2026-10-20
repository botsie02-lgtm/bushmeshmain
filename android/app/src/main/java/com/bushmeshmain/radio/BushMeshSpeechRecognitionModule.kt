package com.bushmeshmain.radio

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.Locale

/**
 * Strictly on-device speech recognition for Bushmesh PTT dictation.
 *
 * This module never falls back to the platform's network recognizer. Android
 * must advertise an on-device recognizer (API 31+) or Bushmesh reports STT as
 * unavailable. The recognition result is returned only after speech ends or JS
 * explicitly calls stopListening(), so the caller can keep transmission as a
 * separate deliberate action.
 */
class BushMeshSpeechRecognitionModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), RecognitionListener {

  companion object {
    private const val MIN_SUPPORTED_API = Build.VERSION_CODES.S
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var activePromise: Promise? = null
  private var listening = false
  private var startedAtMs = 0L

  override fun getName(): String = "BushMeshSpeechRecognition"

  @ReactMethod
  fun getStatus(promise: Promise) {
    mainHandler.post {
      try {
        val supported = isOnDeviceAvailable()
        val result = Arguments.createMap().apply {
          putBoolean("supported", supported)
          putBoolean("listening", listening)
          putDouble("apiLevel", Build.VERSION.SDK_INT.toDouble())
          putString(
            "reason",
            when {
              Build.VERSION.SDK_INT < MIN_SUPPORTED_API ->
                "Android ${MIN_SUPPORTED_API}+ is required for strict on-device recognition."
              !supported -> "No on-device speech recognizer is installed on this device."
              else -> null
            },
          )
        }
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("BUSHMESH_STT_STATUS_FAILED", error.message, error)
      }
    }
  }

  /**
   * Starts one PTT recognition turn. The Promise resolves with the final
   * transcript after speech ends or stopListening() is called.
   */
  @ReactMethod
  fun recognizeOnce(localeTag: String?, promise: Promise) {
    mainHandler.post {
      if (!isOnDeviceAvailable()) {
        promise.reject(
          "BUSHMESH_STT_UNAVAILABLE",
          "Strict on-device speech recognition is unavailable on this Android device.",
        )
        return@post
      }

      if (activePromise != null || listening) {
        promise.reject(
          "BUSHMESH_STT_BUSY",
          "Bushmesh speech recognition is already listening.",
        )
        return@post
      }

      try {
        val engine = ensureRecognizer()
        val locale = localeTag
          ?.trim()
          ?.takeIf { it.isNotEmpty() }
          ?: Locale.getDefault().toLanguageTag()

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
          )
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, locale)
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
          putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
          putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }

        activePromise = promise
        listening = true
        startedAtMs = System.currentTimeMillis()
        engine.startListening(intent)
      } catch (error: Exception) {
        activePromise = null
        listening = false
        startedAtMs = 0L
        promise.reject("BUSHMESH_STT_START_FAILED", error.message, error)
      }
    }
  }

  @ReactMethod
  fun stopListening(promise: Promise) {
    mainHandler.post {
      try {
        if (!listening) {
          promise.resolve(false)
          return@post
        }
        recognizer?.stopListening()
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("BUSHMESH_STT_STOP_FAILED", error.message, error)
      }
    }
  }

  @ReactMethod
  fun cancel(promise: Promise) {
    mainHandler.post {
      try {
        recognizer?.cancel()
        rejectActive("BUSHMESH_STT_CANCELLED", "Speech recognition was cancelled.")
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("BUSHMESH_STT_CANCEL_FAILED", error.message, error)
      }
    }
  }

  override fun onReadyForSpeech(params: Bundle?) = Unit

  override fun onBeginningOfSpeech() = Unit

  override fun onRmsChanged(rmsdB: Float) = Unit

  override fun onBufferReceived(buffer: ByteArray?) = Unit

  override fun onEndOfSpeech() {
    listening = false
  }

  override fun onError(error: Int) {
    listening = false
    val code = when (error) {
      SpeechRecognizer.ERROR_AUDIO -> "AUDIO"
      SpeechRecognizer.ERROR_CLIENT -> "CLIENT"
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "PERMISSION"
      SpeechRecognizer.ERROR_NETWORK -> "NETWORK"
      SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "NETWORK_TIMEOUT"
      SpeechRecognizer.ERROR_NO_MATCH -> "NO_MATCH"
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "BUSY"
      SpeechRecognizer.ERROR_SERVER -> "SERVER"
      SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "SPEECH_TIMEOUT"
      SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "TOO_MANY_REQUESTS"
      else -> "ERROR_$error"
    }

    val detail = when (error) {
      SpeechRecognizer.ERROR_NO_MATCH -> "No clear speech was recognized."
      SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech was heard before the on-device recognizer timed out."
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required for Bushmesh PTT."
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "The on-device speech recognizer is busy."
      SpeechRecognizer.ERROR_NETWORK,
      SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
        "The on-device recognizer unexpectedly requested network access; Bushmesh will not fall back to cloud speech."
      else -> "On-device speech recognition failed ($code)."
    }

    rejectActive("BUSHMESH_STT_$code", detail)
  }

  override fun onResults(results: Bundle?) {
    listening = false
    val matches = results
      ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
      ?.map { it.trim() }
      ?.filter { it.isNotEmpty() }
      .orEmpty()

    val confidences = results?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
    val promise = activePromise ?: return
    activePromise = null

    if (matches.isEmpty()) {
      startedAtMs = 0L
      promise.reject("BUSHMESH_STT_NO_MATCH", "No clear speech was recognized.")
      return
    }

    val result = Arguments.createMap().apply {
      putString("text", matches.first())
      putDouble(
        "confidence",
        confidences?.firstOrNull()?.takeIf { it >= 0f }?.toDouble() ?: -1.0,
      )
      putDouble("durationMs", (System.currentTimeMillis() - startedAtMs).coerceAtLeast(0L).toDouble())
      val alternatives = Arguments.createArray()
      matches.drop(1).take(2).forEach(alternatives::pushString)
      putArray("alternatives", alternatives)
    }
    startedAtMs = 0L
    promise.resolve(result)
  }

  override fun onPartialResults(partialResults: Bundle?) = Unit

  override fun onEvent(eventType: Int, params: Bundle?) = Unit

  override fun invalidate() {
    mainHandler.post {
      try {
        recognizer?.cancel()
        recognizer?.destroy()
      } finally {
        recognizer = null
        listening = false
        startedAtMs = 0L
        rejectActive(
          "BUSHMESH_STT_INVALIDATED",
          "Bushmesh speech recognition was shut down.",
        )
      }
    }
    super.invalidate()
  }

  private fun isOnDeviceAvailable(): Boolean {
    return Build.VERSION.SDK_INT >= MIN_SUPPORTED_API &&
      SpeechRecognizer.isOnDeviceRecognitionAvailable(reactApplicationContext)
  }

  private fun ensureRecognizer(): SpeechRecognizer {
    val existing = recognizer
    if (existing != null) {
      return existing
    }

    if (Build.VERSION.SDK_INT < MIN_SUPPORTED_API) {
      throw IllegalStateException("On-device recognition requires Android 12 or newer.")
    }

    return SpeechRecognizer
      .createOnDeviceSpeechRecognizer(reactApplicationContext)
      .also {
        it.setRecognitionListener(this)
        recognizer = it
      }
  }

  private fun rejectActive(code: String, message: String) {
    val promise = activePromise ?: return
    activePromise = null
    startedAtMs = 0L
    promise.reject(code, message)
  }
}
