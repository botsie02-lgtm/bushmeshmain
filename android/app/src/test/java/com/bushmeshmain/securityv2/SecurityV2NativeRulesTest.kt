package com.bushmeshmain.securityv2

import org.junit.Assert.*
import org.junit.Test

/** JVM checks require no Android device and prove POLICY only, not SQLite durability. */
class SecurityV2NativeRulesTest {
  private fun member(id: String, state: String = "active") =
    SecurityV2NativeRules.Member(id,"fingerprint_$id",1L,state,1000L,null)

  @Test fun exactUnsignedEpochBoundsAndNoRollback() {
    SecurityV2NativeRules.epoch(1L)
    SecurityV2NativeRules.epoch(SecurityV2NativeRules.MAX_EPOCH)
    SecurityV2NativeRules.advance(1L,2L)
    try {
      SecurityV2NativeRules.epoch(0L)
      fail("zero epoch accepted")
    } catch (_: IllegalArgumentException) {}
    try {
      SecurityV2NativeRules.epoch(SecurityV2NativeRules.MAX_EPOCH+1)
      fail("overflow accepted")
    } catch (_: IllegalArgumentException) {}
    for (next in listOf(1L, 0L, 3L)) try {
      SecurityV2NativeRules.advance(1L,next)
      fail("stale/skipped epoch accepted")
    } catch (_: IllegalArgumentException) {}
  }

  @Test fun rejectsMemberFabricationAndRevokedMemberResurrection() {
    val first = member("bm1_first")
    val joined = member("bm1_second","pending-install")
    assertTrue(SecurityV2NativeRules.members(listOf(first),listOf(first,joined),"bm1_second"))
    assertFalse(SecurityV2NativeRules.members(listOf(first),listOf(first),"bm1_second"))
    assertFalse(SecurityV2NativeRules.members(listOf(first),listOf(first,first),"bm1_first"))
    assertFalse(SecurityV2NativeRules.members(listOf(first),listOf(
      first.copy(fingerprint="forged"),joined),"bm1_second"))
    assertFalse(SecurityV2NativeRules.members(listOf(first),listOf(
      first,joined.copy(state="active")),"bm1_second"))

    val revoked = first.copy(state="revoked",revokedAt=2000L)
    assertFalse(SecurityV2NativeRules.recipientTransition(
      listOf(revoked),listOf(first,joined),setOf("old-admin"),emptySet(),2L,1L))
    assertFalse(SecurityV2NativeRules.recipientTransition(
      listOf(revoked),listOf(revoked,joined),setOf("old-admin"),emptySet(),2L,2L))
    assertTrue(SecurityV2NativeRules.recipientTransition(
      listOf(revoked),listOf(revoked,joined),setOf("old-admin"),
      setOf("old-admin"),2L,2L))
  }

  @Test fun fresh32ByteEpochKeyAndDigestAreMandatory() {
    val old = ByteArray(32) { 1 }
    val fresh = ByteArray(32) { 2 }
    assertFalse(SecurityV2NativeRules.distinctKey(old,old.copyOf()))
    assertTrue(SecurityV2NativeRules.distinctKey(old,fresh))
    try {
      SecurityV2NativeRules.key(ByteArray(31))
      fail("short epoch key accepted")
    } catch (_: IllegalArgumentException) {}
    try {
      SecurityV2NativeRules.digest("signed-but-not-a-sha256")
      fail("short digest accepted")
    } catch (_: IllegalArgumentException) {}
    SecurityV2NativeRules.digest("a".repeat(43))
  }
}
