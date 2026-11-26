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
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.os.Build
import android.os.IBinder
import com.bushmeshmain.MainActivity
import com.bushmeshmain.R

class BushMeshRadioService : Service() {
  companion object {
    const val ACTION_START = "com.bushmeshmain.radio.START"
    const val ACTION_STOP = "com.bushmeshmain.radio.STOP"
    const val ACTION_REQUEST_LOCATION = "com.bushmeshmain.radio.REQUEST_LOCATION"
    const val ACTION_RELEASE_LOCATION = "com.bushmeshmain.radio.RELEASE_LOCATION"
    const val EXTRA_DEVICE_LABEL = "deviceLabel"
    const val EXTRA_DEVICE_ADDRESS = "deviceAddress"

    private const val CHANNEL_ID = "bushmesh_radio_runtime"
    private const val CHANNEL_NAME = "Bushmesh off-grid runtime"
    private const val NOTIFICATION_ID = 4101
    private const val PREFS_NAME = "bushmesh_radio_service"
    private const val PREF_NATIVE_ADDRESS = "native_device_address"
    private const val PREF_NATIVE_LABEL = "native_device_label"

    private const val EXTRA_COMMAND_ID = "commandId"
    private val main = Handler(Looper.getMainLooper())
    private val pending = RuntimeStartQueue<(Exception?) -> Unit>()
    private var instance: BushMeshRadioService? = null
    private var locationReleaseListener: (() -> Unit)? = null

    // Location module registers this only after a successful Android listener request.
    internal fun onLocationRelease(listener: () -> Unit) {
      locationReleaseListener = listener
    }

    private fun releaseLocation() {
      BushMeshRadioServiceState.releaseLocation()
      val listener = locationReleaseListener
      locationReleaseListener = null
      listener?.invoke()
    }
    @Volatile private var targetCleanupFailed = false

    // Only activations start a service. A normal startService from the visible
    // app (or an already active FGS) avoids a foreground-promotion deadline on
    // a command which may be cancelled or lose permission before delivery.
    // Android still enforces background-start and while-in-use restrictions.
    fun dispatch(
      context: Context, action: String, label: String? = null, address: String? = null,
      completion: (Exception?) -> Unit,
    ) {
      val app = context.applicationContext
      main.post {
        try {
          when (action) {
            ACTION_STOP, ACTION_RELEASE_LOCATION -> {
              val radio = action == ACTION_STOP
              val cancelled = pending.cancel(radio)
              val failure = try {
                if (radio) {
                  val service = instance
                  if (service != null) service.releaseRadio(clearPersisted = true)
                  else releaseInactiveRadio(app)
                } else {
                  releaseLocation()
                }
                null
              } catch (error: Exception) {
                error
              } finally {
                instance?.reconcileForeground()
              }
              cancelled.forEach { it(IllegalStateException("Runtime start cancelled by release.")) }
              completion(failure)
            }
            ACTION_START, ACTION_REQUEST_LOCATION -> {
              val radio = action == ACTION_START
              requirePermission(app, radio)
              if (radio && !address.isNullOrBlank()) {
                require(android.bluetooth.BluetoothAdapter.checkBluetoothAddress(address.trim().uppercase())) {
                  "Invalid Bluetooth device address."
                }
              }
              val id = pending.add(radio, completion)
              try {
                val intent = Intent(app, BushMeshRadioService::class.java).apply {
                  this.action = action
                  putExtra(EXTRA_COMMAND_ID, id)
                  putExtra(EXTRA_DEVICE_LABEL, label)
                  putExtra(EXTRA_DEVICE_ADDRESS, address)
                }
                checkNotNull(app.startService(intent)) { "Android did not accept the runtime service start." }
                main.postDelayed({
                  pending.take(id)?.invoke(IllegalStateException("Runtime activation was not delivered by Android."))
                  instance?.reconcileForeground()
                }, 15_000)
              } catch (error: Exception) {
                pending.take(id)
                throw error
              }
            }
            else -> error("Unknown runtime action.")
          }
        } catch (error: Exception) {
          completion(error)
        }
      }
    }

    private fun granted(context: Context, permission: String): Boolean =
      context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    internal fun permissionAllows(context: Context, radio: Boolean): Boolean = try {
      checkPermission(context, radio)
    } catch (_: SecurityException) {
      false
    }

    private fun checkPermission(context: Context, radio: Boolean): Boolean {
      if (Build.VERSION.SDK_INT >= 28 && !granted(context, Manifest.permission.FOREGROUND_SERVICE)) return false
      if (Build.VERSION.SDK_INT >= 34 && !granted(context, if (radio)
          Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE else Manifest.permission.FOREGROUND_SERVICE_LOCATION)) return false
      return if (radio) {
        Build.VERSION.SDK_INT < 31 || granted(context, Manifest.permission.BLUETOOTH_CONNECT)
      } else {
        // BushMesh GPS requires precise location, not merely approximate access.
        granted(context, Manifest.permission.ACCESS_FINE_LOCATION) &&
          (context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager)
            ?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true
      }
    }

    private fun requirePermission(context: Context, radio: Boolean) {
      if (!permissionAllows(context, radio)) throw SecurityException(
        if (radio) "Bluetooth connect permission is required for radio foreground operation."
        else "Precise location permission and enabled GPS are required for location foreground operation.",
      )
    }

    private fun releaseInactiveRadio(context: Context) {
      BushMeshRadioServiceState.releaseRadio()
      MeshCoreNativeBleRuntime.get(context).disconnect()
      clearPersistedNativeTarget(context)
      BushMeshOutboxLease(context).claimForeground()
    }

    private fun clearPersistedNativeTarget(context: Context) {
      val committed = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit().remove(PREF_NATIVE_ADDRESS).remove(PREF_NATIVE_LABEL).commit()
      targetCleanupFailed = !committed
      check(committed) { "Native radio target removal was not committed." }
    }

    fun hasPersistedNativeTarget(context: Context): Boolean {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      return targetCleanupFailed || !prefs.getString(PREF_NATIVE_ADDRESS, null).isNullOrBlank() ||
        !prefs.getString(PREF_NATIVE_LABEL, null).isNullOrBlank()
    }
  }

