package com.bushmeshmain.radio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
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

    private const val CHANNEL_ID = "bushmesh_radio_runtime"
    private const val CHANNEL_NAME = "Bushmesh off-grid runtime"
    private const val NOTIFICATION_ID = 4101
  }

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        BushMeshRadioServiceState.requestRadio(
          intent.getStringExtra(EXTRA_DEVICE_LABEL),
        )
      }

      ACTION_STOP -> BushMeshRadioServiceState.releaseRadio()
      ACTION_REQUEST_LOCATION -> BushMeshRadioServiceState.requestLocation()
      ACTION_RELEASE_LOCATION -> BushMeshRadioServiceState.releaseLocation()
    }

    if (!BushMeshRadioServiceState.shouldRun()) {
      // Calls arrive through startForegroundService on modern Android. Promote
      // immediately, even for a final release action, then tear down cleanly so
      // Android never sees a foreground-service start that failed to foreground.
      BushMeshRadioServiceState.markRunning()
      startForeground(NOTIFICATION_ID, buildNotification())
      stopForeground(STOP_FOREGROUND_REMOVE)
      BushMeshRadioServiceState.markStopped()
      stopSelf(startId)
      return START_NOT_STICKY
    }

    BushMeshRadioServiceState.markRunning()
    startForeground(NOTIFICATION_ID, buildNotification())

    // BLE is still owned by the active React Native MeshCore session. Until BLE
    // ownership itself moves into this service, do not resurrect an orphaned
    // foreground runtime after process death.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    BushMeshRadioServiceState.markStopped()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

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

    val detail = when {
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
