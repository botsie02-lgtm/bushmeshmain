package com.bushmeshmain.radio

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.Locale

class BushMeshSpeechModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), TextToSpeech.OnInitListener {

  companion object {
    private const val READY_POLL_MS = 100L
    private const val READY_MAX_ATTEMPTS = 30
    private const val PREFS_NAME = "bushmesh_speech"
    private const val PREF_CRITICAL_ALERTS_ENABLED = "critical_alerts_enabled"
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var engine: TextToSpeech? = null
  private var initComplete = false
  private var initFailed = false
  private var selectedLanguage: Locale? = null

  init {
    mainHandler.post {
      engine = TextToSpeech(reactApplicationContext.applicationContext, this)
    }
  }

  override fun getName(): String = "BushMeshSpeech"

  override fun onInit(status: Int) {
    if (status != TextToSpeech.SUCCESS) {
      initFailed = true
      initComplete = true
      return
    }

    val tts = engine ?: run {
      initFailed = true
      initComplete = true
      return
    }

    val preferred = Locale.getDefault()
    val preferredStatus = tts.setLanguage(preferred)
    val preferredSupported =
      preferredStatus != TextToSpeech.LANG_MISSING_DATA &&
        preferredStatus != TextToSpeech.LANG_NOT_SUPPORTED

    selectedLanguage = if (preferredSupported) {
      preferred
    } else {
      val englishStatus = tts.setLanguage(Locale.ENGLISH)
      val englishSupported =
        englishStatus != TextToSpeech.LANG_MISSING_DATA &&
          englishStatus != TextToSpeech.LANG_NOT_SUPPORTED
      if (englishSupported) Locale.ENGLISH else null
    }

    initFailed = selectedLanguage == null
    initComplete = true
  }

  @ReactMethod
  fun speak(text: String, interrupt: Boolean, promise: Promise) {
    val clean = text.trim()
    if (clean.isEmpty()) {
      promise.reject("BUSHMESH_TTS_EMPTY", "Speech text cannot be empty.")
      return
    }

    if (!criticalAlertsEnabled()) {
      promise.resolve(false)
      return
    }

    withReady(promise) { tts ->
      val queueMode =
        if (interrupt) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
      val utteranceId = "bushmesh-${System.currentTimeMillis()}"
      val result = tts.speak(clean, queueMode, null, utteranceId)
      if (result == TextToSpeech.ERROR) {
        promise.reject("BUSHMESH_TTS_SPEAK_FAILED", "Android TTS rejected the utterance.")
      } else {
        promise.resolve(true)
      }
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    mainHandler.post {
      try {
        engine?.stop()
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("BUSHMESH_TTS_STOP_FAILED", error.message, error)
      }
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    mainHandler.post {
      val status = Arguments.createMap().apply {
        putBoolean("initialized", initComplete && !initFailed)
        putBoolean("initializing", !initComplete)
        putBoolean("failed", initFailed)
        putString("languageTag", selectedLanguage?.toLanguageTag())
        putBoolean("criticalAlertsEnabled", criticalAlertsEnabled())
      }
      promise.resolve(status)
    }
  }

  @ReactMethod
  fun setCriticalAlertsEnabled(enabled: Boolean, promise: Promise) {
    try {
      reactApplicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(PREF_CRITICAL_ALERTS_ENABLED, enabled)
        .apply()

      if (!enabled) {
        mainHandler.post { engine?.stop() }
      }
      promise.resolve(enabled)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_TTS_PREF_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun getCriticalAlertsEnabled(promise: Promise) {
    try {
      promise.resolve(criticalAlertsEnabled())
    } catch (error: Exception) {
      promise.reject("BUSHMESH_TTS_PREF_FAILED", error.message, error)
    }
  }

  override fun invalidate() {
    mainHandler.post {
      try {
        engine?.stop()
        engine?.shutdown()
      } finally {
        engine = null
        selectedLanguage = null
        initComplete = false
        initFailed = false
      }
    }
    super.invalidate()
  }

  private fun criticalAlertsEnabled(): Boolean =
    reactApplicationContext
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(PREF_CRITICAL_ALERTS_ENABLED, true)

  private fun withReady(
    promise: Promise,
    attempt: Int = 0,
    action: (TextToSpeech) -> Unit,
  ) {
    mainHandler.post {
      if (initFailed) {
        promise.reject(
          "BUSHMESH_TTS_UNAVAILABLE",
          "Android text-to-speech is unavailable or has no usable offline voice.",
        )
        return@post
      }

      val tts = engine
      if (initComplete && tts != null) {
        action(tts)
        return@post
      }

      if (attempt >= READY_MAX_ATTEMPTS) {
        promise.reject(
          "BUSHMESH_TTS_TIMEOUT",
          "Android text-to-speech did not become ready in time.",
        )
        return@post
      }

      mainHandler.postDelayed(
        { withReady(promise, attempt + 1, action) },
        READY_POLL_MS,
      )
    }
  }
}
