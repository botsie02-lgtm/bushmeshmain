package com.bushmeshmain

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.Locale

class BushMeshVoiceModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val mainHandler = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var recognitionPromise: Promise? = null
  private var textToSpeech: TextToSpeech? = null
  private var ttsReady = false

  init {
    mainHandler.post {
      textToSpeech = TextToSpeech(reactApplicationContext.applicationContext) { status ->
        ttsReady = status == TextToSpeech.SUCCESS
        if (ttsReady) {
          textToSpeech?.language = Locale.getDefault()
        }
      }
    }
  }

  override fun getName(): String = "BushMeshVoice"

  @ReactMethod
  fun recognizeOnce(promise: Promise) {
    if (
      android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M &&
        reactApplicationContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) !=
          PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject(
        "VOICE_PERMISSION",
        "Microphone permission is required for local speech recognition.",
      )
      return
    }

    if (!SpeechRecognizer.isRecognitionAvailable(reactApplicationContext)) {
      promise.reject(
        "VOICE_UNAVAILABLE",
        "Speech recognition is not available on this Android device.",
      )
      return
    }

    mainHandler.post {
      if (recognitionPromise != null) {
        promise.reject("VOICE_BUSY", "BushMesh speech recognition is already active.")
        return@post
      }

      recognitionPromise = promise
      destroyRecognizer()
      recognizer = SpeechRecognizer.createSpeechRecognizer(reactApplicationContext).also {
        it.setRecognitionListener(object : RecognitionListener {
          override fun onReadyForSpeech(params: Bundle?) = Unit
          override fun onBeginningOfSpeech() = Unit
          override fun onRmsChanged(rmsdB: Float) = Unit
          override fun onBufferReceived(buffer: ByteArray?) = Unit
          override fun onEndOfSpeech() = Unit
          override fun onPartialResults(partialResults: Bundle?) = Unit
          override fun onEvent(eventType: Int, params: Bundle?) = Unit

          override fun onError(error: Int) {
            finishRecognitionError(
              "VOICE_RECOGNITION_ERROR",
              "Android speech recognition failed with error code $error.",
            )
          }

          override fun onResults(results: Bundle?) {
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val transcript = matches?.firstOrNull()?.trim().orEmpty()

            if (transcript.isEmpty()) {
              finishRecognitionError(
                "VOICE_EMPTY",
                "Speech recognition did not return a transcript.",
              )
              return
            }

            val response = Arguments.createMap().apply {
              putString("text", transcript)
              val confidence = results
                ?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
                ?.firstOrNull()
              if (confidence != null && confidence >= 0f) {
                putDouble("confidence", confidence.toDouble())
              }
            }

            val pending = recognitionPromise
            recognitionPromise = null
            destroyRecognizer()
            pending?.resolve(response)
          }
        })
      }

      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(
          RecognizerIntent.EXTRA_LANGUAGE_MODEL,
          RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
        )
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      }

      recognizer?.startListening(intent)
    }
  }

  @ReactMethod
  fun cancelRecognition(promise: Promise) {
    mainHandler.post {
      recognizer?.cancel()
      val pending = recognitionPromise
      recognitionPromise = null
      destroyRecognizer()
      pending?.reject("VOICE_CANCELLED", "Speech recognition was cancelled.")
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun speak(text: String, promise: Promise) {
    val clean = text.trim()
    if (clean.isEmpty()) {
      promise.resolve(null)
      return
    }

    mainHandler.post {
      val engine = textToSpeech
      if (!ttsReady || engine == null) {
        promise.reject("VOICE_TTS_UNAVAILABLE", "Text-to-speech is not ready.")
        return@post
      }

      val result = engine.speak(
        clean,
        TextToSpeech.QUEUE_FLUSH,
        null,
        "bushmesh-${System.currentTimeMillis()}",
      )
      if (result == TextToSpeech.ERROR) {
        promise.reject("VOICE_TTS_ERROR", "Android text-to-speech rejected the utterance.")
      } else {
        promise.resolve(null)
      }
    }
  }

  @ReactMethod
  fun stopSpeaking(promise: Promise) {
    mainHandler.post {
      textToSpeech?.stop()
      promise.resolve(null)
    }
  }

  private fun finishRecognitionError(code: String, message: String) {
    val pending = recognitionPromise
    recognitionPromise = null
    destroyRecognizer()
    pending?.reject(code, message)
  }

  private fun destroyRecognizer() {
    recognizer?.destroy()
    recognizer = null
  }

  override fun invalidate() {
    mainHandler.post {
      recognitionPromise?.reject(
        "VOICE_INVALIDATED",
        "BushMesh voice module was invalidated.",
      )
      recognitionPromise = null
      destroyRecognizer()
      textToSpeech?.stop()
      textToSpeech?.shutdown()
      textToSpeech = null
      ttsReady = false
    }
    super.invalidate()
  }
}
