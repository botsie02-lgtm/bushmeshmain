package com.bushmeshmain.radio

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import com.bushmeshmain.BuildConfig
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BushMeshAppInfoModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "BushMeshAppInfo"

  @ReactMethod
  fun getInfo(promise: Promise) {
    try {
      val batteryManager =
        reactContext.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
      val powerManager =
        reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager

      val batteryPercent = batteryManager
        ?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        ?.takeIf { it in 0..100 }
      val charging = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        batteryManager?.isCharging
      } else {
        null
      }
      val powerSaveMode = powerManager?.isPowerSaveMode
      val thermalStatus = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        powerManager?.currentThermalStatus
      } else {
        null
      }

      val result = Arguments.createMap().apply {
        putString("platform", "android")
        putString("versionName", BuildConfig.VERSION_NAME)
        putDouble("versionCode", BuildConfig.VERSION_CODE.toDouble())
        putDouble("apiLevel", Build.VERSION.SDK_INT.toDouble())
        putString("primaryAbi", Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
        putBoolean("debugBuild", BuildConfig.DEBUG)

        if (batteryPercent == null) putNull("phoneBatteryPercent")
        else putDouble("phoneBatteryPercent", batteryPercent.toDouble())

        if (charging == null) putNull("charging")
        else putBoolean("charging", charging)

        if (powerSaveMode == null) putNull("powerSaveMode")
        else putBoolean("powerSaveMode", powerSaveMode)

        if (thermalStatus == null) putNull("thermalStatus")
        else putDouble("thermalStatus", thermalStatus.toDouble())
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_APP_INFO_FAILED", error.message, error)
    }
  }
}
