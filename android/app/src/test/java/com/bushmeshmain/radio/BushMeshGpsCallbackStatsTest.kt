package com.bushmeshmain.radio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BushMeshGpsCallbackStatsTest {
  private fun feed(
    model: BushMeshGpsCallbackStats,
    arrival: Long,
    fix: Long = arrival,
    speed: Double? = 20.0,
    accuracy: Float? = 8f,
  ) {
    model.record(arrival, fix, accuracy, speed, 45f, 1.8f, 12f)
  }

  @Test fun lossGapAndRecoveryUseRealCallbackArrivalTimes() {
    val metrics = BushMeshGpsCallbackStats()
    metrics.begin(5_000, 5f)
    feed(metrics, 1_000)
    feed(metrics, 6_000)
    feed(metrics, 61_000)
    val snap = metrics.snapshot(65_000)
    assertEquals(3L, snap.callbackCount)
    assertEquals(2L, snap.intervalCount)
    assertEquals(30_000.0, snap.meanIntervalMs!!, 0.001)
    assertEquals(55_000L, snap.maxIntervalMs)
    assertEquals(4_000L, snap.callbackSilenceMs)
    assertEquals(4_000L, snap.latestFixAgeMs)
    assertEquals(5_000L, snap.requestedMinTimeMs)
  }

  @Test fun futureAndOutOfOrderFixesNeverPoisonIntervals() {
    val metrics = BushMeshGpsCallbackStats()
    metrics.begin(1_000, 0f)
    feed(metrics, 30_000, 30_000)
    feed(metrics, 31_000, 45_000)
    feed(metrics, 32_000, 29_000)
    feed(metrics, 33_000, 33_000)
    val snap = metrics.snapshot(34_000)
    assertEquals(2L, snap.callbackCount)
    assertEquals(2L, snap.rejectedClockSamples)
    assertEquals(3_000L, snap.maxIntervalMs)
    assertEquals(1_000L, snap.latestFixAgeMs)
  }

  @Test fun stopStartResetsStatsAndOptionalSensorUncertainty() {
    val metrics = BushMeshGpsCallbackStats()
    metrics.begin(15_000, 25f)
    feed(metrics, 30_000)
    metrics.begin(1_000, 0f)
    var snap = metrics.snapshot(1_000_000)
    assertEquals(0L, snap.callbackCount)
    assertNull(snap.latestFixAgeMs)
    assertNull(snap.bearingAccuracyDegrees)
    metrics.record(1_001_000, 1_000_000, null, null, null, null, null)
    snap = metrics.snapshot(1_002_000)
    assertEquals(1L, snap.callbackCount)
    assertNull(snap.accuracyMeters)
    assertNull(snap.speedKmh)
    assertNull(snap.bearingDegrees)
    assertNull(snap.speedAccuracyKmh)
  }

  @Test fun idleNoFixAndLongSilenceNeverFabricateUpdates() {
    val metrics = BushMeshGpsCallbackStats()
    metrics.begin(15_000, 25f)
    assertNull(metrics.snapshot(60_000).meanIntervalMs)
    feed(metrics, 1_000)
    val snap = metrics.snapshot(600_000)
    assertEquals(1L, snap.callbackCount)
    assertEquals(0L, snap.intervalCount)
    assertEquals(599_000L, snap.callbackSilenceMs)
    assertNull(snap.meanIntervalMs)
  }

  @Test fun recentBoundedPercentilesRepresentReceivedIntervals() {
    val metrics = BushMeshGpsCallbackStats(4)
    metrics.begin(1_000, 0f)
    for (i in 1..7) feed(metrics, i * i * 1_000L)
    val snap = metrics.snapshot(60_000)
    assertEquals(7L, snap.callbackCount)
    assertEquals(6L, snap.intervalCount)
    assertEquals(13_000L, snap.maxIntervalMs)
    assertEquals(11_000L, snap.medianIntervalMs)
    assertEquals(13_000L, snap.p95IntervalMs)
  }
}
