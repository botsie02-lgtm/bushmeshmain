package com.bushmeshmain

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BushMeshStorageModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val preferences = reactContext.getSharedPreferences(
    "bushmesh_persistent_store",
    Context.MODE_PRIVATE,
  )

  override fun getName(): String = "BushMeshStorage"

  @ReactMethod
  fun getItem(key: String, promise: Promise) {
    try {
      promise.resolve(preferences.getString(key, null))
    } catch (error: Throwable) {
      promise.reject("BUSHMESH_STORAGE_READ", error.message, error)
    }
  }

  @ReactMethod
  fun setItem(key: String, value: String, promise: Promise) {
    try {
      val committed = preferences.edit().putString(key, value).commit()
      if (!committed) {
        promise.reject(
          "BUSHMESH_STORAGE_WRITE",
          "Android SharedPreferences did not commit the BushMesh value.",
        )
        return
      }
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("BUSHMESH_STORAGE_WRITE", error.message, error)
    }
  }

  @ReactMethod
  fun removeItem(key: String, promise: Promise) {
    try {
      val committed = preferences.edit().remove(key).commit()
      if (!committed) {
        promise.reject(
          "BUSHMESH_STORAGE_REMOVE",
          "Android SharedPreferences did not remove the BushMesh value.",
        )
        return
      }
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("BUSHMESH_STORAGE_REMOVE", error.message, error)
    }
  }
}
