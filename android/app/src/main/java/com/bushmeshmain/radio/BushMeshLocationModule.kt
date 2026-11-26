package com.bushmeshmain.radio

import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
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
  private val callbackStats = BushMeshGpsCallbackStats()

  override fun getName(): String = "BushMeshLocation"

  @ReactMethod
  fun start(minTimeMs: Double, minDistanceMeters: Double, promise: Promise) {
    BushMeshRadioService.dispatch(reactContext, BushMeshRadioService.ACTION_REQUEST_LOCATION) { error ->
      if (error != null) {
        promise.reject("BUSHMESH_LOCATION_START_FAILED", error.message, error)
      } else {
        try {
          if (tracking) locationManager.removeUpdates(this)
          val resolvedTimeMs = minTimeMs.toLong().coerceAtLeast(250L)
          val resolvedDistanceMeters = minDistanceMeters.toFloat().coerceAtLeast(0f)
          callbackStats.begin(resolvedTimeMs, resolvedDistanceMeters)
          locationManager.requestLocationUpdates(
            LocationManager.GPS_PROVIDER, resolvedTimeMs, resolvedDistanceMeters,
            this, Looper.getMainLooper(),
          )
          tracking = true
          promise.resolve(true)
        } catch (failure: Exception) {
          stopTracking()
          promise.reject("BUSHMESH_LOCATION_START_FAILED", failure.message, failure)
        }
      }
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    stopTracking { error ->
      if (error == null) promise.resolve(true)
      else promise.reject("BUSHMESH_LOCATION_STOP_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val result = Arguments.createMap().apply {
      putBoolean("tracking", tracking && BushMeshRadioServiceState.locationRequested &&
        BushMeshRadioService.permissionAllows(reactContext, false))
      putBoolean(
        "gpsEnabled",
        locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER),
      )
      putString("provider", LocationManager.GPS_PROVIDER)
      val delivery = callbackStats.snapshot(SystemClock.elapsedRealtime())
      val metrics = Arguments.createMap().apply {
        putDouble("callbackCount", delivery.callbackCount.toDouble())
        putDouble("intervalCount", delivery.intervalCount.toDouble())
        if (delivery.meanIntervalMs != null) putDouble("meanIntervalMs", delivery.meanIntervalMs)
        else putNull("meanIntervalMs")
        if (delivery.medianIntervalMs != null) putDouble("medianIntervalMs", delivery.medianIntervalMs.toDouble())
        else putNull("medianIntervalMs")
        if (delivery.p95IntervalMs != null) putDouble("p95IntervalMs", delivery.p95IntervalMs.toDouble())
        else putNull("p95IntervalMs")
        if (delivery.maxIntervalMs != null) putDouble("maxIntervalMs", delivery.maxIntervalMs.toDouble())
        else putNull("maxIntervalMs")
        if (delivery.latestFixAgeMs != null) putDouble("latestFixAgeMs", delivery.latestFixAgeMs.toDouble())
        else putNull("latestFixAgeMs")
        if (delivery.callbackSilenceMs != null) putDouble("callbackSilenceMs", delivery.callbackSilenceMs.toDouble())
        else putNull("callbackSilenceMs")
        putDouble("rejectedClockSamples", delivery.rejectedClockSamples.toDouble())
        if (delivery.requestedMinTimeMs != null) putDouble("requestedMinTimeMs", delivery.requestedMinTimeMs.toDouble())
        else putNull("requestedMinTimeMs")
        if (delivery.requestedMinDistanceMeters != null) putDouble("requestedMinDistanceMeters", delivery.requestedMinDistanceMeters.toDouble())
        else putNull("requestedMinDistanceMeters")
        if (delivery.accuracyMeters != null) putDouble("accuracyMeters", delivery.accuracyMeters.toDouble())
        else putNull("accuracyMeters")
        if (delivery.speedKmh != null) putDouble("speedKmh", delivery.speedKmh)
        else putNull("speedKmh")
        if (delivery.bearingDegrees != null) putDouble("bearingDegrees", delivery.bearingDegrees.toDouble())
        else putNull("bearingDegrees")
        if (delivery.speedAccuracyKmh != null) putDouble("speedAccuracyKmh", delivery.speedAccuracyKmh.toDouble())
        else putNull("speedAccuracyKmh")
        if (delivery.bearingAccuracyDegrees != null) putDouble("bearingAccuracyDegrees", delivery.bearingAccuracyDegrees.toDouble())
        else putNull("bearingAccuracyDegrees")
      }
      putMap("delivery", metrics)
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
    if (!BushMeshRadioServiceState.locationRequested || !BushMeshRadioService.permissionAllows(reactContext, false)) {
      stopTracking()
      emitError("GPS foreground permission or session is no longer available.")
      return
    }
    val nowElapsedMs = SystemClock.elapsedRealtime()
    val fixElapsedMs = location.elapsedRealtimeNanos / 1_000_000L
    callbackStats.record(
      arrivalElapsedMs = nowElapsedMs,
      fixElapsedMs = fixElapsedMs,
      accuracy = if (location.hasAccuracy()) location.accuracy else null,
      speedKmhValue = if (location.hasSpeed()) location.speed.toDouble() * 3.6 else null,
      bearing = if (location.hasBearing()) location.bearing else null,
      speedAccuracyKmhValue = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        location.hasSpeedAccuracy()) location.speedAccuracyMetersPerSecond * 3.6f else null,
      bearingAccuracy = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        location.hasBearingAccuracy()) location.bearingAccuracyDegrees else null,
    )
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
      stopTracking()
      emitError("Android GPS provider was disabled while Bushmesh was tracking.")
    }
  }

  override fun invalidate() {
    if (tracking) {
      try {
        stopTracking()
      } catch (_: Exception) {
        // React Native is tearing down; do not surface teardown failures.
      }
    }
    super.invalidate()
  }

  private fun stopTracking(completion: (Exception?) -> Unit = {}) {
    // removeUpdates may fail after permission revocation. Always release the
    // foreground location request, and never disturb the independent radio.
    try {
      locationManager.removeUpdates(this)
    } catch (_: SecurityException) {
      // Android has already withdrawn access.
    } finally {
      tracking = false
      BushMeshRadioService.dispatch(reactContext, BushMeshRadioService.ACTION_RELEASE_LOCATION,
        completion = completion)
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