  private val nativeBle: MeshCoreNativeBleRuntime by lazy {
    MeshCoreNativeBleRuntime.get(applicationContext)
  }

  private val outboxLease: BushMeshOutboxLease by lazy {
    BushMeshOutboxLease(applicationContext)
  }

  private val backgroundWorkerDelegate = lazy {
    MeshCoreNativeBackgroundWorker(applicationContext, nativeBle)
  }

  private val backgroundWorker by backgroundWorkerDelegate

  private val inboxCaptureDelegate = lazy {
    BushMeshNativeInboxCapture(applicationContext, nativeBle)
  }

  private val inboxCapture by inboxCaptureDelegate

  private val carInboxNotifierDelegate = lazy {
    BushMeshCarInboxNotifier(applicationContext, nativeBle)
  }

  private val carInboxNotifier by carInboxNotifierDelegate
  private var foregroundTypes = 0
  private val permissionWatch = object : Runnable {
    override fun run() {
      reconcileForeground()
    }
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    ensureNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null) {
      try {
        restoreNativeTargetAfterProcessRestart()
      } catch (error: Exception) {
        Log.w(CHANNEL_ID, "Native radio recovery deferred", error)
        releaseRadioSafely(clearPersisted = false)
      }
    } else {
      val completion = pending.take(intent.getLongExtra(EXTRA_COMMAND_ID, -1L))
      // A release can cancel a queued activation before Android delivers it.
      if (completion != null) {
        val failure = try {
          dropIneligibleRequests()
          when (intent.action) {
            ACTION_START -> activateRadio(
              intent.getStringExtra(EXTRA_DEVICE_LABEL),
              intent.getStringExtra(EXTRA_DEVICE_ADDRESS),
            )
            ACTION_REQUEST_LOCATION -> activateLocation()
            else -> error("Invalid runtime activation.")
          }
          null
        } catch (error: Exception) {
          Log.w(CHANNEL_ID, "Runtime activation rejected", error)
          error
        }
        completion(failure)
      }
    }
    reconcileForeground()
    return if (BushMeshRadioServiceState.deviceAddress != null) START_STICKY else START_NOT_STICKY
  }

  private fun activateRadio(label: String?, address: String?) {
    requirePermission(this, true)
    val persisted = readPersistedNativeTarget()
    val target = address?.takeIf { it.isNotBlank() } ?: BushMeshRadioServiceState.deviceAddress ?: persisted?.first
    val targetLabel = if (!address.isNullOrBlank()) label else
      BushMeshRadioServiceState.deviceLabel ?: persisted?.second ?: label
    val oldRequested = BushMeshRadioServiceState.radioRequested
    val oldLabel = BushMeshRadioServiceState.deviceLabel
    val oldAddress = BushMeshRadioServiceState.deviceAddress
    BushMeshRadioServiceState.requestRadio(targetLabel, target)
    try {
      // Promote before disk, GATT, or recovery workers. No Bluetooth work
      // is initiated if Android rejects the requested service type.
      promote()
    } catch (error: Exception) {
      if (oldRequested) BushMeshRadioServiceState.requestRadio(oldLabel, oldAddress)
      else BushMeshRadioServiceState.releaseRadio()
      throw error
    }
    try {
      stopRadioWriters()
      outboxLease.claimForeground()
      if (target != null) {
        if (!address.isNullOrBlank()) persistNativeTarget(target, targetLabel)
        nativeBle.connect(target, targetLabel)
        carInboxNotifier.start()
      } else if (carInboxNotifierDelegate.isInitialized()) carInboxNotifier.stop()
    } catch (error: Exception) {
      releaseRadioSafely(clearPersisted = false)
      throw error
    }
  }

  private fun activateLocation() {
    requirePermission(this, false)
    val alreadyRequested = BushMeshRadioServiceState.locationRequested
    BushMeshRadioServiceState.requestLocation()
    try {
      promote()
    } catch (error: Exception) {
      if (!alreadyRequested) releaseLocation()
      throw error
    }
  }

  private fun stopRadioWriters() {
    if (inboxCaptureDelegate.isInitialized()) inboxCapture.stop()
    if (backgroundWorkerDelegate.isInitialized()) backgroundWorker.stop()
  }

  private fun releaseRadio(clearPersisted: Boolean) {
    stopRadioWriters()
    if (carInboxNotifierDelegate.isInitialized()) carInboxNotifier.stop()
    BushMeshRadioServiceState.releaseRadio()
    nativeBle.disconnect()
    if (clearPersisted) {
      clearPersistedNativeTarget(this)
      outboxLease.claimForeground()
    }
  }

  private fun releaseRadioSafely(clearPersisted: Boolean) {
    try {
      releaseRadio(clearPersisted)
    } catch (error: Exception) {
      Log.w(CHANNEL_ID, "Radio cleanup failed", error)
    }
  }

  private fun dropIneligibleRequests() {
    // Recheck on every command and periodically while running. Android may
    // kill the process on revocation; sticky recovery performs the same check.
    if (BushMeshRadioServiceState.radioRequested && !permissionAllows(this, true)) {
      releaseRadioSafely(clearPersisted = false)
    }
    if (BushMeshRadioServiceState.locationRequested && !permissionAllows(this, false)) {
      releaseLocation()
    }
  }

  private fun reconcileForeground() {
    dropIneligibleRequests()
    if (BushMeshRadioServiceState.shouldRun()) {
      try {
        if (foregroundTypes != requestedTypes()) promote()
        main.removeCallbacks(permissionWatch)
        main.postDelayed(permissionWatch, 2_000)
        return
      } catch (error: Exception) {
        // OS can reject a type even after a local permission check (e.g.
        // while-in-use restriction). Never leave a falsely active owner.
        Log.w(CHANNEL_ID, "Foreground runtime no longer eligible", error)
        releaseRadioSafely(clearPersisted = false)
        releaseLocation()
      }
    }
    main.removeCallbacks(permissionWatch)
    if (foregroundTypes != 0) stopForeground(STOP_FOREGROUND_REMOVE)
    foregroundTypes = 0
    BushMeshRadioServiceState.markStopped()
    // A different capability can have a queued activation. Do not cancel it.
    if (pending.isEmpty()) stopSelf()
  }

  override fun onDestroy() {
    main.removeCallbacks(permissionWatch)
    if (instance === this) instance = null
    if (carInboxNotifierDelegate.isInitialized()) carInboxNotifier.stop()
    stopRadioWriters()
    nativeBle.disconnect(clearTarget = false)
    releaseLocation()
    BushMeshRadioServiceState.markStopped()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  fun backgroundStatus(): MeshCoreNativeBackgroundWorker.Status =
    backgroundWorker.status()

  private fun readPersistedNativeTarget(): Pair<String, String?>? {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val address = prefs.getString(PREF_NATIVE_ADDRESS, null)?.takeIf { it.isNotBlank() }
      ?: return null
    val label = prefs.getString(PREF_NATIVE_LABEL, null)?.takeIf { it.isNotBlank() }
    return Pair(address, label)
  }

  private fun restoreNativeTargetAfterProcessRestart() {
    val target = readPersistedNativeTarget() ?: return
    requirePermission(this, true)
    BushMeshRadioServiceState.requestRadio(target.second, target.first)
    promote()
    nativeBle.connect(target.first, target.second)
    carInboxNotifier.start()

    // Sticky restart is the only path that grants native background ownership.
    // The epoch is immediately invalidated if a foreground bridge call returns.
    val recoveryLease = outboxLease.claimBackground()
    inboxCapture.start(recoveryLease)
    backgroundWorker.start(recoveryLease)
  }

  private fun persistNativeTarget(address: String, label: String?) {
    val committed = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(PREF_NATIVE_ADDRESS, address)
      .apply {
        if (label.isNullOrBlank()) {
          remove(PREF_NATIVE_LABEL)
        } else {
          putString(PREF_NATIVE_LABEL, label)
        }
      }
      .commit()
    check(committed) { "Native radio target persistence failed." }
    targetCleanupFailed = false
  }

  private fun requestedTypes(): Int {
    var types = 0
    if (BushMeshRadioServiceState.radioRequested) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    if (BushMeshRadioServiceState.locationRequested) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
    return types
  }

  private fun promote() {
    val types = requestedTypes()
    check(types != 0) { "Cannot promote an inactive runtime." }
    if (BushMeshRadioServiceState.radioRequested) requirePermission(this, true)
    if (BushMeshRadioServiceState.locationRequested) requirePermission(this, false)
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, types)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    foregroundTypes = types
    BushMeshRadioServiceState.markRunning()
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Keeps Bushmesh radio and GPS work visible while off-grid."
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val launchIntent = Intent(this, MainActivity::class.java)
    val pendingIntentFlags =
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      pendingIntentFlags,
    )

    val radioRequested = BushMeshRadioServiceState.radioRequested
    val locationRequested = BushMeshRadioServiceState.locationRequested
    val deviceLabel = BushMeshRadioServiceState.deviceLabel
    val deviceAddress = BushMeshRadioServiceState.deviceAddress
    val nativeState = if (deviceAddress != null) nativeBle.status().state else null
    val recovery = if (backgroundWorkerDelegate.isInitialized()) backgroundWorker.status() else null

    val detail = when {
      recovery?.running == true && recovery.identityRef != null ->
        "Background radio recovery · ${recovery.phase} · ${recovery.identityRef}"
      recovery?.running == true ->
        "Background radio recovery · ${recovery.phase}"
      radioRequested && deviceAddress != null && !deviceLabel.isNullOrBlank() ->
        "Native radio $deviceLabel · ${nativeState ?: "starting"}"
      radioRequested && deviceAddress != null ->
        "Native MeshCore radio · ${nativeState ?: "starting"}"
      radioRequested && locationRequested && !deviceLabel.isNullOrBlank() ->
        "Radio $deviceLabel connected · GPS trail active"
      radioRequested && locationRequested ->
        "Radio runtime · GPS trail active"
      radioRequested && !deviceLabel.isNullOrBlank() ->
        "Radio runtime active for $deviceLabel"
      radioRequested ->
        "Radio runtime active"
      locationRequested ->
        "GPS trail and convoy position tracking active"
      else ->
        "Bushmesh runtime shutting down"
    }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    return builder
      .setContentTitle("Bushmesh off-grid runtime")
      .setContentText(detail)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOnlyAlertOnce(true)
      .build()
  }
}