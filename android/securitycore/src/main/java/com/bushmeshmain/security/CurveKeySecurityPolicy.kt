package com.bushmeshmain.security

import android.security.keystore.KeyProperties
import java.security.PrivateKey

/** Fail-closed KeyInfo.securityLevel interpretation. UNKNOWN_SECURE is NOT
 * accepted as an explicit TEE/StrongBox placement without security review.
 * Null encoded private key bytes alone do NOT prove hardware residence. */
internal object CurveKeySecurityPolicy {
  enum class Level {
    SOFTWARE, TRUSTED_ENVIRONMENT, STRONGBOX, UNKNOWN_SECURE, UNKNOWN, UNRECOGNISED
  }
  enum class Exportability { NON_EXPORTABLE, EXPORTABLE, INDETERMINATE }

  fun fromAndroidSecurityLevel(raw: Int): Level = when (raw) {
    KeyProperties.SECURITY_LEVEL_SOFTWARE -> Level.SOFTWARE
    KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> Level.TRUSTED_ENVIRONMENT
    KeyProperties.SECURITY_LEVEL_STRONGBOX -> Level.STRONGBOX
    KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE -> Level.UNKNOWN_SECURE
    KeyProperties.SECURITY_LEVEL_UNKNOWN -> Level.UNKNOWN
    else -> Level.UNRECOGNISED
  }

  fun isExplicitHardware(level: Level): Boolean =
    level == Level.TRUSTED_ENVIRONMENT || level == Level.STRONGBOX

  fun verdict(level: Level): String = when (level) {
    Level.TRUSTED_ENVIRONMENT, Level.STRONGBOX -> "HARDWARE_VERIFIED"
    Level.SOFTWARE -> "SOFTWARE_PROTECTED"
    Level.UNKNOWN, Level.UNKNOWN_SECURE -> "INDETERMINATE"
    Level.UNRECOGNISED -> "UNRECOGNISED"
  }

  /**
   * Only observes whether key bytes are exportable. Does not return bytes,
   * and zeros any unexpectedly returned PKCS#8 before control leaves here.
   * A thrown getter remains an exception and is never assumed safe.
   */
  fun observeExportability(privateKey: PrivateKey): Exportability {
    var data: ByteArray? = null
    try {
      data = privateKey.encoded
      return if (data == null) Exportability.NON_EXPORTABLE else Exportability.EXPORTABLE
    } finally {
      data?.fill(0)
    }
  }

  fun canUse(level: Level, exportability: Exportability): Boolean =
    isExplicitHardware(level) && exportability == Exportability.NON_EXPORTABLE
}
