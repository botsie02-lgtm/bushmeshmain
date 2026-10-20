package com.bushmeshmain.radio

import android.content.Context

/**
 * Observes complete MeshCore BLE notifications while Android owns the radio and
 * publishes channel text as Android/Android Auto messaging notifications.
 *
 * It never consumes MeshCore frames, never sends protocol commands and has its
 * own replay registry, so foreground React Native and background protocol
 * workers continue to receive the exact same raw notifications independently.
 */
class BushMeshCarInboxNotifier(
  context: Context,
  private val runtime: MeshCoreNativeBleRuntime,
) {
  private val notifications = BushMeshCarNotifications(context)
  private val receipts = BushMeshCarNotificationReceiptStore(context)
  private var running = false

  private val listener = MeshCoreNativeBleRuntime.FrameListener { frame ->
    handleFrame(frame)
  }

  @Synchronized
  fun start() {
    if (running) {
      return
    }
    running = true
    runtime.addFrameListener(listener)
  }

  @Synchronized
  fun stop() {
    if (!running) {
      return
    }
    runtime.removeFrameListener(listener)
    running = false
  }

  @Synchronized
  fun isRunning(): Boolean = running

  private fun handleFrame(frame: ByteArray) {
    synchronized(this) {
      if (!running) {
        return
      }
    }

    val message = MeshCoreNativeChannelMessageParser.parse(frame) ?: return

    // Permission can be granted later. Do not consume the notification receipt
    // while notifications are disabled, otherwise a queued replay could never
    // be surfaced after the user enables Android Auto messages.
    if (!notifications.notificationsEnabled()) {
      return
    }

    val firstSighting = try {
      receipts.claim(frame)
    } catch (_: Exception) {
      // Persistence failure must fail closed for duplicate suppression: do not
      // create a potentially repeating driver notification storm.
      return
    }
    if (!firstSighting) {
      return
    }

    val timestampMs = message.timestampSeconds
      ?.takeIf { it > 0L }
      ?.let { seconds ->
        if (seconds > Long.MAX_VALUE / 1_000L) System.currentTimeMillis()
        else seconds * 1_000L
      }
      ?: System.currentTimeMillis()

    try {
      notifications.postIncoming(
        channelIndex = message.channelIndex,
        channelName = "Channel ${message.channelIndex}",
        senderLabel = null,
        text = message.text,
        timestampMs = timestampMs,
      )
    } catch (_: Exception) {
      // Notification delivery is supplemental. Never destabilize the GATT
      // runtime or protocol consumers if Android rejects the notification.
    }
  }
}
