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
  private var admittedHandover: WakeHandover? = null
  private var lastWakeReason: String? = null
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
  @ReactMethod fun checkLanguage(locale: String, promise: Promise) {
    main.post {
      if (invalidated || Build.VERSION.SDK_INT < 33 || !runCatching { supported() }.getOrDefault(false) || pending != null || probe != null) {
        promise.resolve("unknown"); return@post
      }
      try {
        val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        probe = recognizer
        var completed = false
        fun finish(status: String) {
          if (completed) return
          completed = true
          if (probe === recognizer) { probe = null; cancelProbe = null }
          runCatching { recognizer.destroy() }
          promise.resolve(status)
        }
        cancelProbe = { finish("unknown") }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
          putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }
        main.postDelayed({ finish("unknown") }, 4_000)
        try {
          recognizer.checkRecognitionSupport(intent, context.mainExecutor, object : RecognitionSupportCallback {
            override fun onSupportResult(support: RecognitionSupport) {
              val installed = support.installedOnDeviceLanguages.any { it.equals(locale, ignoreCase = true) }
              val downloadable = (support.supportedOnDeviceLanguages + support.pendingOnDeviceLanguages).any { it.equals(locale, ignoreCase = true) }
              finish(if (installed) "installed" else if (downloadable) "download-required" else "unknown")
            }
            override fun onError(error: Int) { finish("unknown") }
          })
        } catch (_: Exception) { finish("unknown") }
      } catch (_: Exception) { promise.resolve("unknown") }
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
      activity.voiceForegroundEpoch == admittedEpoch &&
      (admittedHandover?.let { HandsFreeRuntime.owns(this, it) } ?: true)
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
    admittedHandover = null
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

  private fun recognize(localeTag: String?, requestId: String?, promise: Promise, handover: WakeHandover? = null) {
    main.post {
      if (handover != null && !HandsFreeRuntime.owns(this, handover)) {
        promise.reject("BUSHMESH_WAKE_STALE", "Hands-free command handover expired."); return@post
      }
      // Only preempt the wake owner for an eligible explicit finite turn.
      if (pending == null && probe == null && foregroundActivity() != null && hasPermission() && !callActive()) {
        VoiceAudioOwnership.yieldWakeForAudio()
      }
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
      admittedActivity = activity
      admittedEpoch = activity.voiceForegroundEpoch
      admittedHandover = handover
      pending = promise
      lastFailure = null
      phase = "starting"
      heldTurn = requestId?.let(::VoiceHeldTurn)
      val turn = ++generation
      val started = android.os.SystemClock.elapsedRealtime()
      try {
        check(supported())
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
          .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
          .setOnAudioFocusChangeListener({ change ->
            if (change < 0 && generation == turn) fail("FOCUS", "Microphone audio focus lost.")
          }, main).build()
        focus = request
        check(audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
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
          override fun onReadyForSpeech(params: Bundle?) {
            if (generation == turn && VoiceAudioOwnership.microphone.owns(microphoneLease)) {
              if (!eligibleTurn()) { fail("SUSPENDED", "Recognition suspended."); return }
              if (phase == "starting") phase = "listening"
              heldTurn?.markReady()
              publishStatus()
            }
          }
          override fun onBeginningOfSpeech() = Unit
          override fun onRmsChanged(rmsdB: Float) = Unit
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
            if (generation == turn) fail("RECOGNITION", "On-device recognition unavailable or unsuccessful (code $error). Check offline language resources and retry.")
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
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, localeTag ?: "en-AU")
          putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
          putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, requestId != null)
        }
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

  private fun wakeStatus(state: WakeSnapshot? = HandsFreeRuntime.snapshot(this)): WritableMap {
    val provider = QualifiedWakeDetector.provider
    val ready = provider != null && runCatching { provider.isModelReady() }.getOrDefault(false)
    val starting = HandsFreeRuntime.starting(this)
    val active = state != null && state.phase != WakePhase.STOPPED
    return Arguments.createMap().apply {
      putBoolean("available", !invalidated && Build.VERSION.SDK_INT >= 31 && ready)
      putBoolean("active", active)
      putBoolean("offlineModelReady", ready)
      // This implementation intentionally retains foreground-only command
      // admission, so wake capture is also suspended when backgrounded.
      putBoolean("backgroundCaptureSupported", false)
      putBoolean("backgroundCommandSupported", false)
      putBoolean("captureActive", state?.captureActive == true)
      putBoolean("foreground", foregroundActivity() != null)
      putBoolean("permissionGranted", hasPermission())
      putString("sessionId", state?.sessionId)
      putString("phase", state?.phase?.name?.lowercase() ?: if (starting) "starting" else "idle")
      putDouble("captureGeneration", state?.captureGeneration?.toDouble() ?: 0.0)
      putDouble("captureStarts", state?.captureStarts?.toDouble() ?: 0.0)
      putDouble("acceptedWakes", state?.acceptedWakes?.toDouble() ?: 0.0)
      putString("handoverId", state?.handover?.sequence?.toString())
      putBoolean("handoverClaimed", state?.handoverClaimed == true)
      putString("microphoneOwner", when (VoiceAudioOwnership.microphone.owner) {
        VoiceMicrophoneOwnership.Kind.COMMAND -> "command"
        VoiceMicrophoneOwnership.Kind.HOLD_TO_TALK -> "hold-to-talk"
        VoiceMicrophoneOwnership.Kind.WAKE_DETECTOR -> "wake-detector"
        null -> null
      })
      putBoolean("playbackActive", VoiceAudioOwnership.speaking)
      putString("modelId", provider?.modelId)
      putString("reason", when {
        provider == null -> "offline-wake-engine-not-provisioned"
        !ready -> "offline-wake-model-unavailable"
        state != null && state.reason != WakeReason.NONE -> state.reason.name.lowercase()
        else -> lastWakeReason
      })
    }
  }

  private fun onWakeState(state: WakeSnapshot) {
    lastWakeReason = state.reason.takeUnless { it == WakeReason.NONE }?.name?.lowercase()
    // Stop, background, timeout and completion invalidate only the scoped
    // hands-free turn. An unrelated manual command retains its own lease.
    if (pending != null && admittedHandover != null && !eligibleTurn()) {
      fail("SUSPENDED", "Hands-free handover ended.")
    }
    if (!invalidated && context.hasActiveReactInstance()) runCatching {
      context.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("BushMeshHandsFreeSessionState", wakeStatus(state))
    }
  }

  @ReactMethod fun getHandsFreeStatus(promise: Promise) {
    main.post { promise.resolve(wakeStatus()) }
  }

  @ReactMethod fun activateHandsFree(promise: Promise) {
    main.post {
      val provider = QualifiedWakeDetector.provider
      if (provider == null || !runCatching { provider.isModelReady() }.getOrDefault(false)) {
        promise.reject("BUSHMESH_WAKE_UNAVAILABLE", "An approved offline wake detector is not provisioned."); return@post
      }
      val activity = foregroundActivity()
      if (activity == null || !hasPermission() || !HandsFreeRuntime.notifications(context)) {
        promise.reject("BUSHMESH_WAKE_PERMISSION", "Visible activity, microphone permission and enabled notifications required."); return@post
      }
      lastWakeReason = null
      if (!HandsFreeRuntime.request(activity, this, { foregroundActivity() != null }, ::onWakeState)) {
        promise.reject("BUSHMESH_WAKE_START_FAILED", "Hands-free service could not start."); return@post
      }
      // Request accepted, not proof of active microphone. Observe subsequent
      // service state, including failed promotion, before displaying listening.
      promise.resolve(wakeStatus())
    }
  }

  @ReactMethod fun deactivateHandsFree(promise: Promise) {
    main.post { promise.resolve(HandsFreeRuntime.stop(this, WakeReason.STOP_REQUESTED)) }
  }

  private fun handoverKey(sessionId: String, handoverId: String): WakeHandover? {
    if (sessionId.length != 36 || handoverId.length > 19) return null
    val seq = handoverId.toLongOrNull()?.takeIf { it > 0 } ?: return null
    return WakeHandover(sessionId, seq)
  }

  @ReactMethod fun claimHandsFreeHandover(sessionId: String, handoverId: String, promise: Promise) {
    main.post { promise.resolve(handoverKey(sessionId, handoverId)?.let { HandsFreeRuntime.claim(this, it) } ?: false) }
  }
  @ReactMethod fun completeHandsFreeHandover(sessionId: String, handoverId: String, promise: Promise) {
    main.post { promise.resolve(handoverKey(sessionId, handoverId)?.let { HandsFreeRuntime.complete(this, it) } ?: false) }
  }
  @ReactMethod fun recognizeHandsFreeOnce(sessionId: String, handoverId: String, localeTag: String?, promise: Promise) {
    val key = handoverKey(sessionId, handoverId)
    if (key == null) { promise.reject("BUSHMESH_WAKE_STALE", "Invalid hands-free handover."); return }
    recognize(localeTag, null, promise, key)
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
    HandsFreeRuntime.reconcile(this)
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
      HandsFreeRuntime.stop(this, WakeReason.INVALIDATED)
      cancelProbe?.invoke()
      fail("SUSPENDED", "Recognition module closed.")
    }
    super.invalidate()
  }
}
