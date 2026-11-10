package com.bushmeshmain.security

import java.math.BigInteger
import org.junit.Assert.*
import org.junit.Test

/** Pure native/JVM tests, no Android emulator or React Native required. */
class SecurityCounterMathTest {
  @Test fun unsigned64Boundaries() {
    assertEquals(BigInteger.ZERO, SecurityCounterMath.u64("0"))
    assertEquals(SecurityCounterMath.MAX, SecurityCounterMath.u64("18446744073709551615"))
    for (value in listOf("-1", "", "01", "18446744073709551616", "abc")) {
      assertThrows(IllegalArgumentException::class.java) { SecurityCounterMath.u64(value) }
    }
  }

  @Test fun reservationsAreMonotonicAndDoNotReuseAtCrashBoundary() {
    val first = SecurityCounterMath.reserve(BigInteger.ZERO, BigInteger.ZERO, BigInteger.ZERO)
    assertEquals(BigInteger.ONE, first)
    val second = SecurityCounterMath.reserve(first, first, BigInteger.ZERO)
    assertEquals(BigInteger.valueOf(2), second)
    assertThrows(IllegalArgumentException::class.java) {
      SecurityCounterMath.reserve(second, second, BigInteger.valueOf(100))
    }
    val minimum = SecurityCounterMath.reserve(BigInteger.valueOf(100),
      BigInteger.valueOf(100), BigInteger.valueOf(100))
    assertEquals(BigInteger.valueOf(101), minimum)
    assertThrows(IllegalArgumentException::class.java) {
      SecurityCounterMath.reserve(BigInteger.ONE, BigInteger.valueOf(2), BigInteger.ZERO)
    }
    assertThrows(IllegalArgumentException::class.java) {
      SecurityCounterMath.reserve(SecurityCounterMath.MAX, SecurityCounterMath.MAX, BigInteger.ZERO)
    }
  }

  @Test fun replayRejectsDuplicatesAndTooOldButAcceptsReordering() {
    var state: SecurityCounterMath.Replay? = null
    for (counter in listOf(10L, 13L, 12L, 11L)) {
      val result = SecurityCounterMath.replay(state, BigInteger.valueOf(counter), 8)
      assertTrue(result.accept)
      state = result.state
    }
    for (counter in listOf(10L, 11L, 12L, 13L, 5L)) {
      assertFalse(SecurityCounterMath.replay(state, BigInteger.valueOf(counter), 8).accept)
    }
    assertTrue(SecurityCounterMath.replay(state, BigInteger.valueOf(1000), 8).accept)
    assertThrows(IllegalArgumentException::class.java) {
      SecurityCounterMath.replay(state, BigInteger.valueOf(14), 16)
    }
    assertFalse(SecurityCounterMath.replay(state, BigInteger.ZERO, 8).accept)
  }

  @Test fun replayMaskBoundedFor1024BitWindowAndLargeGap() {
    var result = SecurityCounterMath.replay(null, BigInteger.ONE, 1024)
    for (i in 2..1024) {
      result = SecurityCounterMath.replay(result.state, BigInteger.valueOf(i.toLong()), 1024)
      assertTrue(result.accept)
      assertTrue(requireNotNull(result.state).bitmap.bitLength() <= 1024)
    }
    result = SecurityCounterMath.replay(result.state, BigInteger.valueOf(1026), 1024)
    val duplicate = SecurityCounterMath.replay(result.state, BigInteger.valueOf(1026), 1024)
    assertFalse(duplicate.accept)
    assertTrue(SecurityCounterMath.replay(result.state, BigInteger.valueOf(1025), 1024).accept)
    assertFalse(SecurityCounterMath.replay(result.state, BigInteger.ONE, 1024).accept)
  }
}
