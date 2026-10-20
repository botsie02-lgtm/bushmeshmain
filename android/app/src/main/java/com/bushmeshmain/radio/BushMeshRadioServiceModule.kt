package com.bushmeshmain.radio

import android.content.Intent
import android.os.Build
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeMap
import org.json.JSONArray

class BushMeshRadioServiceModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "BushMeshRadioService"

  private val nativeBle: MeshCoreNativeBleRuntime by lazy {
    MeshCoreNativeBleRuntime.get(reactContext.applicationContext)
  }

  private val outboxLease: BushMeshOutboxLease by lazy {
    BushMeshOutboxLease(reactContext.applicationContext)
  }

  private val nativeInbox: BushMeshNativeInboxStore by lazy {
    BushMeshNativeInboxStore(reactContext.applicationContext)
  }

  private val nativeChannelInbox: BushMeshNativeChannelInboxStore by lazy {
    BushMeshNativeChannelInboxStore(reactContext.applicationContext)
  }

  @ReactMethod
  fun start(deviceLabel: String?, promise: Promise) {
    try {
      outboxLease.claimForeground()
      dispatch(BushMeshRadioService.ACTION_START, deviceLabel, null)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_RADIO_SERVICE_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun startNativeBle(deviceAddress: String, deviceLabel: String?, promise: Promise) {
    try {
      outboxLease.claimForeground()
      dispatch(BushMeshRadioService.ACTION_START, deviceLabel, deviceAddress)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_NATIVE_BLE_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      outboxLease.claimForeground()
      dispatch(BushMeshRadioService.ACTION_STOP, null, null)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_RADIO_SERVICE_STOP_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun enqueueNativeBleWrite(base64Frame: String, promise: Promise) {
    try {
      val frame = Base64.decode(base64Frame, Base64.DEFAULT)
      promise.resolve(nativeBle.enqueueWrite(frame))
    } catch (error: IllegalArgumentException) {
      promise.reject("BUSHMESH_NATIVE_BLE_INVALID_FRAME", "BLE frame is not valid base64.", error)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_NATIVE_BLE_WRITE_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun drainNativeBleFrames(maxFrames: Double, promise: Promise) {
    try {
      val frames = nativeBle.drainFrames(maxFrames.toInt().coerceIn(0, 128))
      val result = Arguments.createArray()
      frames.forEach { frame ->
        result.pushString(Base64.encodeToString(frame, Base64.NO_WRAP))
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_NATIVE_BLE_DRAIN_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun drainBackgroundInbox(maxFrames: Double, promise: Promise) {
    try {
      val frames = nativeInbox.drain(maxFrames.toInt().coerceIn(0, 128))
      val result = Arguments.createArray()
      frames.forEach { entry ->
        val item = Arguments.createMap().apply {
          putDouble("receivedAtMs", entry.receivedAtMs.toDouble())
          putString("frameBase64", Base64.encodeToString(entry.frame, Base64.NO_WRAP))
        }
        result.pushMap(item)
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_NATIVE_INBOX_DRAIN_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun listBackgroundChannelInbox(maxFrames: Double, promise: Promise) {
    try {
      val frames = nativeChannelInbox.list(maxFrames.toInt().coerceIn(0, 128))
      val result = Arguments.createArray()
      frames.forEach { entry ->
        val item = Arguments.createMap().apply {
          putString("id", entry.id)
          putDouble("receivedAtMs", entry.receivedAtMs.toDouble())
          putString("frameBase64", Base64.encodeToString(entry.frame, Base64.NO_WRAP))
        }
        result.pushMap(item)
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject(
        "BUSHMESH_NATIVE_CHANNEL_INBOX_LIST_FAILED",
        error.message,
        error,
      )
    }
  }

  @ReactMethod
  fun acknowledgeBackgroundChannelInboxJson(idsJson: String, promise: Promise) {
    try {
      val array = JSONArray(idsJson)
      val ids = mutableListOf<String>()
      for (index in 0 until array.length()) {
        val id = array.optString(index, "").trim()
        if (id.isNotEmpty()) {
          ids.add(id)
        }
      }
      promise.resolve(nativeChannelInbox.acknowledge(ids).toDouble())
    } catch (error: Exception) {
      promise.reject(
        "BUSHMESH_NATIVE_CHANNEL_INBOX_ACK_FAILED",
        error.message,
        error,
      )
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val nativeStatus = nativeBle.status()
    val nativeOwnership = BushMeshRadioServiceState.deviceAddress != null
    val lease = outboxLease.current()

    val status: WritableMap = WritableNativeMap().apply {
      putBoolean("running", BushMeshRadioServiceState.running)
      putBoolean("radioRequested", BushMeshRadioServiceState.radioRequested)
      putBoolean("locationRequested", BushMeshRadioServiceState.locationRequested)
      putString("deviceLabel", BushMeshRadioServiceState.deviceLabel)
      putDouble("startedAtMs", BushMeshRadioServiceState.startedAtMs.toDouble())
      putString("ownership", if (nativeOwnership) "native-service" else "react-native-session")
      putString("nativeBleState", nativeStatus.state)
      putString("nativeBleDeviceAddress", nativeStatus.deviceAddress)
      putString("nativeBleDeviceLabel", nativeStatus.deviceLabel)
      putDouble("nativeBleMtu", nativeStatus.mtu.toDouble())
      putDouble("nativeBleReconnectAttempt", nativeStatus.reconnectAttempt.toDouble())
      putDouble("nativeBleConnectedAtMs", nativeStatus.connectedAtMs.toDouble())
      putString("nativeBleLastError", nativeStatus.lastError)
      putDouble("nativeBleQueuedWrites", nativeStatus.queuedWrites.toDouble())
      putDouble("nativeBleBufferedFrames", nativeStatus.bufferedFrames.toDouble())
      putDouble("nativeBackgroundInboxCount", nativeInbox.size().toDouble())
      putDouble("nativeBackgroundChannelInboxCount", nativeChannelInbox.size().toDouble())
      putString("outboxLeaseOwner", lease.owner)
      putDouble("outboxLeaseEpoch", lease.epoch.toDouble())
    }
    promise.resolve(status)
  }

  private fun dispatch(action: String, deviceLabel: String?, deviceAddress: String?) {
    val intent = Intent(reactContext, BushMeshRadioService::class.java).apply {
      this.action = action
      if (action == BushMeshRadioService.ACTION_START) {
        putExtra(BushMeshRadioService.EXTRA_DEVICE_LABEL, deviceLabel)
        if (!deviceAddress.isNullOrBlank()) {
          putExtra(BushMeshRadioService.EXTRA_DEVICE_ADDRESS, deviceAddress)
        }
      }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      reactContext.startForegroundService(intent)
    } else {
      reactContext.startService(intent)
    }
  }
}