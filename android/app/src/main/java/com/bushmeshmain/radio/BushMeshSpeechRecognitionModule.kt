package com.bushmeshmain.radio

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.ModelDownloadListener
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import com.bushmeshmain.MainActivity

/** A fresh recognizer per explicit turn. Stale callbacks never settle another
 * turn. No platform network recognizer, microphone service or automatic loop. */
class BushMeshSpeechRecognitionModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), LifecycleEventListener {
  private val main = Handler(Looper.getMainLooper())
  private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var engine: SpeechRecognizer? = null
  private var pending: Promise? = null
  private var focus: AudioFocusRequest? = null
  private var timeout: Runnable? = null
  private var generation = 0L
  private var microphoneLease: VoiceMicrophoneOwnership.Lease? = null
  private var heldTurn: VoiceHeldTurn? = null
  private var eligibilityCheck: Runnable? = null
  private var lastFailure: String? = null
  private var phase = "idle"
  private var audioDevices: AudioDeviceCallback? = null
  @Volatile private var invalidated = false
  private var probe: SpeechRecognizer? = null
  private var cancelProbe: (() -> Unit)? = null
  private var admittedActivity: MainActivity? = null
  private var admittedEpoch = -1L
  private var microphoneClaims = 0L
  private var startListeningRequests = 0L
  init { context.addLifecycleEventListener(this) }
  override fun getName() = "BushMeshSpeechRecognition"
  private fun supported() = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
  private fun statusMap(): WritableMap {
    val available = !invalidated && runCatching { supported() }.getOrDefault(false)
    return Arguments.createMap().apply {
        putBoolean("supported", available)
        putBoolean("listening", pending != null)
        putDouble("apiLevel", Build.VERSION.SDK_INT.toDouble())
        putString("reason", if (available) null else "No on-device recognizer available.")
        putBoolean("foreground", foregroundActivity() != null)
        putBoolean("permissionGranted", hasPermission())
        putString("microphoneOwner", when (VoiceAudioOwnership.microphone.owner) {
          VoiceMicrophoneOwnership.Kind.COMMAND -> "command"
          VoiceMicrophoneOwnership.Kind.HOLD_TO_TALK -> "hold-to-talk"
          VoiceMicrophoneOwnership.Kind.WAKE_DETECTOR -> "wake-detector"
          null -> null
        })
        putBoolean("playbackActive", VoiceAudioOwnership.speaking)
        putString("lastFailure", lastFailure)
        putString("phase", phase)
        putString("requestId", heldTurn?.requestId)
        putDouble("microphoneClaims", microphoneClaims.toDouble())
        putDouble("startListeningRequests", startListeningRequests.toDouble())
    }
  }

  private fun publishStatus() {
    if (invalidated || !context.hasActiveReactInstance()) return
    runCatching {
      context.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("BushMeshSpeechSessionState", statusMap())
    }
  }

