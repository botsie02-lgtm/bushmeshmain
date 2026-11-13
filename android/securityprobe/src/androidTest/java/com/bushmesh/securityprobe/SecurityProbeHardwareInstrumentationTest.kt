package com.bushmesh.securityprobe

import android.content.pm.PackageManager
import android.util.Base64
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bushmeshmain.security.BushMeshCurve25519Keys
import com.bushmeshmain.security.BushMeshSecurityCore
import java.security.KeyStore
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Never logs any private, symmetric or session key material. */
@RunWith(AndroidJUnit4::class)
class SecurityProbeHardwareInstrumentationTest {
  private val tag = "BushMeshSecurityProbe"
  private fun context() = InstrumentationRegistry.getInstrumentation().targetContext

  @Test fun standalonePackageHasNoRadioOrNetworkPermissions() {
    assertEquals(ProbeReport.APP_ID, context().packageName)
    val permissions = context().packageManager.getPackageInfo(
      context().packageName, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty()
    assertEquals("Probe must request no permissions", 0, permissions.size)
    assertThrows(ClassNotFoundException::class.java) {
      Class.forName("com.bushmeshmain.radio.BushMeshRadioService")
    }
    Log.i(tag, "ISOLATION_PASS applicationId=com.bushmesh.securityprobe permissions=0")
  }

  @Test fun hardwareProbeReportsExplicitSupportOrUnsupported() {
    val report = ProbeReport.inspect(context())
    assertFalse(report.getBoolean("productionSecurityActivated"))
    assertFalse(report.getBoolean("secretsOrKeyBytesIncluded"))
    val caps = report.getJSONObject("capabilities")
    val status = if (caps.optBoolean("enabled", false)) "HARDWARE_SELF_TEST_PASS"
      else "UNSUPPORTED_OR_UNVERIFIED"
    Log.i(tag, "CAPABILITY_CLASSIFICATION=$status sdk=" +
      report.getJSONObject("device").getInt("sdkInt") +
      " aes=" + caps.optString("storageLevel", "unavailable") +
      " ed25519=" + caps.optBoolean("ed25519", false) +
      " x25519=" + caps.optBoolean("x25519", false))
    ProbeReport.save(context(), report)
  }

  @Test fun bothAlgorithmsExposeOrderedSanitizedFirstFailingStage() {
    val report = ProbeReport.inspect(context())
    val capabilities = report.getJSONObject("capabilities")
    assertFalse(report.getBoolean("productionSecurityActivated"))
    assertEquals(1, capabilities.getInt("diagnosticsSchema"))
    val stages = listOf(
      "serviceRegistration", "providerSelection", "parameterSpec",
      "curvePurposeCompatibility", "keyGeneration", "keyInfoRetrieval",
      "hardwareSecurityLevel", "rfc8410PublicEncoding",
      "ed25519SignVerify", "x25519Agreement", "keyCleanup",
    )
    for ((key, enabled) in listOf(
      Pair("ed25519Diagnostics", "ed25519"),
      Pair("x25519Diagnostics", "x25519"),
    )) {
      val algorithm = capabilities.getJSONObject(key)
      val trace = algorithm.getJSONObject("stages")
      assertEquals(stages.size, trace.length())
      for (stage in stages) {
        val status = trace.getJSONObject(stage).getString("status")
        assertTrue("Unknown stage status for $key/$stage: $status",
          status in setOf("PASS", "FAIL", "NOT_RUN", "NOT_APPLICABLE"))
      }
      assertEquals(capabilities.getBoolean(enabled), algorithm.getBoolean("passed"))
      if (algorithm.getBoolean("passed")) {
        assertEquals("PASS", trace.getJSONObject("keyCleanup").getString("status"))
        assertEquals("tee", algorithm.optString("hardwareLevel", "tee").takeIf {
          it == "tee" || it == "strongbox" || it == "hardware-unclassified"
        } ?: "INVALID")
        assertTrue("Raw Security v1 public key must be 32 bytes",
          algorithm.getJSONObject("details").getInt("rawPublicLength") == 32)
      } else {
        val first = algorithm.getString("firstFailingStage")
        assertTrue("Missing ordered failure classification: $first",
          first == "precondition" || first in stages)
        val code = algorithm.getString("errorCode")
        assertTrue(code.matches(Regex("[A-Z0-9_]{4,64}")))
        val exception = algorithm.getString("exceptionClass")
        assertTrue(exception.matches(Regex("[A-Za-z][A-Za-z0-9_]{0,63}")))
        if (first != "precondition") {
          assertEquals("FAIL", trace.getJSONObject(first).getString("status"))
          assertEquals(code, trace.getJSONObject(first).getString("errorCode"))
        }
        if (first == "keyInfoRetrieval") {
          val attempts = algorithm.getJSONObject("details").getJSONArray("keyInfoAttempts")
          assertTrue("Missing shared KeyInfo/KeyFactory failure detail", attempts.length() > 0)
          for (i in 0 until attempts.length()) {
            val item = attempts.getJSONObject(i)
            assertTrue(item.getString("phase") in setOf("factorySelection", "keySpecExtraction"))
            assertTrue(item.getString("errorCode") in
              setOf("KEY_FACTORY_NOT_REGISTERED", "KEYINFO_KEYSPEC_REJECTED"))
          }
        }
      }
    }
    val json = report.toString()
    assertFalse("Raw app Keystore aliases must not be exported",
      json.contains("bushmesh_curve_v1_"))
    assertFalse("JCA exceptions must not reveal stacks",
      json.contains("StackTraceElement"))
    assertFalse("Serialized report must contain no private key material",
      json.contains("BEGIN PRIVATE KEY"))
    Log.i(tag, "CURVE25519_STAGED_DIAGNOSTICS_PASS firstEd=" +
      capabilities.getJSONObject("ed25519Diagnostics").getString("firstFailingStage") +
      " firstX=" + capabilities.getJSONObject("x25519Diagnostics").getString("firstFailingStage"))
  }

  @Test fun stagedProbeDoesNotLeaveTemporaryKeyAliases() {
    val fileSuffix = System.nanoTime()
    val core = BushMeshSecurityCore(context(),
      "securityprobe_staged_$fileSuffix.db",
      "securityprobe_staged_aes_$fileSuffix")
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    fun countTemporaryAliases(): Set<String> {
      val names = mutableSetOf<String>()
      val aliases = keyStore.aliases()
      while (aliases.hasMoreElements()) {
        val candidate = aliases.nextElement()
        if (candidate.startsWith("bushmesh_curve_v1_")) names.add(candidate)
      }
      return names
    }
    val before = countTemporaryAliases()
    try {
      val report = BushMeshCurve25519Keys(core).probe()
      for (name in listOf("ed25519Diagnostics", "x25519Diagnostics")) {
        val trace = report.getJSONObject(name).getJSONObject("stages")
        assertEquals("Every tested alias must be cleaned up", "PASS",
          trace.getJSONObject("keyCleanup").getString("status"))
      }
      assertEquals("A probe must not leave new private aliases", before, countTemporaryAliases())
    } finally {
      core.close()
      keyStore.deleteEntry("securityprobe_staged_aes_$fileSuffix")
    }
  }

  @Test fun nonExportableSigningAndAgreementWithDeletedAndForgedHandles() {
    val core = BushMeshSecurityCore(context(),
      "securityprobe_contract_" + System.nanoTime() + ".db",
      "securityprobe_contract_aes_" + System.nanoTime())
    val keys = BushMeshCurve25519Keys(core)
    try {
      val hardware = keys.probe()
      assumeTrue("UNSUPPORTED: no validated hardware Ed25519 and X25519",
        hardware.optBoolean("enabled", false))
      val sign = keys.create("Ed25519", "identity-signing")
      val agreement = keys.create("X25519", "identity-agreement")
      val signingHandle = sign.getJSONObject("privateKeyHandle")
      val agreementHandle = agreement.getJSONObject("privateKeyHandle")
      try {
        val signingRaw = Base64.decode(sign.getString("publicKey"), Base64.NO_WRAP)
        val agreementRaw = Base64.decode(agreement.getString("publicKey"), Base64.NO_WRAP)
        assertEquals(32, signingRaw.size)
        assertEquals(32, agreementRaw.size)
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        for (handle in listOf(signingHandle, agreementHandle)) {
          val alias = "bushmesh_curve_v1_" + handle.getString("id")
          val privateKey = keyStore.getKey(alias, null)
          assertNotNull(privateKey)
          assertNull("Private keys MUST NOT be exportable", privateKey!!.encoded)
        }
        val message = byteArrayOf(0x42, 0x4d, 1)
        assertTrue(keys.verify(signingRaw, message, keys.sign(signingHandle, message)))
        val another = keys.create("X25519", "session-ephemeral")
        try {
          val otherRaw = Base64.decode(another.getString("publicKey"), Base64.NO_WRAP)
          val a = keys.agree(agreementHandle, otherRaw)
          val b = keys.agree(another.getJSONObject("privateKeyHandle"), agreementRaw)
          assertArrayEquals(a, b)
          a.fill(0); b.fill(0)
        } finally {
          keys.delete(another.getJSONObject("privateKeyHandle"))
        }
        assertThrows(IllegalArgumentException::class.java) {
          keys.sign(org.json.JSONObject(signingHandle.toString())
            .put("purpose", "session-ephemeral"), message)
        }
        assertThrows(IllegalArgumentException::class.java) {
          keys.agree(org.json.JSONObject(signingHandle.toString())
            .put("algorithm", "X25519"), agreementRaw)
        }
        val missing = org.json.JSONObject(signingHandle.toString())
          .put("id", "ABCDEFGHIJKLMNOPQRSTUVWX")
        assertFalse(keys.has(missing))
        Log.i(tag, "EXACT_HARDWARE_CURVE25519_NONEXPORTABLE_PASS rawPublic=32")
      } finally {
        keys.delete(signingHandle)
        keys.delete(agreementHandle)
      }
      assertFalse(keys.has(signingHandle))
      assertFalse(keys.has(agreementHandle))
    } finally {
      core.close()
    }
  }
}
