package com.bushmeshmain.radio

import android.os.Build
import com.bushmeshmain.BuildConfig
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BushMeshAppInfoModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "BushMeshAppInfo"

  @ReactMethod
  fun getInfo(promise: Promise) {
    try {
      val result = Arguments.createMap().apply {
        putString("platform", "android")
        putString("versionName", BuildConfig.VERSION_NAME)
        putDouble("versionCode", BuildConfig.VERSION_CODE.toDouble())
        putDouble("apiLevel", Build.VERSION.SDK_INT.toDouble())
        putString("primaryAbi", Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
        putBoolean("debugBuild", BuildConfig.DEBUG)
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_APP_INFO_FAILED", error.message, error)
    }
  }
}
