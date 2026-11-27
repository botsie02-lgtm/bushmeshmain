package com.bushmeshmain.radio

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.media.AudioDeviceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import com.bushmeshmain.MainActivity
import java.lang.ref.WeakReference
import java.util.UUID

/** Main-looper process-local authorization. Nothing is restored from disk. */
internal data class WakeActivation(
  val id: String,
  val owner: Any,
  val activity: WeakReference<MainActivity>,
  val epoch: Long,
  val foreground: () -> Boolean,
  val modelReady: () -> Boolean,
  val capture: (AudioManager, Handler) -> WakeCapture,
  val fixture: Boolean,
  val changed: (WakeSnapshot) -> Unit
)

internal object HandsFreeRuntime {
  private val gate = WakeStartGate<WakeActivation> { SystemClock.elapsedRealtime() }
  private var service: BushMeshHandsFreeService? = null
  private var active: WakeActivation? = null

  fun permission(context: Context) =
    context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
  fun notifications(context: Context): Boolean {
    val manager = requireNotNull(context.getSystemService(NotificationManager::class.java))
    return manager.areNotificationsEnabled() &&
      (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
      (Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(BushMeshHandsFreeService.CHANNEL_ID)?.importance != NotificationManager.IMPORTANCE_NONE)
  }

  fun request(activity: MainActivity, owner: Any, foreground: () -> Boolean,
              changed: (WakeSnapshot) -> Unit): Boolean {
    val provider = QualifiedWakeDetector.provider ?: return false
    return issue(activity, owner, foreground, { provider.isModelReady() },
      { audio, main -> AndroidWakeCapture(audio, main, provider) }, false, changed)
  }

  /** In-process instrumentation seam only. No React, Intent or persisted
   * fixture switch. Fixtures use a deterministic non-recording capture. */
  internal fun requestFixture(activity: MainActivity, owner: Any, capture: () -> WakeCapture,
                              changed: (WakeSnapshot) -> Unit): Boolean =
    activity.packageName.endsWith(".radioredesign") &&
    issue(activity, owner, { activity.voiceForegroundResumed && !activity.isFinishing && !activity.isDestroyed },
      { true }, { _, _ -> capture() }, true, changed)

  private fun issue(activity: MainActivity, owner: Any, foreground: () -> Boolean,
                    modelReady: () -> Boolean, capture: (AudioManager, Handler) -> WakeCapture,
                    fixture: Boolean, changed: (WakeSnapshot) -> Unit): Boolean {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (Build.VERSION.SDK_INT < 31 || service != null || gate.peek() != null ||
      !foreground() || !activity.voiceForegroundResumed || !permission(activity) ||
      !notifications(activity) || !runCatching { modelReady() }.getOrDefault(false)) return false
    val id = UUID.randomUUID().toString()
    val grant = WakeActivation(id, owner, WeakReference(activity), activity.voiceForegroundEpoch,
      foreground, modelReady, capture, fixture, changed)
    if (!gate.issue(id, grant)) return false
    return try {
      activity.startForegroundService(Intent(activity, BushMeshHandsFreeService::class.java)
        .setAction(BushMeshHandsFreeService.START).putExtra(BushMeshHandsFreeService.EXTRA_ID, id))
      true
    } catch (_: Exception) {
      gate.clear(); false
    }
  }

  fun consume(id: String): WakeActivation? {
    if (service != null) return null
    val grant = gate.consume(id) ?: return null
    val activity = grant.activity.get()
    val admitted = activity != null && activity.voiceForegroundResumed && activity.voiceForegroundEpoch == grant.epoch &&
      !activity.isFinishing && !activity.isDestroyed && grant.foreground() && permission(activity) &&
      notifications(activity) && runCatching { grant.modelReady() }.getOrDefault(false)
    if (!admitted) {
      runCatching { grant.changed(WakeSnapshot(grant.id, WakePhase.STOPPED, WakeReason.FOREGROUND_REQUIRED, 0, false, null, false, 0, 0)) }
      return null
    }
    return grant
  }

  fun attach(instance: BushMeshHandsFreeService, grant: WakeActivation) {
    check(service == null)
    service = instance; active = grant
  }
  fun detach(instance: BushMeshHandsFreeService) {
    if (service === instance) { service = null; active = null }
  }
  fun snapshot(owner: Any): WakeSnapshot? = if (active?.owner === owner) service?.snapshot() else null
  fun starting(owner: Any): Boolean = gate.peek()?.owner === owner
  fun stop(owner: Any, reason: WakeReason): Boolean {
    var stopped = false
    val pending = gate.peek()
    if (pending?.owner === owner) {
      gate.clear(); stopped = true
      runCatching { pending.changed(WakeSnapshot(pending.id, WakePhase.STOPPED, reason, 0, false, null, false, 0, 0)) }
    }
    if (active?.owner === owner) { service?.stopSession(reason); stopped = true }
    return stopped
  }
  fun reconcile(owner: Any) { if (active?.owner === owner) service?.reconcile() }
  fun claim(owner: Any, key: WakeHandover): Boolean =
    active?.owner === owner && service?.claim(key) == true
  fun owns(owner: Any, key: WakeHandover): Boolean =
    active?.owner === owner && service?.owns(key) == true
  fun complete(owner: Any, key: WakeHandover): Boolean =
    active?.owner === owner && service?.complete(key) == true
}

/** Independent microphone FGS; never starts, binds or restores the radio. */
class BushMeshHandsFreeService : Service() {
  companion object {
    internal const val CHANNEL_ID = "bushmesh_handsfree_microphone"
    internal const val NOTIFICATION_ID = 4102
    internal const val START = "com.bushmeshmain.handsfree.START"
    internal const val STOP = "com.bushmeshmain.handsfree.STOP"
    internal const val EXTRA_ID = "handsfree-session-id"
  }
  private val main = Handler(Looper.getMainLooper())
  private lateinit var audio: AudioManager
  private lateinit var manager: NotificationManager
  private var grant: WakeActivation? = null
  private var session: WakeSessionController? = null
  private var stopping = false
  private var routeSignature: Set<String>? = null
  private var promoted = false
  private val watchdog = object : Runnable {
    override fun run() {
      reconcile()
      if (!stopping && session != null) main.postDelayed(this, 200L)
    }
  }

