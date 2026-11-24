package com.bushmeshmain.radio

import java.util.ArrayDeque
import kotlin.math.max

/**
 * Read-only, coordinate-free metrics from the EXISTING Android LocationListener.
 * All times use elapsedRealtime milliseconds, never wall-clock. No GPS service,
 * permission requests, transmission, route or location history is owned here.
 */
internal class BushMeshGpsCallbackStats(
  private val maxIntervals: Int = 64,
) {
  internal data class Snapshot(
    val callbackCount: Long,
    val intervalCount: Long,
    val meanIntervalMs: Double?,
    val medianIntervalMs: Long?,
    val p95IntervalMs: Long?,
    val maxIntervalMs: Long?,
    val latestFixAgeMs: Long?,
    val callbackSilenceMs: Long?,
    val rejectedClockSamples: Long,
    val requestedMinTimeMs: Long?,
    val requestedMinDistanceMeters: Float?,
    val accuracyMeters: Float?,
    val speedKmh: Double?,
    val bearingDegrees: Float?,
    val speedAccuracyKmh: Float?,
    val bearingAccuracyDegrees: Float?,
  )

  private val intervals = ArrayDeque<Long>()
  private var callbackCount = 0L
  private var intervalCount = 0L
  private var totalIntervalMs = 0L
  private var maximumIntervalMs: Long? = null
  private var lastCallbackMs: Long? = null
  private var lastFixElapsedMs: Long? = null
  private var rejectedClockSamples = 0L
  private var requestedMinTimeMs: Long? = null
  private var requestedMinDistanceMeters: Float? = null
  private var accuracyMeters: Float? = null
  private var speedKmh: Double? = null
  private var bearingDegrees: Float? = null
  private var speedAccuracyKmh: Float? = null
  private var bearingAccuracyDegrees: Float? = null

  /** An explicit user-started session; do not mix intervals across sessions. */
  @Synchronized
  fun begin(requestMinTimeMs: Long, requestDistanceMeters: Float) {
    clear()
    requestedMinTimeMs = requestMinTimeMs
    requestedMinDistanceMeters = requestDistanceMeters
  }

  /** Only diagnostic counters are cleared; the native caller still owns GPS. */
  @Synchronized
  fun clear() {
    intervals.clear()
    callbackCount = 0L
    intervalCount = 0L
    totalIntervalMs = 0L
    maximumIntervalMs = null
    lastCallbackMs = null
    lastFixElapsedMs = null
    rejectedClockSamples = 0L
    accuracyMeters = null
    speedKmh = null
    bearingDegrees = null
    speedAccuracyKmh = null
    bearingAccuracyDegrees = null
    requestedMinTimeMs = null
    requestedMinDistanceMeters = null
  }

  /**
   * Samples delivery arrival using a monotonic clock, not Location.time.
   * The fix monotonic time is preserved separately for age/clock checks.
   * Out-of-order/future timestamps never contaminate measured intervals.
   */
  @Synchronized
  fun record(
    arrivalElapsedMs: Long,
    fixElapsedMs: Long,
    accuracy: Float?,
    speedKmhValue: Double?,
    bearing: Float?,
    speedAccuracyKmhValue: Float?,
    bearingAccuracy: Float?,
  ) {
    if (arrivalElapsedMs < 0 || fixElapsedMs < 0 ||
      fixElapsedMs > arrivalElapsedMs + 10_000 ||
      (lastFixElapsedMs != null && fixElapsedMs <= lastFixElapsedMs!!)
    ) {
      rejectedClockSamples += 1
      return
    }
    val previous = lastCallbackMs
    if (previous != null && arrivalElapsedMs <= previous) {
      rejectedClockSamples += 1
      return
    }
    if (previous != null) {
      val gap = arrivalElapsedMs - previous
      intervalCount += 1
      totalIntervalMs += gap
      maximumIntervalMs = max(maximumIntervalMs ?: 0L, gap)
      intervals.addLast(gap)
      if (intervals.size > maxIntervals) intervals.removeFirst()
    }
    callbackCount += 1
    lastCallbackMs = arrivalElapsedMs
    lastFixElapsedMs = fixElapsedMs
    accuracyMeters = accuracy?.takeIf { it.isFinite() && it >= 0 }
    speedKmh = speedKmhValue?.takeIf { it.isFinite() && it >= 0 }
    bearingDegrees = bearing?.takeIf { it.isFinite() && it >= 0 && it < 360 }
    speedAccuracyKmh = speedAccuracyKmhValue?.takeIf { it.isFinite() && it >= 0 }
    bearingAccuracyDegrees = bearingAccuracy?.takeIf { it.isFinite() && it >= 0 }
  }

  @Synchronized
  fun snapshot(nowElapsedMs: Long): Snapshot {
    val sorted = intervals.toList().sorted()
    fun percentile(p: Double): Long? {
      if (sorted.isEmpty()) return null
      val index = kotlin.math.ceil((sorted.size - 1) * p).toInt()
      return sorted[index]
    }
    return Snapshot(
      callbackCount = callbackCount,
      intervalCount = intervalCount,
      meanIntervalMs = if (intervalCount > 0) totalIntervalMs.toDouble() / intervalCount else null,
      medianIntervalMs = percentile(0.5),
      p95IntervalMs = percentile(0.95),
      maxIntervalMs = maximumIntervalMs,
      latestFixAgeMs = lastFixElapsedMs?.let { max(0L, nowElapsedMs - it) },
      callbackSilenceMs = lastCallbackMs?.let { max(0L, nowElapsedMs - it) },
      rejectedClockSamples = rejectedClockSamples,
      requestedMinTimeMs = requestedMinTimeMs,
      requestedMinDistanceMeters = requestedMinDistanceMeters,
      accuracyMeters = accuracyMeters,
      speedKmh = speedKmh,
      bearingDegrees = bearingDegrees,
      speedAccuracyKmh = speedAccuracyKmh,
      bearingAccuracyDegrees = bearingAccuracyDegrees,
    )
  }
}
