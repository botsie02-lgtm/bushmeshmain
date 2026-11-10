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
