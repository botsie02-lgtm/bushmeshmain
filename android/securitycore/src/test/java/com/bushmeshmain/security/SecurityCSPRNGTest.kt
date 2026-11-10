package com.bushmeshmain.security

import org.junit.Assert.*
import org.junit.Test

class SecurityCSPRNGTest {
  @Test fun makesIndependentBoundedNativeDraws() {
    val a = SecurityCSPRNG.next(32)
    val b = SecurityCSPRNG.next(32)
    assertEquals(32, a.size)
    assertEquals(32, b.size)
    assertFalse(a.contentEquals(b))
    a.fill(0); b.fill(0)
  }

  @Test fun rejectsOversizedOrEmptySynchronousRequests() {
    assertThrows(IllegalArgumentException::class.java) { SecurityCSPRNG.next(0) }
    assertThrows(IllegalArgumentException::class.java) { SecurityCSPRNG.next(1025) }
    assertEquals(1024, SecurityCSPRNG.next(1024).size)
  }
}
