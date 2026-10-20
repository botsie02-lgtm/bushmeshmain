package com.bushmeshmain.radio

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import com.bushmeshmain.MainActivity
import com.bushmeshmain.R
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Android Auto messaging-notification bridge for Bushmesh channel traffic.
 *
 * Posting a notification never changes MeshCore delivery state. Auto voice
 * replies move through durable queued/inflight/accepted states so a process
 * death cannot silently duplicate a reply whose radio outcome is unknown.
 */
class BushMeshCarMessagingModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val CHANNEL_ID = "bushmesh_radio_messages"
    private const val CHANNEL_NAME = "Bushmesh radio messages"
    private const val NOTIFICATION_BASE_ID = 24_000
    private const val REPLY_REQUEST_BASE = 34_000
    private const val READ_REQUEST_BASE = 35_000
    private const val MAX_MESSAGE_CHARS = 2_000
  }

  private val replyStore by lazy { BushMeshCarReplyStore(reactContext.applicationContext) }

  override fun getName(): String = "BushMeshCarMessaging"

  @ReactMethod
  fun postIncomingChannelMessage(
    channelIndexValue: Double,
    channelName: String,
    senderLabel: String?,
    text: String,
    timestampMsValue: Double,
    promise: Promise,
  ) {
    try {
      val channelIndex = channelIndexValue.toInt()
      require(channelIndexValue == channelIndex.toDouble() && channelIndex in 0..7) {
        "Android Auto channel index must be an integer from 0 to 7."
      }
      val cleanText = text.trim()
      require(cleanText.isNotEmpty()) { "Android Auto message cannot be empty." }
      require(cleanText.length <= MAX_MESSAGE_CHARS) { "Android Auto message is too long." }

      val timestampMs = timestampMsValue.toLong().takeIf { it > 0L }
        ?: System.currentTimeMillis()
      val cleanChannelName = channelName.trim().ifBlank { "Channel $channelIndex" }
      val cleanSender = senderLabel?.trim()?.takeIf { it.isNotEmpty() } ?: cleanChannelName

      ensureNotificationChannel()

      val notificationId = notificationId(channelIndex)
      val devicePerson = Person.Builder()
        .setName("Bushmesh driver")
        .setKey("bushmesh-local-driver")
        .build()
      val senderPerson = Person.Builder()
        .setName(cleanSender)
        .setKey("bushmesh-channel-$channelIndex")
        .build()

      val style = NotificationCompat.MessagingStyle(devicePerson)
        .setConversationTitle(cleanChannelName)
        .setGroupConversation(true)
        .addMessage(cleanText, timestampMs, senderPerson)

      val replyRemoteInput = RemoteInput.Builder(
        BushMeshCarMessagingService.REMOTE_INPUT_KEY,
      )
        .setLabel("Reply to $cleanChannelName")
        .build()

      val replyIntent = Intent(
        reactContext,
        BushMeshCarMessagingService::class.java,
      ).apply {
        action = BushMeshCarMessagingService.ACTION_REPLY
        putExtra(BushMeshCarMessagingService.EXTRA_CHANNEL_INDEX, channelIndex)
        putExtra(BushMeshCarMessagingService.EXTRA_CHANNEL_NAME, cleanChannelName)
        putExtra(BushMeshCarMessagingService.EXTRA_NOTIFICATION_ID, notificationId)
      }
      val replyPendingIntent = PendingIntent.getService(
        reactContext,
        REPLY_REQUEST_BASE + channelIndex,
        replyIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag(),
      )
      val replyAction = NotificationCompat.Action.Builder(
        android.R.drawable.ic_menu_send,
        "Reply",
        replyPendingIntent,
      )
        .addRemoteInput(replyRemoteInput)
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
        .setShowsUserInterface(false)
        .build()

      val readIntent = Intent(
        reactContext,
        BushMeshCarMessagingService::class.java,
      ).apply {
        action = BushMeshCarMessagingService.ACTION_MARK_AS_READ
        putExtra(BushMeshCarMessagingService.EXTRA_CHANNEL_INDEX, channelIndex)
        putExtra(BushMeshCarMessagingService.EXTRA_CHANNEL_NAME, cleanChannelName)
        putExtra(BushMeshCarMessagingService.EXTRA_NOTIFICATION_ID, notificationId)
      }
      val readPendingIntent = PendingIntent.getService(
        reactContext,
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

      val launchIntent = Intent(reactContext, MainActivity::class.java)
      val contentIntent = PendingIntent.getActivity(
        reactContext,
        0,
        launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
      )

      val notification = NotificationCompat.Builder(reactContext, CHANNEL_ID)
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

      NotificationManagerCompat.from(reactContext).notify(notificationId, notification)
      promise.resolve(true)
    } catch (error: SecurityException) {
      promise.reject(
        "BUSHMESH_CAR_NOTIFICATION_PERMISSION",
        "Notification permission is required for Android Auto radio messages.",
        error,
      )
    } catch (error: Exception) {
      promise.reject("BUSHMESH_CAR_NOTIFY_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun getPendingReplies(maxEntriesValue: Double, promise: Promise) {
    try {
      val maxEntries = maxEntriesValue.toInt().coerceIn(0, 32)
      val result = Arguments.createArray()
      replyStore.listQueued(maxEntries).forEach { entry ->
        result.pushMap(entryToMap(entry))
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_CAR_REPLIES_READ_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun markReplyAttempt(id: String, promise: Promise) {
    try {
      promise.resolve(replyStore.markAttempt(id.trim()))
    } catch (error: Exception) {
      promise.reject("BUSHMESH_CAR_REPLY_ATTEMPT_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun requeueReplyAfterFailure(id: String, errorMessage: String, promise: Promise) {
    try {
      promise.resolve(
        replyStore.requeueAfterFailure(id.trim(), errorMessage.trim()),
      )
    } catch (error: Exception) {
      promise.reject("BUSHMESH_CAR_REPLY_REQUEUE_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun markReplyBlocked(id: String, reason: String, promise: Promise) {
    try {
      promise.resolve(replyStore.markBlocked(id.trim(), reason))
    } catch (error: Exception) {
      promise.reject("BUSHMESH_CAR_REPLY_BLOCK_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun markReplyAccepted(id: String, promise: Promise) {
    try {
      promise.resolve(replyStore.markAccepted(id.trim()))
    } catch (error: Exception) {
      promise.reject("BUSHMESH_CAR_REPLY_ACCEPT_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun acknowledgeReply(id: String, promise: Promise) {
    try {
      promise.resolve(replyStore.acknowledge(id.trim()))
    } catch (error: Exception) {
      promise.reject("BUSHMESH_CAR_REPLY_ACK_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    try {
      ensureNotificationChannel()
      val result = Arguments.createMap().apply {
        putBoolean(
          "notificationsEnabled",
          NotificationManagerCompat.from(reactContext).areNotificationsEnabled(),
        )
        putDouble("queuedReplies", replyStore.queuedCount().toDouble())
        putDouble("inflightReplies", replyStore.inflightCount().toDouble())
        putDouble("blockedReplies", replyStore.blockedCount().toDouble())
        putDouble("acceptedReplies", replyStore.acceptedCount().toDouble())
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_CAR_STATUS_FAILED", error.message, error)
    }
  }

  private fun entryToMap(entry: BushMeshCarReplyStore.Entry) =
    Arguments.createMap().apply {
      putString("id", entry.id)
      putDouble("channelIndex", entry.channelIndex.toDouble())
      putString("channelName", entry.channelName)
      putString("text", entry.text)
      putDouble("createdAtMs", entry.createdAtMs.toDouble())
      putDouble("attempts", entry.attempts.toDouble())
      if (entry.lastAttemptAtMs == null) {
        putNull("lastAttemptAtMs")
      } else {
        putDouble("lastAttemptAtMs", entry.lastAttemptAtMs.toDouble())
      }
      putString("lastError", entry.lastError)
      putString("state", entry.state)
    }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = reactContext.getSystemService(NotificationManager::class.java)
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

  private fun notificationId(channelIndex: Int): Int =
    NOTIFICATION_BASE_ID + channelIndex

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
