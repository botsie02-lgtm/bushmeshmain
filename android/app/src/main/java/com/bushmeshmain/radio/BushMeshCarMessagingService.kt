package com.bushmeshmain.radio

import android.app.IntentService
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput

/**
 * Handles Android Auto messaging actions without bringing an Activity to the
 * foreground. Voice replies are written to the encrypted pending-reply store;
 * mark-as-read simply clears the current conversation notification.
 */
@Suppress("DEPRECATION")
class BushMeshCarMessagingService : IntentService("BushMeshCarMessagingService") {
  companion object {
    const val ACTION_REPLY = "com.bushmeshmain.car.REPLY"
    const val ACTION_MARK_AS_READ = "com.bushmeshmain.car.MARK_AS_READ"
    const val EXTRA_CHANNEL_INDEX = "channelIndex"
    const val EXTRA_CHANNEL_NAME = "channelName"
    const val EXTRA_NOTIFICATION_ID = "notificationId"
    const val REMOTE_INPUT_KEY = "bushmesh_car_reply"
  }

  override fun onHandleIntent(intent: Intent?) {
    val command = intent ?: return
    val channelIndex = command.getIntExtra(EXTRA_CHANNEL_INDEX, -1)
    val channelName = command.getStringExtra(EXTRA_CHANNEL_NAME)?.trim().orEmpty()
    val notificationId = command.getIntExtra(EXTRA_NOTIFICATION_ID, -1)

    when (command.action) {
      ACTION_REPLY -> {
        if (channelIndex !in 0..7) {
          return
        }
        val reply = RemoteInput
          .getResultsFromIntent(command)
          ?.getCharSequence(REMOTE_INPUT_KEY)
          ?.toString()
          ?.trim()
          .orEmpty()

        if (reply.isNotEmpty()) {
          try {
            BushMeshCarReplyStore(applicationContext).enqueue(
              channelIndex = channelIndex,
              channelName = channelName.ifBlank { "Channel $channelIndex" },
              text = reply,
            )
          } catch (_: Exception) {
            // The reply remains unsent. Do not fabricate a success state if
            // encrypted persistence failed.
            return
          }
        }

        if (notificationId >= 0) {
          NotificationManagerCompat.from(this).cancel(notificationId)
        }
      }

      ACTION_MARK_AS_READ -> {
        if (notificationId >= 0) {
          NotificationManagerCompat.from(this).cancel(notificationId)
        }
      }
    }
  }
}