  @ReactMethod fun getStatus(promise: Promise) {
    main.post { promise.resolve(statusMap()) }
  }
  private fun recognitionIntent(locale: String, partial: Boolean = false) =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partial)
    }

  @ReactMethod fun checkLanguage(locale: String, promise: Promise) =
    inspectLanguages(locale, false, promise)

  @ReactMethod fun getLanguageInventory(locale: String, promise: Promise) =
    inspectLanguages(locale, true, promise)

  private fun inspectLanguages(locale: String, inventory: Boolean, promise: Promise) {
    main.post {
      fun respond(status: String, reason: String? = null, installed: List<String> = emptyList(),
                  pendingLanguages: List<String> = emptyList(), downloadable: List<String> = emptyList()) {
        if (!inventory) {
          promise.resolve(if (status == "pending") "download-required" else if (status == "unsupported") "unknown" else status)
          return
        }
        promise.resolve(Arguments.createMap().apply {
          putString("locale", locale)
          putString("status", status)
          putString("reason", reason)
          putArray("installed", Arguments.createArray().apply { installed.forEach { pushString(it) } })
          putArray("pending", Arguments.createArray().apply { pendingLanguages.forEach { pushString(it) } })
          putArray("downloadable", Arguments.createArray().apply { downloadable.forEach { pushString(it) } })
        })
      }
      if (invalidated || Build.VERSION.SDK_INT < 33 || !runCatching { supported() }.getOrDefault(false) ||
          pending != null || probe != null) {
        respond("unknown", "Support inspection unavailable or busy."); return@post
      }
      try {
        val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        probe = recognizer
        var completed = false
        var deadline: Runnable? = null
        fun finish(status: String, reason: String? = null, support: RecognitionSupport? = null) {
          if (completed) return
          completed = true
          deadline?.let { main.removeCallbacks(it) }
          if (probe === recognizer) { probe = null; cancelProbe = null }
          runCatching { recognizer.destroy() }
          respond(status, reason, support?.installedOnDeviceLanguages.orEmpty(),
            support?.pendingOnDeviceLanguages.orEmpty(), support?.supportedOnDeviceLanguages.orEmpty())
        }
        cancelProbe = { finish("unknown", "Support inspection interrupted.") }
        deadline = Runnable { finish("unknown", "Support inspection timed out.") }.also { main.postDelayed(it, 4_000) }
        try {
          recognizer.checkRecognitionSupport(recognitionIntent(locale), context.mainExecutor, object : RecognitionSupportCallback {
            override fun onSupportResult(support: RecognitionSupport) {
              finish(offlineLanguageStatus(locale, support.installedOnDeviceLanguages,
                support.pendingOnDeviceLanguages, support.supportedOnDeviceLanguages), support = support)
            }
            override fun onError(error: Int) {
              finish(if (error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED) "unsupported" else "unknown",
                recognitionFailure(error, locale).second)
            }
          })
        } catch (_: Exception) { finish("unknown", "Provider could not inspect offline models.") }
      } catch (_: Exception) { respond("unknown", "Could not create on-device recognizer.") }
    }
  }

  // Explicit provisioning only. No microphone is acquired by this operation.
  // Destroying the observer does not promise cancellation of a provider download.
  private var downloadId: String? = null
  @ReactMethod fun downloadLanguage(locale: String, requestId: String, promise: Promise) {
    main.post {
      if (invalidated || foregroundActivity() == null || Build.VERSION.SDK_INT < 33 ||
          !runCatching { supported() }.getOrDefault(false) || pending != null || probe != null ||
          VoiceAudioOwnership.microphoneBusy || VoiceAudioOwnership.speaking || !isEnglishRecognitionLocale(locale)) {
        promise.resolve("unavailable"); return@post
      }
      try {
        val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        probe = recognizer
        downloadId = requestId
        var completed = false
        var deadline: Runnable? = null
        fun finish(outcome: String) {
          if (completed) return
          completed = true
          deadline?.let { main.removeCallbacks(it) }
          if (probe === recognizer) { probe = null; cancelProbe = null; downloadId = null }
          runCatching { recognizer.destroy() }
          promise.resolve(outcome)
        }
        cancelProbe = { finish("interrupted") }
        try {
          if (Build.VERSION.SDK_INT >= 34) {
            deadline = Runnable { finish("unconfirmed") }.also { main.postDelayed(it, 120_000) }
            recognizer.triggerModelDownload(recognitionIntent(locale), context.mainExecutor, object : ModelDownloadListener {
              override fun onProgress(completedPercent: Int) {
                if (completed || probe !== recognizer || !context.hasActiveReactInstance()) return
                runCatching {
                  context.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("BushMeshSpeechModelProgress", Arguments.createMap().apply {
                      putString("requestId", requestId)
                      putDouble("percent", completedPercent.coerceIn(0, 100).toDouble())
                    })
                }
              }
              override fun onSuccess() { finish("completed") }
              override fun onScheduled() { finish("scheduled") }
              override fun onError(error: Int) { finish("failed:" + error) }
            })
          } else {
            recognizer.triggerModelDownload(recognitionIntent(locale))
            deadline = Runnable { finish("requested") }.also { main.postDelayed(it, 4_000) }
          }
        } catch (_: Exception) { finish("failed") }
      } catch (_: Exception) { promise.resolve("failed") }
    }
  }

  @ReactMethod fun stopDownloadObservation(requestId: String, promise: Promise) {
    main.post {
      val matches = downloadId == requestId
      if (matches) cancelProbe?.invoke()
      promise.resolve(matches)
    }
  }

  private fun hasPermission() =
    context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  // Do not change audio mode, force SCO routing or compete with calls.
  private fun callActive() =
    audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_IN_COMMUNICATION ||
      audio.mode == AudioManager.MODE_RINGTONE

  /** Lifecycle callbacks are hints, never authority to enable capture.
   * React may enqueue a registration-time resume; read both live states
   * on the main looper, including the actual Activity lifecycle. */
  private fun foregroundActivity(): MainActivity? {
    if (invalidated || context.lifecycleState != LifecycleState.RESUMED) return null
    val activity = context.currentActivity as? MainActivity ?: return null
    return activity.takeIf { it.voiceForegroundResumed && !it.isFinishing && !it.isDestroyed }
  }

  private fun eligibleTurn(): Boolean {
    val activity = foregroundActivity() ?: return false
    return hasPermission() && activity === admittedActivity &&
      activity.voiceForegroundEpoch == admittedEpoch
  }

  private fun watchEligibility(turn: Long) {
    val check = object : Runnable {
      override fun run() {
        if (generation != turn || pending == null) return
        if (!eligibleTurn()) { fail("SUSPENDED", "Foreground microphone permission or activity lost."); return }
        if (callActive()) { fail("INTERRUPTED", "Call or communication audio became active."); return }
        main.postDelayed(this, 500L)
      }
    }
    eligibilityCheck = check
    main.postDelayed(check, 500L)
  }

  private fun watchAudioDevices(turn: Long) {
    val callback = object : AudioDeviceCallback() {
      override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
        if (generation != turn || pending == null) return
        // Conservatively end the turn when an input or Bluetooth audio
        // endpoint disappears. Do not select a replacement route silently.
        if (removedDevices.any { it.isSource || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP }) {
          fail("ROUTE_CHANGED", "Audio input or Bluetooth audio endpoint disconnected.")
        }
      }
    }
    audioDevices = callback
    audio.registerAudioDeviceCallback(callback, main)
  }

  private fun release() {
    generation++
    pending = null
    timeout?.let { main.removeCallbacks(it) }; timeout = null
    eligibilityCheck?.let { main.removeCallbacks(it) }; eligibilityCheck = null
    heldTurn = null
    admittedActivity = null
    admittedEpoch = -1L
    audioDevices?.let { runCatching { audio.unregisterAudioDeviceCallback(it) } }; audioDevices = null
    val previous = engine; engine = null
    runCatching { previous?.cancel() }
    runCatching { previous?.destroy() }
    focus?.let { runCatching { audio.abandonAudioFocusRequest(it) } }; focus = null
    VoiceAudioOwnership.microphone.release(microphoneLease)
    microphoneLease = null
    phase = "idle"
    publishStatus()
  }
  private fun fail(code: String, message: String) {
    val p = pending ?: return
    lastFailure = code
    release()
    p.reject("BUSHMESH_STT_" + code, message)
  }
  @ReactMethod fun recognizeOnce(localeTag: String?, promise: Promise) =
    recognize(localeTag, null, promise)

  @ReactMethod fun recognizeHeld(localeTag: String?, requestId: String, promise: Promise) {
    if (requestId.isBlank() || requestId.length > 80) {
      promise.reject("BUSHMESH_STT_REQUEST", "Invalid held-turn identifier.")
      return
    }
    recognize(localeTag, requestId, promise)
  }

  private fun recognize(localeTag: String?, requestId: String?, promise: Promise) {
    main.post {
      if (pending != null || probe != null || VoiceAudioOwnership.microphoneBusy || VoiceAudioOwnership.speaking) {
        promise.reject("BUSHMESH_STT_BUSY", "Microphone or speech output is busy."); return@post
      }
      val activity = foregroundActivity()
      if (activity == null || !hasPermission()) {
        promise.reject("BUSHMESH_STT_PERMISSION", "Foreground microphone permission required."); return@post
      }
      if (callActive()) {
        promise.reject("BUSHMESH_STT_INTERRUPTED", "Call or communication audio is active."); return@post
      }
      if (!runCatching { supported() }.getOrDefault(false)) {
        promise.reject("BUSHMESH_STT_UNAVAILABLE", "No on-device recognizer is available. Open speech-to-text setup."); return@post
      }
      admittedActivity = activity
      admittedEpoch = activity.voiceForegroundEpoch
      pending = promise
      lastFailure = null
      phase = "starting"
      heldTurn = requestId?.let(::VoiceHeldTurn)
      val turn = ++generation
      val started = android.os.SystemClock.elapsedRealtime()
      try {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
          .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
          .setOnAudioFocusChangeListener({ change ->
            if (change < 0 && generation == turn) fail("FOCUS", "Microphone audio focus lost.")
          }, main).build()
        focus = request
        if (audio.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
          fail("FOCUS", "Microphone audio focus unavailable. End calls or other audio and retry."); return@post
        }
        val kind = if (requestId == null) VoiceMicrophoneOwnership.Kind.COMMAND else VoiceMicrophoneOwnership.Kind.HOLD_TO_TALK
        microphoneLease = VoiceAudioOwnership.microphone.claim(kind, VoiceAudioOwnership.speaking) {
          if (generation == turn) fail("INTERRUPTED", "Interrupted by critical speech.")
        }
        check(microphoneLease != null)
        microphoneClaims++
        publishStatus()
        val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        engine = recognizer
        recognizer.setRecognitionListener(object : RecognitionListener {
          private var lastLevelAt = 0L
          override fun onReadyForSpeech(params: Bundle?) {
            if (generation == turn && VoiceAudioOwnership.microphone.owns(microphoneLease)) {
              if (!eligibleTurn()) { fail("SUSPENDED", "Recognition suspended."); return }
              if (phase == "starting") phase = "listening"
              heldTurn?.markReady()
              publishStatus()
            }
          }
          override fun onBeginningOfSpeech() = Unit
          override fun onRmsChanged(rmsdB: Float) {
            if (requestId == null || generation != turn || phase != "listening" ||
                !rmsdB.isFinite() || !eligibleTurn() ||
                !VoiceAudioOwnership.microphone.owns(microphoneLease)) return
            val now = android.os.SystemClock.elapsedRealtime()
            if (now - lastLevelAt < 100L || !context.hasActiveReactInstance()) return
            lastLevelAt = now
            // Level only, no recording or audio buffer is retained.
            runCatching {
              context.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("BushMeshSpeechAudioLevel", Arguments.createMap().apply {
                  putString("requestId", requestId)
                  putDouble("rmsDb", rmsdB.toDouble())
                })
            }
          }
          override fun onBufferReceived(buffer: ByteArray?) = Unit
          override fun onEndOfSpeech() {
            if (generation == turn && pending != null) {
              phase = "finishing"
              publishStatus()
            }
          }
          override fun onPartialResults(partialResults: Bundle?) {
            // Platform support varies. Partial text is never a command, never
            // persisted, and is emitted only for an explicitly held turn.
            if (requestId == null || generation != turn || !eligibleTurn() ||
              !VoiceAudioOwnership.microphone.owns(microphoneLease)) return
            val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
              ?.firstOrNull()?.trim()?.take(2048)?.takeIf { it.isNotEmpty() } ?: return
            if (context.hasActiveReactInstance()) {
              runCatching {
                context.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                  .emit("BushMeshHeldSpeechPartial", Arguments.createMap().apply {
                    putString("requestId", requestId)
                    putString("text", text)
                  })
              }
            }
          }
          override fun onEvent(eventType: Int, params: Bundle?) = Unit
          override fun onError(error: Int) {
            if (generation == turn) {
              val failure = recognitionFailure(error, localeTag ?: "en-AU")
              fail(failure.first, failure.second)
            }
          }
          override fun onResults(results: Bundle?) {
            if (generation != turn || !VoiceAudioOwnership.microphone.owns(microphoneLease)) return
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()
            if (!eligibleTurn()) { fail("SUSPENDED", "Recognition suspended."); return }
            if (callActive() || matches.isEmpty()) {
              fail("NO_MATCH", "No usable foreground recognition result."); return
            }
            val result = Arguments.createMap().apply {
              putString("text", matches.first())
              putDouble("confidence", results?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)?.firstOrNull()?.toDouble() ?: -1.0)
              putDouble("durationMs", (android.os.SystemClock.elapsedRealtime() - started).toDouble())
              putArray("alternatives", Arguments.createArray().apply { matches.drop(1).take(2).forEach { pushString(it) } })
            }
            val p = pending; release(); p?.resolve(result)
          }
        })
        val intent = recognitionIntent(localeTag ?: "en-AU", requestId != null)
        timeout = Runnable { if (generation == turn) fail("TIMEOUT", "Listening timed out.") }.also { main.postDelayed(it, 20_000) }
        watchAudioDevices(turn)
        if (!eligibleTurn()) { fail("SUSPENDED", "Recognition suspended before start."); return@post }
        startListeningRequests++
        recognizer.startListening(intent)
        watchEligibility(turn)
      } catch (_: Exception) { fail("START_FAILED", "On-device recognition could not start. Check language resources and audio focus.") }
    }
  }
  @ReactMethod fun finishHeld(requestId: String, cancel: Boolean, promise: Promise) {
    main.post {
      when (heldTurn?.finish(requestId, cancel)) {
        VoiceHeldTurn.Finish.CANCEL -> {
          fail("CANCELLED", "Held recognition cancelled before completion.")
          promise.resolve(true)
        }
        VoiceHeldTurn.Finish.STOP -> {
          try {
            phase = "finishing"
            publishStatus()
            engine?.stopListening()
            promise.resolve(true)
          }
          catch (_: Exception) { fail("STOP_FAILED", "Recognition could not stop."); promise.resolve(false) }
        }
        else -> promise.resolve(false)
      }
    }
  }

  // React Native event-emitter subscription hooks. No listener starts capture.
  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  @ReactMethod fun getHandsFreeStatus(promise: Promise) {
    main.post {
      promise.resolve(Arguments.createMap().apply {
        putBoolean("available", false)
        putBoolean("active", false)
        putBoolean("offlineModelReady", false)
        putBoolean("backgroundCaptureSupported", false)
        putString("reason", "offline-wake-engine-not-provisioned")
      })
    }
  }

  @ReactMethod fun activateHandsFree(promise: Promise) {
    // No approved, installed detector exists. Never start a service or
    // substitute repeated SpeechRecognizer turns for actual wake detection.
    promise.reject("BUSHMESH_WAKE_UNAVAILABLE", "An approved offline wake detector is not provisioned.")
  }

  @ReactMethod fun deactivateHandsFree(promise: Promise) {
    // No session can be active in this build; do not cancel an unrelated turn.
    promise.resolve(false)
  }

  @ReactMethod fun stopListening(promise: Promise) {
    main.post { if (heldTurn != null) { promise.resolve(false); return@post }; try { engine?.stopListening(); promise.resolve(pending != null) } catch (_: Exception) { fail("STOP_FAILED", "Recognition could not stop."); promise.resolve(false) } }
  }
  @ReactMethod fun cancel(promise: Promise) {
    main.post {
      // The existing dialogue adapter owns unscoped finite command turns.
      // Held turns must be cancelled by their request ID (or lifecycle).
      if (heldTurn != null) { promise.resolve(false); return@post }
      fail("CANCELLED", "Recognition cancelled.")
      promise.resolve(true)
    }
  }
  // React lifecycle callbacks normally run on the UI thread. Handle them
  // synchronously there to avoid reordering pause behind a new turn. If
  // delivered off-main, reconcile live state when the callback executes.
  private fun onMain(action: () -> Unit) {
    if (Looper.myLooper() == main.looper) action() else main.post { action() }
  }

  private fun reconcileLifecycle() = onMain {
    if (foregroundActivity() == null) cancelProbe?.invoke()
    if (pending != null && !eligibleTurn()) fail("SUSPENDED", "Recognition suspended.")
    publishStatus()
  }

  override fun onHostResume() = reconcileLifecycle()
  override fun onHostPause() = reconcileLifecycle()
  override fun onHostDestroy() = reconcileLifecycle()

  override fun invalidate() {
    invalidated = true
    context.removeLifecycleEventListener(this)
    onMain {
      cancelProbe?.invoke()
      fail("SUSPENDED", "Recognition module closed.")
    }
    super.invalidate()
  }
}
