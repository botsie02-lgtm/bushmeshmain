package com.bushmeshmain.radio

import android.content.Context
import android.os.Handler
import android.os.Looper
import java.nio.charset.StandardCharsets
import kotlin.math.min

/**
 * Native MeshCore recovery worker used when Android resurrects the foreground
 * radio service without a React Native process.
 *
 * It performs the minimum companion bootstrap needed to prove radio identity,
 * then drains only identity-matched Bushmesh channel-data entries from the same
 * encrypted outbox used by JS. Every attempted packet is persisted as in-flight
 * before the BLE command is issued, giving restart recovery at-least-once
 * semantics without ever treating radio acceptance as peer delivery.
 */
class MeshCoreNativeBackgroundWorker(
  context: Context,
  private val runtime: MeshCoreNativeBleRuntime,
) {
  data class Status(
    val running: Boolean,
    val phase: String,
    val identityRef: String?,
    val firmwareVersion: Int?,
    val maxChannels: Int?,
    val pendingOutboxId: String?,
    val lastError: String?,
    val acceptedCount: Long,
    val leaseEpoch: Long,
  )

  private data class PendingCommand(
    val label: String,
    val expectedPacketType: Int,
    val deadlineMs: Long,
    val outboxId: String? = null,
  )

  companion object {
    private const val TICK_MS = 250L
    private const val COMMAND_TIMEOUT_MS = 5_000L
    private const val BASE_RETRY_DELAY_MS = 2_000L
    private const val MAX_RETRY_DELAY_MS = 60_000L
    private const val BUSHMESH_DEV_DATA_TYPE_MIN = 1
    private const val BUSHMESH_DEV_DATA_TYPE_MAX = 0xffff
  }

  private val handler = Handler(Looper.getMainLooper())
  private val outboxStore = BushMeshNativeOutboxStore(context)
  private val outboxLease = BushMeshOutboxLease(context)
  private val frameListener = MeshCoreNativeBleRuntime.FrameListener { frame ->
    handler.post { handleFrame(frame) }
  }

  private var running = false
  private var recoveryLease: BushMeshOutboxLease.Lease? = null
  private var phase = "stopped"
  private var identityRef: String? = null
  private var firmwareVersion: Int? = null
  private var maxChannels: Int? = null
  private var pending: PendingCommand? = null
  private var activeEntries: MutableList<BushMeshNativeOutboxStore.Entry> = mutableListOf()
  private var lastError: String? = null
  private var acceptedCount = 0L
  private var lastReadyConnectionAtMs = 0L

  private val tickRunnable = object : Runnable {
    override fun run() {
      if (!running) {
        return
      }
      try {
        tick()
      } catch (error: Exception) {
        lastError = error.message ?: "Native background radio worker failed."
        phase = "error"
      } finally {
        if (running) {
          handler.postDelayed(this, TICK_MS)
        }
      }
    }
  }

  @Synchronized
  fun start(lease: BushMeshOutboxLease.Lease) {
    if (
      lease.owner != BushMeshOutboxLease.OWNER_BACKGROUND ||
      !outboxLease.stillOwns(lease)
    ) {
      throw IllegalStateException("Native recovery worker requires the active background outbox lease.")
    }

    if (running && recoveryLease == lease) {
      return
    }
    if (running) {
      stop()
    }

    recoveryLease = lease
    running = true
    phase = "waiting-for-radio"
    lastError = null
    runtime.addFrameListener(frameListener)
    handler.removeCallbacks(tickRunnable)
    handler.post(tickRunnable)
  }

  @Synchronized
  fun stop() {
    running = false
    handler.removeCallbacks(tickRunnable)
    runtime.removeFrameListener(frameListener)
    pending = null
    activeEntries.clear()
    identityRef = null
    firmwareVersion = null
    maxChannels = null
    lastReadyConnectionAtMs = 0L
    recoveryLease = null
    phase = "stopped"
  }

  @Synchronized
  fun status(): Status = Status(
    running = running,
    phase = phase,
    identityRef = identityRef,
    firmwareVersion = firmwareVersion,
    maxChannels = maxChannels,
    pendingOutboxId = pending?.outboxId,
    lastError = lastError,
    acceptedCount = acceptedCount,
    leaseEpoch = recoveryLease?.epoch ?: 0L,
  )

  private fun tick() {
    if (!hasBackgroundLease()) {
      yieldToForeground()
      return
    }

    val now = System.currentTimeMillis()
    val radioStatus = runtime.status()

    if (radioStatus.state != "ready") {
      if (lastReadyConnectionAtMs != 0L) {
        resetProtocolForReconnect()
      }
      phase = "waiting-for-radio"
      return
    }

    if (lastReadyConnectionAtMs != radioStatus.connectedAtMs) {
      lastReadyConnectionAtMs = radioStatus.connectedAtMs
      resetProtocolForReconnect()
    }

    val currentPending = pending
    if (currentPending != null) {
      if (now >= currentPending.deadlineMs) {
        handleCommandTimeout(currentPending, now)
      }
      return
    }

    if (identityRef == null) {
      phase = "app-start"
      sendCommand(
        label = "CMD_APP_START",
        expectedPacketType = 0x05,
        bytes = appStartCommand(),
      )
      return
    }

    if (firmwareVersion == null) {
      phase = "device-query"
      sendCommand(
        label = "CMD_DEVICE_QUERY",
        expectedPacketType = 0x0d,
        bytes = byteArrayOf(0x16, 0x03),
      )
      return
    }

    phase = "ready"
    drainNextOutboxEntry(now)
  }

  private fun hasBackgroundLease(): Boolean {
    val lease = recoveryLease ?: return false
    return lease.owner == BushMeshOutboxLease.OWNER_BACKGROUND &&
      outboxLease.stillOwns(lease)
  }

  private fun yieldToForeground() {
    // Do not write another byte or persist another snapshot after losing the
    // generation lease. Any already-issued radio command may still complete,
    // but the new foreground owner will recover its persisted in-flight state.
    running = false
    handler.removeCallbacks(tickRunnable)
    runtime.removeFrameListener(frameListener)
    pending = null
    activeEntries.clear()
    phase = "yielded"
  }

  private fun resetProtocolForReconnect() {
    val currentPending = pending
    pending = null
    if (currentPending?.outboxId != null && hasBackgroundLease()) {
      recoverPendingOutbox(currentPending.outboxId, "Radio disconnected before acceptance was known.")
    }
    identityRef = null
    firmwareVersion = null
    maxChannels = null
    activeEntries.clear()
  }

  private fun sendCommand(
    label: String,
    expectedPacketType: Int,
    bytes: ByteArray,
    outboxId: String? = null,
  ) {
    if (!hasBackgroundLease() || pending != null) {
      return
    }
    if (!runtime.enqueueWrite(bytes)) {
      lastError = runtime.status().lastError ?: "$label could not be queued to BLE."
      if (outboxId != null && hasBackgroundLease()) {
        recoverPendingOutbox(outboxId, lastError ?: "Native BLE write was rejected.")
      }
      return
    }

    pending = PendingCommand(
      label = label,
      expectedPacketType = expectedPacketType,
      deadlineMs = System.currentTimeMillis() + COMMAND_TIMEOUT_MS,
      outboxId = outboxId,
    )
  }

  private fun handleFrame(frame: ByteArray) {
    if (!running || !hasBackgroundLease() || frame.isEmpty()) {
      return
    }

    val packetType = frame[0].toInt() and 0xff
    val current = pending ?: return

    if (packetType == 0x01) {
      pending = null
      val code = if (frame.size > 1) frame[1].toInt() and 0xff else null
      val message = "${current.label} returned PACKET_ERROR${code?.let { " ($it)" } ?: ""}."
      lastError = message
      if (current.outboxId != null && hasBackgroundLease()) {
        failOutboxAttempt(current.outboxId, message, System.currentTimeMillis())
      }
      return
    }

    if (packetType != current.expectedPacketType) {
      // Push frames and unrelated queued-message traffic remain in the runtime's
      // JS buffer; the native worker only observes them here.
      return
    }

    pending = null
    lastError = null

    when (packetType) {
      0x05 -> handleSelfInfo(frame)
      0x0d -> handleDeviceInfo(frame)
      0x00 -> current.outboxId?.let { acceptOutboxAttempt(it) }
    }
  }

  private fun handleSelfInfo(frame: ByteArray) {
    if (frame.size < 36) {
      identityRef = null
      lastError = "MeshCore SELF_INFO was too short for a public identity."
      phase = "error"
      return
    }

    identityRef = frame
      .sliceArray(4 until 10)
      .joinToString("") { byte -> "%02X".format(byte.toInt() and 0xff) }
    phase = "device-query"
  }

  private fun handleDeviceInfo(frame: ByteArray) {
    if (frame.size < 2) {
      firmwareVersion = null
      lastError = "MeshCore DEVICE_INFO was too short."
      phase = "error"
      return
    }

    firmwareVersion = frame[1].toInt() and 0xff
    maxChannels = if ((firmwareVersion ?: 0) >= 3 && frame.size > 3) {
      (frame[3].toInt() and 0xff).coerceIn(1, 8)
    } else {
      8
    }

    if (!hasBackgroundLease()) {
      yieldToForeground()
      return
    }

    activeEntries = try {
      outboxStore.loadRecoverable().toMutableList()
    } catch (error: Exception) {
      lastError = "Encrypted Bushmesh outbox could not be recovered natively: ${error.message}"
      mutableListOf()
    }
    phase = "ready"
  }

  private fun drainNextOutboxEntry(nowMs: Long) {
    if (!hasBackgroundLease() || activeEntries.isEmpty()) {
      return
    }

    // Drop entries that became expired while the service was alive. Persisting
    // only the remaining active set prevents a stale STOP/HAZARD from reviving
    // on another restart.
    val beforeExpiryCount = activeEntries.size
    activeEntries.removeAll { entry ->
      entry.expiresAtMs != null && nowMs >= entry.expiresAtMs
    }
    if (activeEntries.size != beforeExpiryCount) {
      persistActiveEntries()
    }

    val identity = identityRef ?: return
    val next = activeEntries
      .asSequence()
      .filter { entry ->
        entry.state == "queued" &&
          entry.nextAttemptAtMs <= nowMs &&
          entry.identityRef == identity &&
          entry.channelIndex in 0..7 &&
          entry.dataType in BUSHMESH_DEV_DATA_TYPE_MIN..BUSHMESH_DEV_DATA_TYPE_MAX
      }
      .sortedWith(
        compareBy<BushMeshNativeOutboxStore.Entry> { priorityRank(it.priority) }
          .thenBy { it.createdAtMs },
      )
      .firstOrNull()
      ?: return

    val attempted = next.copy(
      attempts = next.attempts + 1,
      state = "inflight",
      nextAttemptAtMs = nowMs,
      lastError = null,
    )
    replaceEntry(attempted)
    persistActiveEntries()
    if (!hasBackgroundLease()) {
      return
    }

    phase = "sending-outbox"
    sendCommand(
      label = "CMD_SEND_CHANNEL_DATA_${attempted.channelIndex}",
      expectedPacketType = 0x00,
      bytes = channelDataCommand(attempted),
      outboxId = attempted.id,
    )
  }

  private fun acceptOutboxAttempt(id: String) {
    if (!hasBackgroundLease()) {
      return
    }
    activeEntries.removeAll { it.id == id }
    acceptedCount += 1L
    phase = "ready"
    persistActiveEntries()
  }

  private fun failOutboxAttempt(id: String, message: String, nowMs: Long) {
    if (!hasBackgroundLease()) {
      return
    }
    val entry = activeEntries.find { it.id == id } ?: return
    if (entry.attempts >= entry.maxAttempts) {
      activeEntries.removeAll { it.id == id }
    } else {
      replaceEntry(
        entry.copy(
          state = "queued",
          nextAttemptAtMs = nowMs + retryDelayMs(entry.attempts),
          lastError = message,
        ),
      )
    }
    phase = "ready"
    persistActiveEntries()
  }

  private fun recoverPendingOutbox(id: String, message: String) {
    if (!hasBackgroundLease()) {
      return
    }
    val entry = activeEntries.find { it.id == id } ?: return
    replaceEntry(
      entry.copy(
        state = "queued",
        nextAttemptAtMs = System.currentTimeMillis(),
        lastError = message,
      ),
    )
    persistActiveEntries()
  }

  private fun handleCommandTimeout(command: PendingCommand, nowMs: Long) {
    pending = null
    val message = "${command.label} timed out waiting for MeshCore."
    lastError = message
    if (command.outboxId != null) {
      failOutboxAttempt(command.outboxId, message, nowMs)
    } else {
      // Bootstrap commands retry after the next tick without mutating outbox.
      if (command.expectedPacketType == 0x05) {
        identityRef = null
      } else if (command.expectedPacketType == 0x0d) {
        firmwareVersion = null
      }
    }
  }

  private fun persistActiveEntries() {
    if (!hasBackgroundLease()) {
      return
    }
    try {
      if (activeEntries.isEmpty()) {
        outboxStore.clear()
      } else {
        outboxStore.saveActive(activeEntries)
      }
    } catch (error: Exception) {
      lastError = "Native Bushmesh outbox update failed: ${error.message}"
    }
  }

  private fun replaceEntry(updated: BushMeshNativeOutboxStore.Entry) {
    val index = activeEntries.indexOfFirst { it.id == updated.id }
    if (index >= 0) {
      activeEntries[index] = updated
    }
  }

  private fun priorityRank(priority: String): Int = when (priority) {
    "safety" -> 0
    "control" -> 1
    "message" -> 2
    "position" -> 3
    "bulk" -> 4
    else -> 5
  }

  private fun retryDelayMs(attempts: Int): Long {
    val exponent = (attempts - 1).coerceIn(0, 5)
    return min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS shl exponent)
  }

  private fun appStartCommand(): ByteArray {
    val name = "BushMesh".toByteArray(StandardCharsets.UTF_8)
    return byteArrayOf(
      0x01,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ) + name
  }

  private fun channelDataCommand(entry: BushMeshNativeOutboxStore.Entry): ByteArray {
    val header = byteArrayOf(
      0x3e,
      entry.channelIndex.toByte(),
      0xff.toByte(),
      (entry.dataType and 0xff).toByte(),
      ((entry.dataType ushr 8) and 0xff).toByte(),
    )
    return header + entry.payload
  }
}