  override fun onCreate() {
    super.onCreate()
    audio = requireNotNull(getSystemService(AudioManager::class.java))
    manager = requireNotNull(getSystemService(NotificationManager::class.java))
  }
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra(EXTRA_ID)
    if (intent?.action == STOP) {
      if (id != null && grant?.id == id) stopSession(WakeReason.STOP_REQUESTED)
      else if (grant == null) stopSelf(startId)
      return START_NOT_STICKY
    }
    // Duplicate/old starts cannot replace an existing session.
    if (grant != null) return START_NOT_STICKY
    val accepted = if (intent?.action == START && id != null) HandsFreeRuntime.consume(id) else null
    if (accepted == null || Build.VERSION.SDK_INT < 31) {
      stopSelf(startId); return START_NOT_STICKY
    }
    grant = accepted
    HandsFreeRuntime.attach(this, accepted)
    try {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Hands-free microphone", NotificationManager.IMPORTANCE_LOW))
      check(HandsFreeRuntime.notifications(this))
      startForeground(NOTIFICATION_ID, notification("Starting", accepted), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      promoted = true
      routeSignature = routes()
      val controller = WakeSessionController(accepted.id, VoiceAudioOwnership.microphone,
        VoiceAudioOwnership.playback, { SystemClock.elapsedRealtime() },
        { eligibility(accepted) }, { accepted.capture(audio, main) }, { state -> onState(state) })
      session = controller
      if (controller.activate() && !stopping) main.post(watchdog)
    } catch (_: Exception) {
      stopSession(WakeReason.CAPTURE_FAILED)
    }
    return START_NOT_STICKY
  }

