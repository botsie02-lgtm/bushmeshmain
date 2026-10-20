package com.bushmeshmain.radio

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.util.ArrayDeque
import java.util.UUID
import kotlin.math.min

/**
 * Native Android owner for the MeshCore Nordic UART BLE transport.
 *
 * The React Native client still remains available during migration. This
 * runtime owns GATT, reconnect, MTU, notifications and serialized writes.
 * Every TX notification is both buffered for a later JS consumer and fanned
 * out to native frame listeners, so background protocol workers do not have to
 * steal frames from the foreground app.
 */
class MeshCoreNativeBleRuntime private constructor(
  private val appContext: Context,
) {
  fun interface FrameListener {
    fun onFrame(frame: ByteArray)
  }

  data class Status(
    val state: String,
    val deviceAddress: String?,
    val deviceLabel: String?,
    val mtu: Int,
    val reconnectAttempt: Int,
    val connectedAtMs: Long,
    val lastError: String?,
    val queuedWrites: Int,
    val bufferedFrames: Int,
  )

  companion object {
    private val SERVICE_UUID: UUID =
      UUID.fromString("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
    private val RX_UUID: UUID =
      UUID.fromString("6E400002-B5A3-F393-E0A9-E50E24DCCA9E")
    private val TX_UUID: UUID =
      UUID.fromString("6E400003-B5A3-F393-E0A9-E50E24DCCA9E")
    private val CCCD_UUID: UUID =
      UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    private const val REQUESTED_MTU = 185
    private const val MAX_BUFFERED_FRAMES = 128
    private const val MAX_QUEUED_WRITES = 64
    private const val MAX_RECONNECT_DELAY_MS = 30_000L

    @Volatile private var instance: MeshCoreNativeBleRuntime? = null

    fun get(context: Context): MeshCoreNativeBleRuntime {
      return instance ?: synchronized(this) {
        instance ?: MeshCoreNativeBleRuntime(context.applicationContext).also {
          instance = it
        }
      }
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private val frameBuffer = ArrayDeque<ByteArray>()
  private val frameListeners = LinkedHashSet<FrameListener>()
  private val writeQueue = ArrayDeque<ByteArray>()

  private var desiredAddress: String? = null
  private var desiredLabel: String? = null
  private var bluetoothGatt: BluetoothGatt? = null
  private var rxCharacteristic: BluetoothGattCharacteristic? = null
  private var txCharacteristic: BluetoothGattCharacteristic? = null
  private var writeInFlight = false
  private var reconnectRunnable: Runnable? = null

  @Volatile private var state: String = "disconnected"
  @Volatile private var mtu: Int = 23
  @Volatile private var reconnectAttempt: Int = 0
  @Volatile private var connectedAtMs: Long = 0L
  @Volatile private var lastError: String? = null

  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      if (gatt !== bluetoothGatt) {
        try {
          gatt.close()
        } catch (_: SecurityException) {
          // A stale callback should never be allowed to affect the active GATT.
        }
        return
      }

      if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
        state = "negotiating-mtu"
        reconnectAttempt = 0
        connectedAtMs = System.currentTimeMillis()
        lastError = null

        try {
          if (!gatt.requestMtu(REQUESTED_MTU)) {
            discoverServices(gatt)
          }
        } catch (error: SecurityException) {
          failAndReconnect("Bluetooth permission was revoked during MTU negotiation: ${error.message}")
        }
        return
      }

      if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
        val reason = if (status == BluetoothGatt.GATT_SUCCESS) {
          "MeshCore BLE disconnected."
        } else {
          "MeshCore BLE disconnected with GATT status $status."
        }
        failAndReconnect(reason)
      }
    }

    override fun onMtuChanged(gatt: BluetoothGatt, negotiatedMtu: Int, status: Int) {
      if (gatt !== bluetoothGatt) {
        return
      }

      if (status == BluetoothGatt.GATT_SUCCESS && negotiatedMtu > 0) {
        mtu = negotiatedMtu
      }
      discoverServices(gatt)
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (gatt !== bluetoothGatt) {
        return
      }

      if (status != BluetoothGatt.GATT_SUCCESS) {
        failAndReconnect("MeshCore BLE service discovery failed with GATT status $status.")
        return
      }

      val service: BluetoothGattService = gatt.getService(SERVICE_UUID) ?: run {
        failAndReconnect("Connected BLE device does not expose the MeshCore NUS service.")
        return
      }
      val rx = service.getCharacteristic(RX_UUID) ?: run {
        failAndReconnect("MeshCore NUS RX characteristic is missing.")
        return
      }
      val tx = service.getCharacteristic(TX_UUID) ?: run {
        failAndReconnect("MeshCore NUS TX characteristic is missing.")
        return
      }

      rxCharacteristic = rx
      txCharacteristic = tx
      state = "enabling-notifications"

      try {
        if (!gatt.setCharacteristicNotification(tx, true)) {
          failAndReconnect("Android could not enable MeshCore TX notifications.")
          return
        }

        val descriptor: BluetoothGattDescriptor = tx.getDescriptor(CCCD_UUID) ?: run {
          failAndReconnect("MeshCore TX notification descriptor is missing.")
          return
        }
        @Suppress("DEPRECATION")
        descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        @Suppress("DEPRECATION")
        if (!gatt.writeDescriptor(descriptor)) {
          failAndReconnect("Android could not write the MeshCore TX notification descriptor.")
        }
      } catch (error: SecurityException) {
        failAndReconnect("Bluetooth permission was revoked while enabling notifications: ${error.message}")
      }
    }

    override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      if (gatt !== bluetoothGatt || descriptor.uuid != CCCD_UUID) {
        return
      }

      if (status != BluetoothGatt.GATT_SUCCESS) {
        failAndReconnect("MeshCore notification setup failed with GATT status $status.")
        return
      }

      state = "ready"
      lastError = null
      processNextWrite()
    }

    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      if (gatt !== bluetoothGatt || characteristic.uuid != TX_UUID) {
        return
      }
      publishFrame(characteristic.value ?: return)
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray,
    ) {
      if (gatt !== bluetoothGatt || characteristic.uuid != TX_UUID) {
        return
      }
      publishFrame(value)
    }

    override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      if (gatt !== bluetoothGatt || characteristic.uuid != RX_UUID) {
        return
      }

      writeInFlight = false
      if (status != BluetoothGatt.GATT_SUCCESS) {
        failAndReconnect("MeshCore BLE write failed with GATT status $status.")
        return
      }
      processNextWrite()
    }
  }

  @Synchronized
  fun addFrameListener(listener: FrameListener) {
    frameListeners.add(listener)
  }

  @Synchronized
  fun removeFrameListener(listener: FrameListener) {
    frameListeners.remove(listener)
  }

  @Synchronized
  fun connect(deviceAddress: String, deviceLabel: String?): Boolean {
    val normalizedAddress = deviceAddress.trim().uppercase()
    if (!BluetoothAdapter.checkBluetoothAddress(normalizedAddress)) {
      lastError = "Invalid Bluetooth device address."
      state = "error"
      return false
    }

    desiredAddress = normalizedAddress
    desiredLabel = deviceLabel?.trim()?.takeIf { it.isNotEmpty() }
    reconnectAttempt = 0
    cancelReconnect()

    if (
      bluetoothGatt != null &&
      state != "disconnected" &&
      state != "error" &&
      state != "reconnecting"
    ) {
      return true
    }

    return connectNow()
  }

  @Synchronized
  fun disconnect(clearTarget: Boolean = true) {
    cancelReconnect()
    if (clearTarget) {
      desiredAddress = null
      desiredLabel = null
    }
    state = "disconnecting"
    rxCharacteristic = null
    txCharacteristic = null
    writeQueue.clear()
    writeInFlight = false
    connectedAtMs = 0L

    val current = bluetoothGatt
    bluetoothGatt = null
    if (current != null) {
      try {
        current.disconnect()
        current.close()
      } catch (_: SecurityException) {
        // Connection teardown should still complete locally if permission changed.
      }
    }
    state = "disconnected"
  }

  /**
   * Drops the current GATT session while preserving the desired radio target.
   * Protocol workers use this after an ambiguous timeout so a delayed response
   * from the old command cannot be attributed to a later command.
   */
  @Synchronized
  fun forceReconnect(reason: String) {
    if (desiredAddress == null) {
      lastError = reason
      state = "disconnected"
      return
    }
    failAndReconnect(reason)
  }

  @Synchronized
  fun enqueueWrite(bytes: ByteArray): Boolean {
    if (bytes.isEmpty()) {
      lastError = "Refusing to write an empty MeshCore BLE frame."
      return false
    }
    if (state != "ready" || bluetoothGatt == null || rxCharacteristic == null) {
      lastError = "MeshCore native BLE transport is not ready."
      return false
    }
    if (writeQueue.size >= MAX_QUEUED_WRITES) {
      lastError = "MeshCore native BLE write queue is full."
      return false
    }

    writeQueue.addLast(bytes.copyOf())
    processNextWrite()
    return true
  }

  @Synchronized
  fun drainFrames(maxFrames: Int = MAX_BUFFERED_FRAMES): List<ByteArray> {
    val limit = min(maxFrames.coerceAtLeast(0), MAX_BUFFERED_FRAMES)
    val result = ArrayList<ByteArray>(min(limit, frameBuffer.size))
    repeat(limit) {
      val frame = frameBuffer.pollFirst() ?: return@repeat
      result.add(frame.copyOf())
    }
    return result
  }

  @Synchronized
  fun status(): Status {
    return Status(
      state = state,
      deviceAddress = desiredAddress,
      deviceLabel = desiredLabel,
      mtu = mtu,
      reconnectAttempt = reconnectAttempt,
      connectedAtMs = connectedAtMs,
      lastError = lastError,
      queuedWrites = writeQueue.size + if (writeInFlight) 1 else 0,
      bufferedFrames = frameBuffer.size,
    )
  }

  @Synchronized
  private fun connectNow(): Boolean {
    val address = desiredAddress ?: return false
    if (!hasConnectPermission()) {
      state = "error"
      lastError = "Bluetooth connect permission is required for native radio ownership."
      return false
    }

    val manager = appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    val adapter = manager?.adapter
    if (adapter == null || !adapter.isEnabled) {
      state = "reconnecting"
      lastError = "Bluetooth is unavailable or disabled."
      scheduleReconnect()
      return false
    }

    closeGattWithoutClearingTarget()
    state = "connecting"
    lastError = null

    return try {
      val device = adapter.getRemoteDevice(address)
      bluetoothGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        device.connectGatt(appContext, false, callback, BluetoothDevice.TRANSPORT_LE)
      } else {
        @Suppress("DEPRECATION")
        device.connectGatt(appContext, false, callback)
      }
      bluetoothGatt != null
    } catch (error: Exception) {
      state = "reconnecting"
      lastError = "Could not start MeshCore BLE connection: ${error.message}"
      scheduleReconnect()
      false
    }
  }

  @Synchronized
  private fun discoverServices(gatt: BluetoothGatt) {
    if (gatt !== bluetoothGatt) {
      return
    }
    state = "discovering-services"
    try {
      if (!gatt.discoverServices()) {
        failAndReconnect("Android could not start MeshCore BLE service discovery.")
      }
    } catch (error: SecurityException) {
      failAndReconnect("Bluetooth permission was revoked during service discovery: ${error.message}")
    }
  }

  @Synchronized
  private fun processNextWrite() {
    if (writeInFlight || state != "ready") {
      return
    }

    val gatt = bluetoothGatt ?: return
    val characteristic = rxCharacteristic ?: return
    val next = writeQueue.pollFirst() ?: return

    try {
      characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
      @Suppress("DEPRECATION")
      characteristic.value = next
      @Suppress("DEPRECATION")
      val started = gatt.writeCharacteristic(characteristic)
      if (!started) {
        failAndReconnect("Android rejected a MeshCore BLE write before transmission.")
        return
      }
      writeInFlight = true
    } catch (error: SecurityException) {
      failAndReconnect(
        "Bluetooth permission was revoked during MeshCore BLE write: ${error.message}",
      )
    }
  }

  private fun publishFrame(value: ByteArray) {
    val frame = value.copyOf()
    val listeners: List<FrameListener>

    synchronized(this) {
      if (frameBuffer.size >= MAX_BUFFERED_FRAMES) {
        frameBuffer.removeFirst()
      }
      frameBuffer.addLast(frame.copyOf())
      listeners = frameListeners.toList()
    }

    listeners.forEach { listener ->
      try {
        listener.onFrame(frame.copyOf())
      } catch (_: Exception) {
        // One protocol consumer must never break BLE notification delivery to
        // the frame buffer or other listeners.
      }
    }
  }

  @Synchronized
  private fun failAndReconnect(message: String) {
    lastError = message
    state = "reconnecting"
    connectedAtMs = 0L
    rxCharacteristic = null
    txCharacteristic = null
    writeInFlight = false
    writeQueue.clear()
    closeGattWithoutClearingTarget()
    scheduleReconnect()
  }

  @Synchronized
  private fun scheduleReconnect() {
    if (desiredAddress == null || reconnectRunnable != null) {
      return
    }

    reconnectAttempt += 1
    val shift = (reconnectAttempt - 1).coerceIn(0, 5)
    val delayMs = min(MAX_RECONNECT_DELAY_MS, 1_000L shl shift)
    val runnable = Runnable {
      synchronized(this) {
        reconnectRunnable = null
        connectNow()
      }
    }
    reconnectRunnable = runnable
    handler.postDelayed(runnable, delayMs)
  }

  @Synchronized
  private fun cancelReconnect() {
    reconnectRunnable?.let(handler::removeCallbacks)
    reconnectRunnable = null
  }

  @Synchronized
  private fun closeGattWithoutClearingTarget() {
    val current = bluetoothGatt
    bluetoothGatt = null
    if (current != null) {
      try {
        current.close()
      } catch (_: SecurityException) {
        // Local state still resets even if Android revokes permission mid-session.
      }
    }
  }

  private fun hasConnectPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      return true
    }
    return appContext.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) ==
      PackageManager.PERMISSION_GRANTED
  }
}
