package com.bushmeshmain.security

import android.security.keystore.KeyProperties
import org.junit.Assert.*
import org.junit.Test
import java.security.PrivateKey

class CurveKeySecurityPolicyTest {
  private val policy = CurveKeySecurityPolicy

  @Test fun allRecognisedSecurityLevelValuesMapToFixedEnums() {
    assertEquals(CurveKeySecurityPolicy.Level.UNKNOWN,
      policy.fromAndroidSecurityLevel(KeyProperties.SECURITY_LEVEL_UNKNOWN))
    assertEquals(CurveKeySecurityPolicy.Level.UNKNOWN_SECURE,
      policy.fromAndroidSecurityLevel(KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE))
    assertEquals(CurveKeySecurityPolicy.Level.SOFTWARE,
      policy.fromAndroidSecurityLevel(KeyProperties.SECURITY_LEVEL_SOFTWARE))
    assertEquals(CurveKeySecurityPolicy.Level.TRUSTED_ENVIRONMENT,
      policy.fromAndroidSecurityLevel(KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT))
    assertEquals(CurveKeySecurityPolicy.Level.STRONGBOX,
      policy.fromAndroidSecurityLevel(KeyProperties.SECURITY_LEVEL_STRONGBOX))
    assertEquals(CurveKeySecurityPolicy.Level.UNRECOGNISED,
      policy.fromAndroidSecurityLevel(987654321))
  }

  @Test fun onlyExplicitTeeAndStrongboxMeetHardwareRequirement() {
    for (level in CurveKeySecurityPolicy.Level.values()) {
      val accepted = level in setOf(
        CurveKeySecurityPolicy.Level.TRUSTED_ENVIRONMENT,
        CurveKeySecurityPolicy.Level.STRONGBOX)
      assertEquals(level.name, accepted, policy.isExplicitHardware(level))
      assertEquals(level.name, accepted, policy.verdict(level) == "HARDWARE_VERIFIED")
      assertEquals(level.name, accepted, policy.canUse(level,
        CurveKeySecurityPolicy.Exportability.NON_EXPORTABLE))
    }
    assertEquals("SOFTWARE_PROTECTED", policy.verdict(CurveKeySecurityPolicy.Level.SOFTWARE))
    assertEquals("INDETERMINATE", policy.verdict(CurveKeySecurityPolicy.Level.UNKNOWN))
    assertEquals("INDETERMINATE", policy.verdict(CurveKeySecurityPolicy.Level.UNKNOWN_SECURE))
    assertEquals("UNRECOGNISED", policy.verdict(CurveKeySecurityPolicy.Level.UNRECOGNISED))
  }

  @Test fun encodedOrIndeterminatePrivateKeyNeverMeetsSecurityRequirement() {
    for (level in CurveKeySecurityPolicy.Level.values()) {
      assertFalse(policy.canUse(level, CurveKeySecurityPolicy.Exportability.EXPORTABLE))
      assertFalse(policy.canUse(level, CurveKeySecurityPolicy.Exportability.INDETERMINATE))
    }
    assertFalse(policy.canUse(CurveKeySecurityPolicy.Level.SOFTWARE,
      CurveKeySecurityPolicy.Exportability.NON_EXPORTABLE))
    assertFalse(policy.canUse(CurveKeySecurityPolicy.Level.UNKNOWN_SECURE,
      CurveKeySecurityPolicy.Exportability.NON_EXPORTABLE))
  }
  private fun fakePrivateKey(encodedBytes: () -> ByteArray?): PrivateKey = object : PrivateKey {
    override fun getAlgorithm(): String = "Ed25519"
    override fun getFormat(): String? = "PKCS#8"
    override fun getEncoded(): ByteArray? = encodedBytes()
  }

  @Test fun unexpectedExportableKeyBytesAreImmediatelyWipedAndRejected() {
    val bytes = ByteArray(48) { 71 }
    val observed = policy.observeExportability(fakePrivateKey { bytes })
    assertEquals(CurveKeySecurityPolicy.Exportability.EXPORTABLE, observed)
    assertTrue("Encoded private material was not wiped", bytes.all { it == 0.toByte() })
    for (level in CurveKeySecurityPolicy.Level.values()) {
      assertFalse(policy.canUse(level, observed))
    }
  }

  @Test fun nullEncodingIsNonExportableButNotHardwareEvidence() {
    val observed = policy.observeExportability(fakePrivateKey { null })
    assertEquals(CurveKeySecurityPolicy.Exportability.NON_EXPORTABLE, observed)
    assertFalse(policy.canUse(CurveKeySecurityPolicy.Level.SOFTWARE, observed))
    assertFalse(policy.canUse(CurveKeySecurityPolicy.Level.UNKNOWN, observed))
  }

  @Test fun throwingEncodedGetterFailsClosedRatherThanClaimingNonExportability() {
    val key = fakePrivateKey { throw IllegalStateException("opaque test failure") }
    assertThrows(IllegalStateException::class.java) { policy.observeExportability(key) }
    assertFalse(policy.canUse(CurveKeySecurityPolicy.Level.STRONGBOX,
      CurveKeySecurityPolicy.Exportability.INDETERMINATE))
  }

}
