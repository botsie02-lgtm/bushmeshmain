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
    const val EXTRA_DEVICE_LABEL = "deviceLabel"

    private const val CHANNEL_ID = "bushmesh_radio_runtime"
    private const val CHANNEL_NAME = "Bushmesh radio runtime"
    private const val NOTIFICATION_ID = 4101
  }

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }

    val deviceLabel = intent?.getStringExtra(EXTRA_DEVICE_LABEL)
    BushMeshRadioServiceState.markStarted(deviceLabel)
    startForeground(NOTIFICATION_ID, buildNotification(deviceLabel))

    // Until BLE ownership moves into this service, do not resurrect it after the
    // process is killed. The active React Native radio session starts it again.
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
      description = "Keeps the active Bushmesh radio runtime in the foreground."
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(deviceLabel: String?): Notification {
    val launchIntent = Intent(this, MainActivity::class.java)
    val pendingIntentFlags =
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      pendingIntentFlags,
    )

    val detail = if (deviceLabel.isNullOrBlank()) {
      "Foreground radio runtime active"
    } else {
      "Foreground runtime active for $deviceLabel"
    }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    return builder
      .setContentTitle("Bushmesh radio")
      .setContentText(detail)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOnlyAlertOnce(true)
      .build()
  }
}
