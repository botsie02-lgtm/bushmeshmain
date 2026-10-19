package com.bushmeshmain.radio

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class BushMeshLocationModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), LocationListener {

  companion object {
    const val EVENT_FIX = "BushMeshLocationFix"
    const val EVENT_ERROR = "BushMeshLocationError"
  }

  private val locationManager =
    reactContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  private var tracking = false

  override fun getName(): String = "BushMeshLocation"

  @ReactMethod
  fun start(minTimeMs: Double, minDistanceMeters: Double, promise: Promise) {
    try {
      if (
        reactContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) !=
          PackageManager.PERMISSION_GRANTED
      ) {
        promise.reject(
          "BUSHMESH_LOCATION_PERMISSION_REQUIRED",
          "Precise location permission is required for offline GPS tracking.",
        )
        return
      }

      if (!locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
        promise.reject(
          "BUSHMESH_GPS_DISABLED",
          "Android GPS provider is disabled.",
        )
        return
      }

      if (tracking) {
        locationManager.removeUpdates(this)
      }

      val resolvedTimeMs = minTimeMs.toLong().coerceAtLeast(250L)
      val resolvedDistanceMeters = minDistanceMeters.toFloat().coerceAtLeast(0f)
      locationManager.requestLocationUpdates(
        LocationManager.GPS_PROVIDER,
        resolvedTimeMs,
        resolvedDistanceMeters,
        this,
        Looper.getMainLooper(),
      )
      tracking = true
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_LOCATION_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      locationManager.removeUpdates(this)
      tracking = false
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_LOCATION_STOP_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val result = Arguments.createMap().apply {
      putBoolean("tracking", tracking)
      putBoolean(
        "gpsEnabled",
        locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER),
      )
      putString("provider", LocationManager.GPS_PROVIDER)
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by React Native NativeEventEmitter subscription bookkeeping.
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    // Required by React Native NativeEventEmitter subscription bookkeeping.
  }

  override fun onLocationChanged(location: Location) {
    val timestampMs = location.time.takeIf { it > 0L } ?: System.currentTimeMillis()
    val fix = Arguments.createMap().apply {
      putDouble("latitude", location.latitude)
      putDouble("longitude", location.longitude)
      putDouble("timestampMs", timestampMs.toDouble())
      if (location.hasAltitude()) {
        putDouble("altitudeMeters", location.altitude)
      } else {
        putNull("altitudeMeters")
      }
      if (location.hasSpeed()) {
        putDouble("speedKmh", location.speed.toDouble() * 3.6)
      } else {
        putNull("speedKmh")
      }
      if (location.hasBearing()) {
        putDouble("headingDegrees", location.bearing.toDouble())
      } else {
        putNull("headingDegrees")
      }
      if (location.hasAccuracy()) {
        putDouble("accuracyMeters", location.accuracy.toDouble())
      } else {
        putNull("accuracyMeters")
      }
    }
    emit(EVENT_FIX, fix)
  }

  @Deprecated("Deprecated in Android framework; retained for LocationListener compatibility")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

  override fun onProviderEnabled(provider: String) = Unit

  override fun onProviderDisabled(provider: String) {
    if (provider == LocationManager.GPS_PROVIDER) {
      tracking = false
      emitError("Android GPS provider was disabled while Bushmesh was tracking.")
    }
  }

  private fun emit(eventName: String, payload: Any?) {
    if (!reactContext.hasActiveReactInstance()) {
      return
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, payload)
  }

  private fun emitError(message: String) {
    val error = Arguments.createMap().apply { putString("message", message) }
    emit(EVENT_ERROR, error)
  }
}
