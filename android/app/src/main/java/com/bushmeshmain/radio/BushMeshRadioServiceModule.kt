package com.bushmeshmain.radio

import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeMap
import java.security.SecureRandom
import org.json.JSONArray

class BushMeshRadioServiceModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {
  private val credentialHandler = Handler(Looper.getMainLooper())
  private val credentialWindow = ProtectedChannelKeyWindow()
  init { reactContext.addLifecycleEventListener(this) }

  private fun hideCredential() {
    credentialWindow.hide()
  }

  override fun onHostResume() = Unit
  override fun onHostPause() { credentialHandler.post { hideCredential() } }
  override fun onHostDestroy() { credentialHandler.post { hideCredential() } }

  override fun invalidate() {
    reactContext.removeLifecycleEventListener(this)
    credentialHandler.post { hideCredential() }
    super.invalidate()
  }

  @ReactMethod
  fun hideSharedChannelKey() {
    credentialHandler.post { hideCredential() }
  }

  // A separate native window is protected before the secret is rendered.
  // Do not return the secret in a promise, exception or diagnostic.
  @ReactMethod
  fun showSharedChannelKey(secret: String, promise: Promise) {
    credentialHandler.post {
      try {
        hideCredential()
        require(secret.matches(Regex("[0-9a-fA-F]{32}")))
        val activity = reactContext.currentActivity
        check(activity != null && !activity.isFinishing && !activity.isDestroyed && reactContext.lifecycleState == com.facebook.react.common.LifecycleState.RESUMED)
        check(activity.hasWindowFocus()) { "Activity window is not focused." }
        credentialWindow.show(activity, secret) { copySensitiveText(secret) }
        promise.resolve(true)
      } catch (_: Exception) {
        hideCredential()
        promise.reject("BUSHMESH_SHARED_KEY_REVEAL_FAILED", "Protected key reveal is unavailable.")
      }
    }
  }


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
    dispatch(BushMeshRadioService.ACTION_START, deviceLabel, null, "BUSHMESH_RADIO_SERVICE_START_FAILED", promise)
  }

  @ReactMethod
  fun startNativeBle(deviceAddress: String, deviceLabel: String?, promise: Promise) {
    dispatch(BushMeshRadioService.ACTION_START, deviceLabel, deviceAddress, "BUSHMESH_NATIVE_BLE_START_FAILED", promise)
  }

  @ReactMethod
  fun stop(promise: Promise) {
    // Completion includes local cleanup; JS still independently confirms
    // service, BLE and durable-target release through getStatus().
    dispatch(BushMeshRadioService.ACTION_STOP, null, null, "BUSHMESH_RADIO_SERVICE_STOP_FAILED", promise)
  }

  @ReactMethod
  fun secureRandomBytes(length: Double, promise: Promise) {
    try {
      val count = length.toInt()
      if (count !in 1..64) {
        promise.reject(
          "BUSHMESH_SECURE_RANDOM_INVALID_LENGTH",
          "Secure random request must be between 1 and 64 bytes.",
        )
        return
      }
      val bytes = ByteArray(count)
      SecureRandom().nextBytes(bytes)
      val result = Arguments.createArray()
      bytes.forEach { byte -> result.pushInt(byte.toInt() and 0xff) }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_SECURE_RANDOM_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun copySensitiveTextToClipboard(text: String, promise: Promise) {
    try {
      if (text.isBlank() || text.length > 4096) {
        promise.reject(
          "BUSHMESH_SENSITIVE_CLIPBOARD_INVALID_TEXT",
          "Sensitive clipboard text must contain between 1 and 4096 characters.",
        )
        return
      }

      copySensitiveText(text)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_SENSITIVE_CLIPBOARD_FAILED", error.message, error)
    }
  }

  private fun copySensitiveText(text: String) {
    ProtectedChannelClipboard.copy(reactContext, text)
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
      promise.reject("BUSHMESH_NATIVE_CHANNEL_INBOX_LIST_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun acknowledgeBackgroundChannelInboxJson(idsJson: String, promise: Promise) {
    try {
      val array = JSONArray(idsJson)
      val ids = mutableListOf<String>()
      for (index in 0 until array.length()) {
        val id = array.optString(index, "").trim()
        if (id.isNotEmpty()) ids.add(id)
      }
      promise.resolve(nativeChannelInbox.acknowledge(ids).toDouble())
    } catch (error: Exception) {
      promise.reject("BUSHMESH_NATIVE_CHANNEL_INBOX_ACK_FAILED", error.message, error)
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
      putString("deviceAddress", BushMeshRadioServiceState.deviceAddress)
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
      putDouble("nativeBleGattWriteConfirmedCount", nativeStatus.gattWriteConfirmedCount.toDouble())
      putDouble("nativeBleGattWriteFailedCount", nativeStatus.gattWriteFailedCount.toDouble())
      putDouble("nativeBackgroundInboxCount", nativeInbox.size().toDouble())
      putDouble("nativeBackgroundChannelInboxCount", nativeChannelInbox.size().toDouble())
      putBoolean(
        "persistedNativeTargetPresent",
        BushMeshRadioService.hasPersistedNativeTarget(reactContext.applicationContext),
      )
      putString("outboxLeaseOwner", lease.owner)
      putDouble("outboxLeaseEpoch", lease.epoch.toDouble())
    }
    promise.resolve(status)
  }

  private fun dispatch(action: String, deviceLabel: String?, deviceAddress: String?, code: String, promise: Promise) {
    BushMeshRadioService.dispatch(reactContext, action, deviceLabel, deviceAddress) { error ->
      if (error == null) promise.resolve(true)
      else promise.reject(code, error.message, error)
    }
  }
}
