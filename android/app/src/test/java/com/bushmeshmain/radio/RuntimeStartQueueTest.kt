package com.bushmeshmain.radio

import org.junit.Assert.*
import org.junit.Test

class RuntimeStartQueueTest {
  @Test fun stopBeforeStartAndRepeatedStopAreNoOps() {
    val queue = RuntimeStartQueue<String>()
    assertTrue(queue.cancel(true).isEmpty())
    assertTrue(queue.cancel(true).isEmpty())
    assertTrue(queue.cancel(false).isEmpty())
    assertTrue(queue.isEmpty())
  }

  @Test fun radioStopInvalidatesQueuedRadioButNotGps() {
    val queue = RuntimeStartQueue<String>()
    val radio = queue.add(true, "radio")
    val gps = queue.add(false, "gps")
    assertEquals(listOf("radio"), queue.cancel(true))
    assertNull(queue.take(radio))
    assertFalse(queue.isEmpty())
    assertEquals("gps", queue.take(gps))
    assertTrue(queue.isEmpty())
  }

  @Test fun gpsReleaseDoesNotCancelRadioAndNewRadioStartHasFreshToken() {
    val queue = RuntimeStartQueue<String>()
    val first = queue.add(true, "first")
    val gps = queue.add(false, "gps")
    assertEquals(listOf("gps"), queue.cancel(false))
    assertNull(queue.take(gps))
    assertEquals(listOf("first"), queue.cancel(true))
    val next = queue.add(true, "next")
    assertNotEquals(first, next)
    assertNull(queue.take(first))
    assertEquals("next", queue.take(next))
    assertTrue(queue.isEmpty())
  }

  @Test fun independentServiceStateSurvivesEitherRelease() {
    val state = BushMeshRadioServiceState
    try {
      state.markStopped()
      state.requestRadio("test", "02:00:00:00:00:01")
      state.requestLocation()
      state.markRunning()
      state.releaseRadio()
      assertTrue(state.shouldRun())
      assertTrue(state.locationRequested)
      assertNull(state.deviceAddress)
      state.requestRadio("test", "02:00:00:00:00:01")
      state.releaseLocation()
      assertTrue(state.shouldRun())
      assertTrue(state.radioRequested)
      assertEquals("02:00:00:00:00:01", state.deviceAddress)
      state.releaseRadio()
      assertFalse(state.shouldRun())
    } finally {
      state.markStopped()
    }
  }
}
