package com.bushmeshmain.radio

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject

/**
 * React Native bridge for Android/Android Auto Bushmesh messaging.
 *
 * Voice replies use a durable state machine and incoming notification rendering
 * is shared with the native BLE frame listener, so foreground and background
 * paths behave consistently.
 */
class BushMeshCarMessagingModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val replyStore by lazy {
    BushMeshCarReplyStore(reactContext.applicationContext)
  }
  private val notifications by lazy {
    BushMeshCarNotifications(reactContext.applicationContext)
  }
  private val channelDirectory by lazy {
    BushMeshCarChannelDirectory(reactContext.applicationContext)
  }

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
      val timestampMs = timestampMsValue.toLong().takeIf { it > 0L }
        ?: System.currentTimeMillis()

      notifications.postIncoming(
        channelIndex = channelIndex,
        channelName = channelName,
        senderLabel = senderLabel,
        text = text,
        timestampMs = timestampMs,
      )
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

  /**
   * Persists only channel index/display-name pairs. Secrets never enter the car
   * notification directory.
   */
  @ReactMethod
  fun setChannelDirectoryJson(json: String, promise: Promise) {
    try {
      val root = JSONObject(json)
      val entries = mutableMapOf<Int, String>()
      root.keys().forEach { key ->
        val index = key.toIntOrNull() ?: return@forEach
        if (index in 0..7) {
          entries[index] = root.optString(key, "")
        }
      }
      channelDirectory.replace(entries)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_CAR_CHANNEL_DIRECTORY_FAILED", error.message, error)
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
      val result = Arguments.createMap().apply {
        putBoolean("notificationsEnabled", notifications.notificationsEnabled())
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
}