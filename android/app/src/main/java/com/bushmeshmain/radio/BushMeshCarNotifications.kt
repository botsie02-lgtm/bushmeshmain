package com.bushmeshmain.radio

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import com.bushmeshmain.MainActivity
import com.bushmeshmain.R

/** Shared Android/Android Auto message notification publisher. */
class BushMeshCarNotifications(context: Context) {
  companion object {
    private const val CHANNEL_ID = "bushmesh_radio_messages"
    private const val CHANNEL_NAME = "Bushmesh radio messages"
    private const val NOTIFICATION_BASE_ID = 24_000
    private const val REPLY_REQUEST_BASE = 34_000
    private const val READ_REQUEST_BASE = 35_000
    private const val MAX_MESSAGE_CHARS = 2_000
  }

  private val appContext = context.applicationContext

  fun postIncoming(
    channelIndex: Int,
    channelName: String,
    senderLabel: String?,
    text: String,
    timestampMs: Long,
  ) {
    require(channelIndex in 0..7) {
      "Android Auto channel index must be from 0 to 7."
    }

    val cleanText = text.trim()
    require(cleanText.isNotEmpty()) { "Android Auto message cannot be empty." }
    require(cleanText.length <= MAX_MESSAGE_CHARS) { "Android Auto message is too long." }

    val cleanChannelName = channelName.trim().ifBlank { "Channel $channelIndex" }
    val cleanSender = senderLabel?.trim()?.takeIf { it.isNotEmpty() }
      ?: cleanChannelName
    val notificationId = NOTIFICATION_BASE_ID + channelIndex

    ensureChannel()

    val localPerson = Person.Builder()
      .setName("Bushmesh driver")
      .setKey("bushmesh-local-driver")
      .build()
    val senderPerson = Person.Builder()
      .setName(cleanSender)
      .setKey("bushmesh-channel-$channelIndex")
      .build()

    val style = NotificationCompat.MessagingStyle(localPerson)
      .setConversationTitle(cleanChannelName)
      .setGroupConversation(true)
      .addMessage(cleanText, timestampMs.coerceAtLeast(0L), senderPerson)

    val remoteInput = RemoteInput.Builder(
      BushMeshCarMessagingService.REMOTE_INPUT_KEY,
    )
      .setLabel("Reply to $cleanChannelName")
      .build()

    val replyIntent = Intent(appContext, BushMeshCarMessagingService::class.java).apply {
      action = BushMeshCarMessagingService.ACTION_REPLY
      putExtra(BushMeshCarMessagingService.EXTRA_CHANNEL_INDEX, channelIndex)
      putExtra(BushMeshCarMessagingService.EXTRA_CHANNEL_NAME, cleanChannelName)
      putExtra(BushMeshCarMessagingService.EXTRA_NOTIFICATION_ID, notificationId)
    }
    val replyPendingIntent = PendingIntent.getService(
      appContext,
      REPLY_REQUEST_BASE + channelIndex,
      replyIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag(),
    )
    val replyAction = NotificationCompat.Action.Builder(
      android.R.drawable.ic_menu_send,
      "Reply",
      replyPendingIntent,
    )
      .addRemoteInput(remoteInput)
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
      .setShowsUserInterface(false)
      .build()

    val readIntent = Intent(appContext, BushMeshCarMessagingService::class.java).apply {
      action = BushMeshCarMessagingService.ACTION_MARK_AS_READ
      putExtra(BushMeshCarMessagingService.EXTRA_CHANNEL_INDEX, channelIndex)
      putExtra(BushMeshCarMessagingService.EXTRA_CHANNEL_NAME, cleanChannelName)
      putExtra(BushMeshCarMessagingService.EXTRA_NOTIFICATION_ID, notificationId)
    }
    val readPendingIntent = PendingIntent.getService(
      appContext,
      READ_REQUEST_BASE + channelIndex,
      readIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )
    val readAction = NotificationCompat.Action.Builder(
      android.R.drawable.ic_menu_view,
      "Mark as read",
      readPendingIntent,
    )
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
      .setShowsUserInterface(false)
      .build()

    val launchIntent = Intent(appContext, MainActivity::class.java)
    val contentIntent = PendingIntent.getActivity(
      appContext,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )

    val notification = NotificationCompat.Builder(appContext, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(cleanChannelName)
      .setContentText(cleanText)
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setAutoCancel(true)
      .setOnlyAlertOnce(false)
      .setStyle(style)
      .addAction(replyAction)
      .addInvisibleAction(readAction)
      .build()

    NotificationManagerCompat.from(appContext).notify(notificationId, notification)
  }

  fun notificationsEnabled(): Boolean =
    NotificationManagerCompat.from(appContext).areNotificationsEnabled()

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = appContext.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        CHANNEL_NAME,
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Incoming Bushmesh radio messages and Android Auto voice replies."
      },
    )
  }

  private fun mutableFlag(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_MUTABLE
    } else {
      0
    }

  private fun immutableFlag(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      PendingIntent.FLAG_IMMUTABLE
    } else {
      0
    }
}
