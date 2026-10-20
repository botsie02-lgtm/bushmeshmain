package com.bushmeshmain.radio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
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
    private const val PREF_RADIO_MESSAGES_ENABLED = "radio_messages_enabled"
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private val audioManager =
    reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val speechAudioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()
  private val focusChangeListener = AudioManager.OnAudioFocusChangeListener {
    // Bushmesh requests only transient may-duck focus. The system owns actual
    // media-volume behavior; visual safety alerts remain primary if focus fails.
  }

  private var engine: TextToSpeech? = null
  private var initComplete = false
  private var initFailed = false
  private var selectedLanguage: Locale? = null
  private var activeFocusRequest: AudioFocusRequest? = null

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

    tts.setAudioAttributes(speechAudioAttributes)
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) = Unit

      override fun onDone(utteranceId: String?) {
        mainHandler.post { abandonSpeechFocus() }
      }

      @Deprecated("Deprecated in Android framework but still required by the listener contract")
      override fun onError(utteranceId: String?) {
        mainHandler.post { abandonSpeechFocus() }
      }

      override fun onError(utteranceId: String?, errorCode: Int) {
        mainHandler.post { abandonSpeechFocus() }
      }

      override fun onStop(utteranceId: String?, interrupted: Boolean) {
        mainHandler.post { abandonSpeechFocus() }
      }
    })

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

    withReady(promise) { tts ->
      val queueMode =
        if (interrupt) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
      val utteranceId = "bushmesh-${System.currentTimeMillis()}"

      requestSpeechFocus()
      val result = tts.speak(clean, queueMode, null, utteranceId)
      if (result == TextToSpeech.ERROR) {
        abandonSpeechFocus()
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
        abandonSpeechFocus()
        promise.resolve(true)
      } catch (error: Exception) {
        abandonSpeechFocus()
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
        putBoolean("radioMessagesEnabled", radioMessagesEnabled())
      }
      promise.resolve(status)
    }
  }

  @ReactMethod
  fun setCriticalAlertsEnabled(enabled: Boolean, promise: Promise) {
    try {
      preferences()
        .edit()
        .putBoolean(PREF_CRITICAL_ALERTS_ENABLED, enabled)
        .apply()

      if (!enabled) {
        mainHandler.post {
          engine?.stop()
          abandonSpeechFocus()
        }
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

  @ReactMethod
  fun setRadioMessagesEnabled(enabled: Boolean, promise: Promise) {
    try {
      preferences()
        .edit()
        .putBoolean(PREF_RADIO_MESSAGES_ENABLED, enabled)
        .apply()
      promise.resolve(enabled)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_TTS_PREF_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun getRadioMessagesEnabled(promise: Promise) {
    try {
      promise.resolve(radioMessagesEnabled())
    } catch (error: Exception) {
      promise.reject("BUSHMESH_TTS_PREF_FAILED", error.message, error)
    }
  }

  override fun invalidate() {
    mainHandler.post {
      try {
        engine?.stop()
        engine?.shutdown()
        abandonSpeechFocus()
      } finally {
        engine = null
        selectedLanguage = null
        initComplete = false
        initFailed = false
      }
    }
    super.invalidate()
  }

  private fun preferences() =
    reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun criticalAlertsEnabled(): Boolean =
    preferences().getBoolean(PREF_CRITICAL_ALERTS_ENABLED, true)

  private fun radioMessagesEnabled(): Boolean =
    preferences().getBoolean(PREF_RADIO_MESSAGES_ENABLED, false)

  private fun requestSpeechFocus(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(speechAudioAttributes)
        .setOnAudioFocusChangeListener(focusChangeListener, mainHandler)
        .setWillPauseWhenDucked(false)
        .build()
      activeFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
      activeFocusRequest = request
      audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(
        focusChangeListener,
        AudioManager.STREAM_MUSIC,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
      ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }
  }

  private fun abandonSpeechFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      activeFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
      activeFocusRequest = null
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(focusChangeListener)
    }
  }

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