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
import android.speech.tts.Voice
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
  private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (
      change == AudioManager.AUDIOFOCUS_LOSS ||
      change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
    ) {
      mainHandler.post {
        clearSpeech()
      }
    }
  }

  private var engine: TextToSpeech? = null
  private var initComplete = false
  private var initFailed = false
  private var selectedLanguage: Locale? = null
  private var activeFocusRequest: AudioFocusRequest? = null
  private val utterances = mutableMapOf<String, Promise?>()
  private val deadlines = mutableMapOf<String,Runnable>()
  private var utteranceSequence = 0L
  private var ordinaryGeneration = 0L
  private fun installedVoices(tts: TextToSpeech): List<Voice> = tts.voices.orEmpty().filter { !it.isNetworkConnectionRequired && !it.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) && it.locale.language == "en" }.sortedWith(compareBy({ it.locale.toLanguageTag() != "en-AU" }, { it.locale != Locale.getDefault() }, { it.name }))
  private fun preferredVoice(tts: TextToSpeech, name: String?): Voice? = installedVoices(tts).let { voices -> if (name.isNullOrEmpty()) voices.firstOrNull() else voices.find { it.name == name } }
  private fun recognitionLocale(): String = preferences().getString("recognition_locale", "en-AU")?.takeIf { it in listOf("en-AU", "en-GB", "en-US") } ?: "en-AU"
  private fun speechRate(): Float = preferences().getFloat("speech_rate", 1f).takeIf { it.isFinite() && it in 0.75f..1.35f } ?: 1f
  private fun finish(id: String?, success: Boolean) {
    if (id == null || !utterances.containsKey(id)) return
    deadlines.remove(id)?.let { mainHandler.removeCallbacks(it) }
    val p = utterances.remove(id)
    if (success) p?.resolve(true) else p?.reject("BUSHMESH_TTS_INTERRUPTED", "Speech did not finish.")
    if (utterances.isEmpty()) { VoiceAudioOwnership.speaking = false; VoiceAudioOwnership.critical = false; abandonSpeechFocus() }
  }
  private fun clearSpeech() {
    ordinaryGeneration++
    engine?.stop()
    for (id in utterances.keys.toList()) finish(id, false)
    VoiceAudioOwnership.speaking = false; VoiceAudioOwnership.critical = false
    abandonSpeechFocus()
  }

  init {
    mainHandler.post {
      engine = TextToSpeech(reactApplicationContext.applicationContext, this)
    }
  }

  override fun getName(): String = "BushMeshSpeech"

  override fun onInit(status: Int) { mainHandler.post { initializeSpeech(status) } }

  private fun initializeSpeech(status: Int) {
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

    val voice = preferredVoice(tts, preferences().getString("offline_voice", null)) ?: preferredVoice(tts, null)
    tts.setSpeechRate(speechRate())
    selectedLanguage = if (voice != null && tts.setVoice(voice) == TextToSpeech.SUCCESS) voice.locale else null

    tts.setAudioAttributes(speechAudioAttributes)
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) = Unit

      override fun onDone(utteranceId: String?) {
        mainHandler.post { finish(utteranceId, true) }
      }

      @Deprecated("Deprecated in Android framework but still required by the listener contract")
      override fun onError(utteranceId: String?) {
        mainHandler.post { finish(utteranceId, false) }
      }

      override fun onError(utteranceId: String?, errorCode: Int) {
        mainHandler.post { finish(utteranceId, false) }
      }

      override fun onStop(utteranceId: String?, interrupted: Boolean) {
        mainHandler.post { finish(utteranceId, false) }
      }
    })

    initFailed = selectedLanguage == null
    initComplete = true
  }

  @ReactMethod
  fun speak(text: String, interrupt: Boolean, promise: Promise) {
    enqueue(text, interrupt, false, promise)
  }
  @ReactMethod
  fun speakOrdinaryAndWait(text: String, promise: Promise) {
    enqueue(text, false, true, promise)
  }
  private fun enqueue(text: String, critical: Boolean, wait: Boolean, promise: Promise) {
    if (text.isBlank()) { promise.reject("BUSHMESH_TTS_EMPTY", "Speech text cannot be empty."); return }
    mainHandler.post {
    val generation = ordinaryGeneration
    withReady(promise) { tts ->
      if (!critical && generation != ordinaryGeneration) { promise.reject("BUSHMESH_TTS_INTERRUPTED", "Speech was cancelled."); return@withReady }
      if (!critical && (VoiceAudioOwnership.cancelRecognition != null || VoiceAudioOwnership.critical)) {
        promise.reject("BUSHMESH_TTS_BUSY", "Microphone or critical speech is active."); return@withReady
      }
      if (critical) { VoiceAudioOwnership.cancelRecognition?.invoke(); clearSpeech() }
      if (utterances.isEmpty() && !requestSpeechFocus()) { abandonSpeechFocus(); promise.reject("BUSHMESH_TTS_FOCUS", "Speech audio focus unavailable."); return@withReady }
      val id = "bushmesh-" + (++utteranceSequence)
      VoiceAudioOwnership.speaking = true
      VoiceAudioOwnership.critical = critical
      utterances[id] = if (wait) promise else null
      if (tts.speak(text.trim(), TextToSpeech.QUEUE_ADD, null, id) == TextToSpeech.ERROR) {
        finish(id, false)
        if (!wait) promise.reject("BUSHMESH_TTS_SPEAK_FAILED", "Android TTS rejected the utterance.")
      } else {
        val deadline = Runnable { if (utterances.containsKey(id)) clearSpeech() }
        deadlines[id] = deadline
        mainHandler.postDelayed(deadline, 60_000L)
        if (!wait) promise.resolve(true)
      }
    }
    }
  }
  @ReactMethod
  fun stopOrdinary(promise: Promise) {
    mainHandler.post { ordinaryGeneration++; if (!VoiceAudioOwnership.critical) clearSpeech(); promise.resolve(!VoiceAudioOwnership.critical) }
  }
  @ReactMethod
  fun stop(promise: Promise) {
    mainHandler.post { clearSpeech(); promise.resolve(true) }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    mainHandler.post {
      val status = Arguments.createMap().apply {
        putBoolean("initialized", initComplete && !initFailed)
        putBoolean("initializing", !initComplete)
        putBoolean("failed", initFailed)
        putString("languageTag", selectedLanguage?.toLanguageTag())
        putBoolean("offlineVoice", selectedLanguage != null)
        putBoolean("speaking", VoiceAudioOwnership.speaking)
        putString("recognitionLocale", recognitionLocale())
        putBoolean("criticalAlertsEnabled", criticalAlertsEnabled())
        putBoolean("radioMessagesEnabled", radioMessagesEnabled())
      }
      promise.resolve(status)
    }
  }

  @ReactMethod
  fun getVoicePreferences(promise: Promise) {
    mainHandler.post {
      try {
        val tts = engine
        promise.resolve(Arguments.createMap().apply {
          putString("locale", recognitionLocale())
          putDouble("rate", speechRate().toDouble())
          putString("voice", tts?.voice?.name)
          putArray("voices", Arguments.createArray().apply {
            if (initComplete && tts != null) installedVoices(tts).forEach { voice ->
              pushMap(Arguments.createMap().apply { putString("name",voice.name);putString("locale",voice.locale.toLanguageTag()) })
            }
          })
        })
      } catch (_: Exception) { promise.reject("BUSHMESH_VOICE_PREF", "Could not inspect local voices.") }
    }
  }

  @ReactMethod
  fun setVoicePreferences(locale: String, voiceName: String?, rate: Double, promise: Promise) {
    mainHandler.post {
      try {
        require(locale in listOf("en-AU","en-GB","en-US") && rate.isFinite() && rate in 0.75..1.35)
        check(!VoiceAudioOwnership.speaking && VoiceAudioOwnership.cancelRecognition == null)
        val tts = engine
        val previous = tts?.voice
        val previousRate = speechRate()
        val voice = if (tts != null && initComplete) preferredVoice(tts,voiceName) else null
        require(voiceName.isNullOrEmpty() || voice != null)
        try {
          if (tts != null && voice != null) {
            check(tts.setVoice(voice) == TextToSpeech.SUCCESS)
            check(tts.setSpeechRate(rate.toFloat()) == TextToSpeech.SUCCESS)
          }
          check(preferences().edit().putString("recognition_locale",locale).putString("offline_voice",voiceName).putFloat("speech_rate",rate.toFloat()).commit())
          if (voice != null) { selectedLanguage = voice.locale; initFailed = false }
          promise.resolve(true)
        } catch (error: Exception) {
          if (tts != null && previous != null) { tts.setVoice(previous); tts.setSpeechRate(previousRate) }
          throw error
        }
      } catch (_: Exception) { promise.reject("BUSHMESH_VOICE_PREF", "Voice preference not saved. Stop speech and choose an installed offline voice.") }
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
          if (VoiceAudioOwnership.critical) clearSpeech()
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
        clearSpeech()
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