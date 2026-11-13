package com.bushmeshmain.security

import android.security.keystore.KeyProperties
import org.junit.Assert.*
import org.junit.Test

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
}