  private fun eligibility(accepted: WakeActivation): WakeEligibility {
    val call = audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_IN_COMMUNICATION ||
      audio.mode == AudioManager.MODE_RINGTONE
    return WakeEligibility(HandsFreeRuntime.permission(this) && !audio.isMicrophoneMute,
      HandsFreeRuntime.notifications(this), accepted.foreground(), call,
      runCatching { accepted.modelReady() }.getOrDefault(false))
  }

  private fun routes(): Set<String> = audio.getDevices(AudioManager.GET_DEVICES_ALL)
    .filter { it.isSource || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
      it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || it.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
      it.type == AudioDeviceInfo.TYPE_BLE_SPEAKER }
    .map { "${it.type}:${it.id}" }.toSet()

  internal fun reconcile() {
    if (stopping) return
    try {
      val current = routes()
      if (routeSignature != null && current != routeSignature) {
        stopSession(WakeReason.ROUTE_CHANGED); return
      }
      session?.tick()
    } catch (_: Exception) { stopSession(WakeReason.CAPTURE_FAILED) }
  }

  private fun notification(detail: String, accepted: WakeActivation): Notification {
    val stop = Intent(this, BushMeshHandsFreeService::class.java).setAction(STOP)
      .setData(Uri.parse("bushmesh://handsfree/stop/" + accepted.id)).putExtra(EXTRA_ID, accepted.id)
    val action = PendingIntent.getService(this, 0, stop, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    return Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle(if (accepted.fixture) "Hands-free lifecycle test (no microphone)" else "BushMesh hands-free session")
      .setContentText(detail).setOnlyAlertOnce(true).setOngoing(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
      .addAction(Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel), "Stop", action).build())
      .build()
  }

  private fun onState(state: WakeSnapshot) {
    val accepted = grant ?: return
    // A fixture's callback is local to instrumentation, never a React event.
    runCatching { accepted.changed(state) }
    if (state.phase == WakePhase.STOPPED) {
      finishService(); return
    }
    if (!promoted || stopping) return
    val detail = when (state.phase) {
      WakePhase.STARTING -> "Preparing microphone"
      WakePhase.LISTENING -> if (accepted.fixture) "Synthetic capture fixture active" else "Listening for wake phrase"
      WakePhase.HANDOVER -> "Wake capture paused for command"
      WakePhase.SUSPENDED -> "Microphone suspended"
      WakePhase.STOPPED -> "Stopped"
    }
    try { manager.notify(NOTIFICATION_ID, notification(detail, accepted)) }
    catch (_: Exception) { stopSession(WakeReason.NOTIFICATION_UNAVAILABLE) }
  }

  internal fun snapshot(): WakeSnapshot? = session?.snapshot()
  internal fun claim(key: WakeHandover) = session?.claimHandover(key) == true
  internal fun owns(key: WakeHandover) = session?.ownsHandover(key) == true
  internal fun complete(key: WakeHandover) = session?.completeHandover(key) == true

  internal fun stopSession(reason: WakeReason) {
    if (stopping) return
    session?.stop(reason)
    if (!stopping) {
      // Also cover failed foreground promotion, before the controller exists.
      grant?.let { runCatching { it.changed(WakeSnapshot(it.id, WakePhase.STOPPED, reason, 0, false, null, false, 0, 0)) } }
      finishService()
    }
  }
  private fun finishService() {
    if (stopping) return
    stopping = true
    main.removeCallbacks(watchdog)
    if (promoted) { stopForeground(STOP_FOREGROUND_REMOVE); promoted = false }
    manager.cancel(NOTIFICATION_ID)
    stopSelf()
  }
  override fun onTaskRemoved(rootIntent: Intent?) { stopSession(WakeReason.STOP_REQUESTED); super.onTaskRemoved(rootIntent) }
  override fun onDestroy() {
    stopping = true
    main.removeCallbacks(watchdog)
    session?.stop(WakeReason.SERVICE_DESTROYED)
    if (promoted) stopForeground(STOP_FOREGROUND_REMOVE)
    manager.cancel(NOTIFICATION_ID)
    HandsFreeRuntime.detach(this)
    grant = null; session = null
    super.onDestroy()
  }
}
