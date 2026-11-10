package com.bushmesh.securityprobe

import android.util.Base64
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bushmeshmain.security.BushMeshCurve25519Keys
import com.bushmeshmain.security.BushMeshSecurityCore
import java.security.MessageDigest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Explicit two-run recovery protocol. Each instrumentation invocation launches
 * a new process. Phases prepare, verify, cleanup require operator invocation.
 * A reboot happens BETWEEN prepare and verify, never inside tests.
 * All fixtures and aliases are restricted to this test application UID.
 */
@RunWith(AndroidJUnit4::class)
class SecurityProbeRecoveryInstrumentationTest {
  private val tag = "BushMeshSecurityProbe"
  private val database = "securityprobe_recovery_v1.db"
  private val aes = "securityprobe_recovery_aes_v1"
  private val marker = "recovery/marker"
  private val handles = "recovery/handles"
  private val nonce = "recovery/nonce"
  private val replay = "recovery/replay"
  private val handshake = "recovery/handshake"
  private val group = "bmg1_probeRecovery123"

  @Test fun runRequestedRecoveryPhase() {
    val phase = InstrumentationRegistry.getArguments().getString("bmPhase")
    assumeTrue("Specify -e bmPhase prepare|verify|cleanup explicitly", phase != null)
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    assertEquals(ProbeReport.APP_ID, context.packageName)
    val core = BushMeshSecurityCore(context, database, aes)
    try {
      when (phase) {
        "prepare" -> prepare(core)
        "verify" -> verify(core)
        "cleanup" -> cleanup(core)
        else -> fail("Unsupported recovery phase; use prepare, verify or cleanup")
      }
    } finally {
      core.close()
    }
  }

  private fun prepare(core: BushMeshSecurityCore) {
    require(core.get("meta", marker) == null) {
      "Prior recovery fixture exists; run verify and cleanup before preparing again"
    }
    val keys = BushMeshCurve25519Keys(core)
    val probe = keys.probe()
    val available = probe.optBoolean("enabled", false)
    if (available) {
      val signing = keys.create("Ed25519", "identity-signing")
      val agreement = keys.create("X25519", "identity-agreement")
      val saved = JSONObject().put("hardwareExactAlgorithmsAvailable", true)
        .put("signing", signing.getJSONObject("privateKeyHandle"))
        .put("agreement", agreement.getJSONObject("privateKeyHandle"))
        .put("signingPublic", signing.getString("publicKey"))
        .put("agreementPublic", agreement.getString("publicKey"))
      core.put("meta", handles, saved.toString().toByteArray())
    }
    core.put("secret", "recovery/epochKey", ByteArray(32) { 77 })
    assertEquals("1", core.reserveNonce(nonce, "0"))
    assertTrue(core.acceptReplay(replay, "100", 128))
    assertTrue(core.consumeHandshake(handshake, System.currentTimeMillis() + 7 * 24 * 3600_000L))
    val groupRecord = JSONObject().put("groupId", group).put("currentEpoch", 1).toString()
    assertTrue(core.commitEpoch("probe-recovery-tx-1", group, "digest-1", 0, 1,
      groupRecord, "group/$group/epoch-1", ByteArray(32) { 53 }))
    core.put("meta", marker, JSONObject().put("state", "prepared")
      .put("timestampUtc", System.currentTimeMillis()).toString().toByteArray())
    Log.i(tag, "RECOVERY_PREPARED hardwareCurve25519=$available; no key bytes logged")
  }

  private fun verify(core: BushMeshSecurityCore) {
    assertNotNull("Missing prepare marker; stored data unexpectedly missing", core.get("meta", marker))
    assertEquals("1", core.getHigh(nonce))
    assertEquals("2", core.reserveNonce(nonce, "1"))
    assertFalse(core.acceptReplay(replay, "100", 128))
    assertTrue(core.acceptReplay(replay, "101", 128))
    assertFalse(core.consumeHandshake(handshake, System.currentTimeMillis() + 60000L))
    assertEquals(1, core.epochHigh(group))
    assertArrayEquals(ByteArray(32) { 77 }, core.get("secret", "recovery/epochKey"))
    assertArrayEquals(ByteArray(32) { 53 }, core.get("secret", "group/$group/epoch-1"))
    val saved = core.get("meta", handles)
    if (saved != null) {
      val record = JSONObject(String(saved))
      val keys = BushMeshCurve25519Keys(core)
      val probe = keys.probe()
      assertTrue("Hardware support disappeared or private key invalidated after restart",
        probe.optBoolean("enabled", false))
      val sign = record.getJSONObject("signing")
      val agree = record.getJSONObject("agreement")
      assertTrue(keys.has(sign))
      assertTrue(keys.has(agree))
      val message = "BushMesh isolated restart-check v1".toByteArray()
      val public = Base64.decode(record.getString("signingPublic"), Base64.NO_WRAP)
      assertEquals(32, public.size)
      assertTrue(keys.verify(public, message, keys.sign(sign, message)))
      val ephemeral = keys.create("X25519", "session-ephemeral")
      try {
        val shared1 = keys.agree(agree, Base64.decode(
          ephemeral.getString("publicKey"), Base64.NO_WRAP))
        val shared2 = keys.agree(ephemeral.getJSONObject("privateKeyHandle"),
          Base64.decode(record.getString("agreementPublic"), Base64.NO_WRAP))
        assertEquals(32, shared1.size)
        assertTrue(MessageDigest.isEqual(shared1, shared2))
        shared1.fill(0)
        shared2.fill(0)
      } finally {
        keys.delete(ephemeral.getJSONObject("privateKeyHandle"))
      }
      Log.i(tag, "RECOVERY_VERIFIED hardwarePersistentKeys=true nonce=2 replayDuplicateRejected=true")
    } else {
      Log.i(tag, "RECOVERY_VERIFIED hardwarePersistentKeys=UNSUPPORTED nonce=2 replayDuplicateRejected=true")
    }
  }

  private fun cleanup(core: BushMeshSecurityCore) {
    core.get("meta", handles)?.let {
      val record = JSONObject(String(it))
      val keys = BushMeshCurve25519Keys(core)
      keys.delete(record.getJSONObject("signing"))
      keys.delete(record.getJSONObject("agreement"))
      core.remove("meta", handles)
    }
    core.remove("meta", marker)
    core.remove("secret", "recovery/epochKey")
    core.remove("secret", "group/$group/epoch-1")
    // Monotonic counters and consumed IDs intentionally remain; do not re-prepare
    // with the same database or pretend a reset gives anti-rollback security.
    Log.i(tag, "RECOVERY_FIXTURE_CLEARED applicationId=com.bushmesh.securityprobe")
  }
}
