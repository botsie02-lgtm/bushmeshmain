package com.bushmeshmain.radio

import android.content.Context

/**
 * Captures complete MeshCore channel-data frames while Android owns the
 * background lease. It deliberately does not inspect application data types or
 * payload bytes; foreground runtime consumers decide what protocol owns them.
 */
class BushMeshNativeInboxCapture(
  context: Context,
  private val runtime: MeshCoreNativeBleRuntime,
) {
  companion object {
    private const val MESHCORE_CHANNEL_DATA_RECV = 0x1b
    private const val CHANNEL_DATA_HEADER_BYTES = 9
  }

  private val lease = BushMeshOutboxLease(context)
  private val inbox = BushMeshNativeInboxStore(context)
  private var activeLease: BushMeshOutboxLease.Lease? = null
  private var running = false

  private val listener = MeshCoreNativeBleRuntime.FrameListener { frame ->
    capture(frame)
  }

  @Synchronized
  fun start(backgroundLease: BushMeshOutboxLease.Lease) {
    if (
      backgroundLease.owner != BushMeshOutboxLease.OWNER_BACKGROUND ||
      !lease.stillOwns(backgroundLease)
    ) {
      throw IllegalStateException("Native inbox capture requires the active background lease.")
    }

    if (running && activeLease == backgroundLease) {
      return
    }
    if (running) {
      stop()
    }

    activeLease = backgroundLease
    running = true
    runtime.addFrameListener(listener)
  }

  @Synchronized
  fun stop() {
    if (running) {
      runtime.removeFrameListener(listener)
    }
    running = false
    activeLease = null
  }

  private fun capture(frame: ByteArray) {
    val expectedLease = synchronized(this) {
      if (!running) null else activeLease
    } ?: return

    if (!lease.stillOwns(expectedLease)) {
      stop()
      return
    }

    if (frame.size < CHANNEL_DATA_HEADER_BYTES) {
      return
    }
    if ((frame[0].toInt() and 0xff) != MESHCORE_CHANNEL_DATA_RECV) {
      return
    }

    val payloadLength = frame[8].toInt() and 0xff
    if (frame.size != CHANNEL_DATA_HEADER_BYTES + payloadLength) {
      return
    }

    try {
      inbox.append(frame)
    } catch (_: Exception) {
      // Inbound capture is best-effort and must never destabilize GATT or the
      // outbox worker. The live frame remains in the runtime's JS buffer.
    }
  }
}
