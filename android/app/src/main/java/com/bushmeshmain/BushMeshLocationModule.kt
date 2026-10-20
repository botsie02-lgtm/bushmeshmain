package com.bushmeshmain

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BushMeshLocationModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val mainHandler = Handler(Looper.getMainLooper())
  private val locationManager =
    reactContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  private var pendingPromise: Promise? = null
  private var listener: LocationListener? = null
  private var timeoutRunnable: Runnable? = null

  override fun getName(): String = "BushMeshLocation"

  @ReactMethod
  fun getCurrentLocation(maxAgeMs: Double, timeoutMs: Double, promise: Promise) {
    if (
      android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M &&
        reactApplicationContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) !=
          PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject(
        "LOCATION_PERMISSION",
        "Location permission is required for convoy position updates.",
      )
      return
    }

    mainHandler.post {
      if (pendingPromise != null) {
        promise.reject("LOCATION_BUSY", "A BushMesh location request is already active.")
        return@post
      }

      val maxAge = maxAgeMs.coerceIn(0.0, 10.0 * 60.0 * 1000.0).toLong()
      val timeout = timeoutMs.coerceIn(1000.0, 60_000.0).toLong()
      val cached = bestLastKnownLocation()
      val now = System.currentTimeMillis()

      if (cached != null && now - cached.time <= maxAge) {
        promise.resolve(locationMap(cached))
        return@post
      }

      val provider = chooseProvider()
      if (provider == null) {
        promise.reject(
          "LOCATION_UNAVAILABLE",
          "No enabled Android location provider is available.",
        )
        return@post
      }

      pendingPromise = promise
      val nextListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
          finish(location)
        }

        @Deprecated("Deprecated in Android")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

        override fun onProviderEnabled(provider: String) = Unit

        override fun onProviderDisabled(provider: String) {
          if (provider == chooseProvider()) {
            fail(
              "LOCATION_PROVIDER_DISABLED",
              "The active location provider was disabled.",
            )
          }
        }
      }
      listener = nextListener

      try {
        locationManager.requestSingleUpdate(provider, nextListener, Looper.getMainLooper())
      } catch (security: SecurityException) {
        fail("LOCATION_PERMISSION", "Location permission is required.", security)
        return@post
      } catch (error: Exception) {
        fail("LOCATION_START", "Unable to request the current location.", error)
        return@post
      }

      val timeoutTask = Runnable {
        fail("LOCATION_TIMEOUT", "Timed out waiting for a current location.")
      }
      timeoutRunnable = timeoutTask
      mainHandler.postDelayed(timeoutTask, timeout)
    }
  }

  @ReactMethod
  fun cancel(promise: Promise) {
    mainHandler.post {
      if (pendingPromise != null) {
        fail("LOCATION_CANCELLED", "Location request was cancelled.")
      } else {
        cleanup()
      }
      promise.resolve(null)
    }
  }

  private fun chooseProvider(): String? {
    return when {
      runCatching { locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) }
        .getOrDefault(false) -> LocationManager.GPS_PROVIDER
      runCatching { locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) }
        .getOrDefault(false) -> LocationManager.NETWORK_PROVIDER
      else -> null
    }
  }

  private fun bestLastKnownLocation(): Location? {
    val candidates = listOf(
      LocationManager.GPS_PROVIDER,
      LocationManager.NETWORK_PROVIDER,
      LocationManager.PASSIVE_PROVIDER,
    ).mapNotNull { provider ->
      try {
        locationManager.getLastKnownLocation(provider)
      } catch (_: SecurityException) {
        null
      } catch (_: Exception) {
        null
      }
    }

    return candidates.maxWithOrNull(
      compareBy<Location> { it.time }.thenBy { -it.accuracy },
    )
  }

  private fun locationMap(location: Location) = Arguments.createMap().apply {
    putDouble("latitude", location.latitude)
    putDouble("longitude", location.longitude)
    putDouble("accuracyMetres", location.accuracy.toDouble())
    putDouble("timestampMs", location.time.toDouble())
    if (location.hasAltitude()) {
      putDouble("altitudeMetres", location.altitude)
    }
    if (location.hasSpeed()) {
      putDouble("speedKph", location.speed.toDouble() * 3.6)
    }
    if (location.hasBearing()) {
      putDouble("headingDegrees", location.bearing.toDouble())
    }
  }

  private fun finish(location: Location) {
    val promise = pendingPromise
    pendingPromise = null
    cleanup()
    promise?.resolve(locationMap(location))
  }

  private fun fail(code: String, message: String, error: Throwable? = null) {
    val promise = pendingPromise
    pendingPromise = null
    cleanup()
    promise?.reject(code, message, error)
  }

  private fun cleanup() {
    listener?.let {
      try {
        locationManager.removeUpdates(it)
      } catch (_: Exception) {
        // Ignore cleanup failures.
      }
    }
    listener = null
    timeoutRunnable?.let(mainHandler::removeCallbacks)
    timeoutRunnable = null
  }

  override fun invalidate() {
    mainHandler.post {
      if (pendingPromise != null) {
        fail("LOCATION_INVALIDATED", "BushMesh location module was invalidated.")
      } else {
        cleanup()
      }
    }
    super.invalidate()
  }
}
