package com.bushmeshmain.radio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
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
  }

  private val nativeBle: MeshCoreNativeBleRuntime by lazy {
    MeshCoreNativeBleRuntime.get(applicationContext)
  }

  private val outboxLease: BushMeshOutboxLease by lazy {
    BushMeshOutboxLease(applicationContext)
  }

  private val backgroundWorker: MeshCoreNativeBackgroundWorker by lazy {
    MeshCoreNativeBackgroundWorker(applicationContext, nativeBle)
  }

  private val inboxCapture: BushMeshNativeInboxCapture by lazy {
    BushMeshNativeInboxCapture(applicationContext, nativeBle)
  }

  private val carInboxNotifier: BushMeshCarInboxNotifier by lazy {
    BushMeshCarInboxNotifier(applicationContext, nativeBle)
  }

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action

    if (intent == null) {
      restoreNativeTargetAfterProcessRestart()
    } else {
      // Any explicit command means a foreground/React process is interacting
      // with the service again. Yield background protocol + inbox writers before
      // processing it so they cannot race the returning foreground session.
      // The Auto notifier is read-only and may remain attached to native BLE.
      inboxCapture.stop()
      backgroundWorker.stop()

      when (action) {
        ACTION_START -> {
          val requestedLabel = intent.getStringExtra(EXTRA_DEVICE_LABEL)
          val requestedAddress = intent.getStringExtra(EXTRA_DEVICE_ADDRESS)

          if (!requestedAddress.isNullOrBlank()) {
            BushMeshRadioServiceState.requestRadio(requestedLabel, requestedAddress)
            persistNativeTarget(requestedAddress, requestedLabel)
            nativeBle.connect(requestedAddress, requestedLabel)
            carInboxNotifier.start()
          } else {
            // Runtime keepalive calls from the React provider must not silently
            // steal ownership from a native BLE session. If a native target was
            // already persisted, preserve it and keep Android responsible for
            // reconnect. Returning to RN ownership requires ACTION_STOP first.
            val persisted = readPersistedNativeTarget()
            val existingAddress =
              BushMeshRadioServiceState.deviceAddress ?: persisted?.first
            val existingLabel =
              BushMeshRadioServiceState.deviceLabel ?: persisted?.second

            if (existingAddress != null) {
              BushMeshRadioServiceState.requestRadio(existingLabel, existingAddress)
              nativeBle.connect(existingAddress, existingLabel)
              carInboxNotifier.start()
            } else {
              BushMeshRadioServiceState.requestRadio(requestedLabel, null)
              carInboxNotifier.stop()
            }
          }
        }

        ACTION_STOP -> {
          carInboxNotifier.stop()
          BushMeshRadioServiceState.releaseRadio()
          clearPersistedNativeTarget()
          nativeBle.disconnect()
        }

        ACTION_REQUEST_LOCATION -> BushMeshRadioServiceState.requestLocation()
        ACTION_RELEASE_LOCATION -> BushMeshRadioServiceState.releaseLocation()
      }
    }

    if (!BushMeshRadioServiceState.shouldRun()) {
      carInboxNotifier.stop()
      // Release commands are dispatched through startForegroundService on modern
      // Android. Promote immediately using only the type being released, then
      // stop. This satisfies the foreground-service contract without forcing a
      // radio-only session to also meet location prerequisites (or vice versa).
      BushMeshRadioServiceState.markRunning()
      startForegroundForCurrentState(action)
      stopForeground(STOP_FOREGROUND_REMOVE)
      BushMeshRadioServiceState.markStopped()
      stopSelf(startId)
      return START_NOT_STICKY
    }

    BushMeshRadioServiceState.markRunning()
    startForegroundForCurrentState(action)

    // A native BLE target is persisted by device address, so Android can
    // recreate the service and reconnect even when the React Native process was
    // killed. Legacy RN-owned sessions remain non-sticky until migration ends.
    return if (BushMeshRadioServiceState.deviceAddress != null) {
      START_STICKY
    } else {
      START_NOT_STICKY
    }
  }

  override fun onDestroy() {
    carInboxNotifier.stop()
    inboxCapture.stop()
    backgroundWorker.stop()
    nativeBle.disconnect(clearTarget = false)
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
    BushMeshRadioServiceState.requestRadio(target.second, target.first)
    nativeBle.connect(target.first, target.second)
    carInboxNotifier.start()

    // Sticky restart is the only path that grants native background ownership.
    // The epoch is immediately invalidated if a foreground bridge call returns.
    val recoveryLease = outboxLease.claimBackground()
    inboxCapture.start(recoveryLease)
    backgroundWorker.start(recoveryLease)
  }

  private fun persistNativeTarget(address: String, label: String?) {
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(PREF_NATIVE_ADDRESS, address)
      .apply {
        if (label.isNullOrBlank()) {
          remove(PREF_NATIVE_LABEL)
        } else {
          putString(PREF_NATIVE_LABEL, label)
        }
      }
      .apply()
  }

  private fun clearPersistedNativeTarget() {
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .remove(PREF_NATIVE_ADDRESS)
      .remove(PREF_NATIVE_LABEL)
      .apply()
  }

  private fun startForegroundForCurrentState(action: String?) {
    val notification = buildNotification()

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification)
      return
    }

    var serviceType = 0
    if (BushMeshRadioServiceState.radioRequested) {
      serviceType = serviceType or ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    }
    if (BushMeshRadioServiceState.locationRequested) {
      serviceType = serviceType or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
    }

    if (serviceType == 0) {
      serviceType = when (action) {
        ACTION_RELEASE_LOCATION -> ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        else -> ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
      }
    }

    startForeground(NOTIFICATION_ID, notification, serviceType)
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
    val recovery = backgroundWorker.status()

    val detail = when {
      recovery.running && recovery.identityRef != null ->
        "Background radio recovery · ${recovery.phase} · ${recovery.identityRef}"
      recovery.running ->
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