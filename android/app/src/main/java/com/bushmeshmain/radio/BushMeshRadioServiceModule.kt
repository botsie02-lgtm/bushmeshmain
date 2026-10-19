package com.bushmeshmain.radio

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeMap

class BushMeshRadioServiceModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "BushMeshRadioService"

  @ReactMethod
  fun start(deviceLabel: String?, promise: Promise) {
    try {
      dispatch(BushMeshRadioService.ACTION_START, deviceLabel)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_RADIO_SERVICE_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      dispatch(BushMeshRadioService.ACTION_STOP, null)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_RADIO_SERVICE_STOP_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val status: WritableMap = WritableNativeMap().apply {
      putBoolean("running", BushMeshRadioServiceState.running)
      putBoolean("radioRequested", BushMeshRadioServiceState.radioRequested)
      putBoolean("locationRequested", BushMeshRadioServiceState.locationRequested)
      putString("deviceLabel", BushMeshRadioServiceState.deviceLabel)
      putDouble("startedAtMs", BushMeshRadioServiceState.startedAtMs.toDouble())
      putString("ownership", "react-native-session")
    }
    promise.resolve(status)
  }

  private fun dispatch(action: String, deviceLabel: String?) {
    val intent = Intent(reactContext, BushMeshRadioService::class.java).apply {
      this.action = action
      if (action == BushMeshRadioService.ACTION_START) {
        putExtra(BushMeshRadioService.EXTRA_DEVICE_LABEL, deviceLabel)
      }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      reactContext.startForegroundService(intent)
    } else {
      reactContext.startService(intent)
    }
  }
}
