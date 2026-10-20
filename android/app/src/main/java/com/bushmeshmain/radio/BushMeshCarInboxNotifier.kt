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
  private val channelDirectory = BushMeshCarChannelDirectory(context)
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

    // Permission can be granted later. Do not record a notification receipt
    // while notifications are disabled, otherwise a later queued replay could
    // never be surfaced after the driver enables Android Auto messages.
    if (!notifications.notificationsEnabled()) {
      return
    }

    val alreadyNotified = try {
      receipts.hasSeen(frame)
    } catch (_: Exception) {
      // Receipt persistence failure fails closed to avoid a repeated-alert storm.
      return
    }
    if (alreadyNotified) {
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
        channelName = channelDirectory.nameFor(message.channelIndex),
        senderLabel = null,
        text = message.text,
        timestampMs = timestampMs,
      )

      // Only mark the frame after Android accepted the notification call. If
      // posting fails because permission/state changes, a later replay remains
      // eligible instead of being silently lost.
      receipts.remember(frame)
    } catch (_: Exception) {
      // Notification delivery is supplemental. Never destabilize the GATT
      // runtime or protocol consumers if Android rejects the notification.
    }
  }
}