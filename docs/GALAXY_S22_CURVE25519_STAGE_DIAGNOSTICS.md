## Android 16 hardware gate: separate security-level and non-exportability retest

**Physical starting point (Galaxy S22+ SM-S906E, API 36):** Both Ed25519
and X25519 passed serviceRegistration, providerSelection, parameterSpec,
curvePurposeCompatibility, keyGeneration and keyInfoRetrieval. Both failed
hardwareSecurityLevel with TEE_STRONGBOX_VERIFICATION_FAILED, then passed
keyCleanup. Ed25519 KeyInfo was read using AndroidKeyStore EC KeyFactory;
X25519 KeyInfo was read using AndroidKeyStore XDH KeyFactory. The exact
security level and whether encoded private material is accessible are still
**unknown pending the new physical test**.

The updated probe sets diagnosticsSchema to 2. It separately records:

- `securityLevelInspection`: PASS or FAIL for reading
  `KeyInfo.securityLevel`, independent of the hardware verdict. In
  `details.securityLevelAccess`, PASS means the getter returned a value;
  THREW means it raised an exception and the sanitized
  `securityLevelAccessExceptionClass` identifies its class. An exception
  leaves `securityLevelEnum` absent; it is never guessed.
- `securityLevelEnum` (in details): one of SOFTWARE (Android constant 0),
  TRUSTED_ENVIRONMENT (1), STRONGBOX (2), UNKNOWN_SECURE (-1), UNKNOWN (-2),
  or UNRECOGNISED (all other values). No numerical implementation details,
  aliases or exception text need to be exported. The classification allows
  the operator to distinguish software, explicit secure hardware, and
  indeterminate values.
- `hardwareSecurityLevel`: PASS **only** for TRUSTED_ENVIRONMENT or
  STRONGBOX. `details.hardwareVerdict` is HARDWARE_VERIFIED,
  SOFTWARE_PROTECTED, INDETERMINATE or UNRECOGNISED. UNKNOWN_SECURE
  is deliberately **not** treated as TEE/StrongBox acceptance without
  explicit review, even though Android documents it as at least TEE-equivalent.
- `privateKeyNonExportability`: an **independent** test after key
  generation, even if KeyInfo inspection or TEE verification fails.
  `details.privateKeyEncodedAccess` is PASS/THREW;
  `details.privateKeyExportability` is NON_EXPORTABLE/EXPORTABLE/
  INDETERMINATE. Any unexpectedly returned private-key encoding is wiped
  immediately in memory and is never logged, persisted or exported.
  A null `privateKey.encoded` alone is NOT evidence of secure hardware.

If the level read fails, the first failing stage becomes
securityLevelInspection; if it succeeds with SOFTWARE/UNKNOWN/UNKNOWN_SECURE
or UNRECOGNISED, hardwareSecurityLevel fails. Either case leaves
rfc8410PublicEncoding, Ed25519 signing and X25519 agreement `NOT_RUN`.
Safe deletion of all temporary test keys still runs. Incomplete test stages
are never marked PASS.

The shared native security policy applies the **same strict** level and
exportability gate when creating or resolving persistent handles, not merely
during a diagnostic probe. JVM regressions cover every documented KeyInfo
level and an unrecognised level, invalid combinations of software and
non-exportability, a getter that throws, and immediate zeroization of
unexpectedly returned encoded bytes.

Official platform constants and strict hardware guidance:
https://developer.android.com/reference/android/security/keystore/KeyProperties
https://developer.android.com/reference/android/security/keystore/KeyInfo
https://developer.android.com/privacy-and-security/keystore

### PowerShell retest on the S22+ (isolated package only)

Download the three matching artifacts from the **latest successful**
feature-branch workflow:
https://github.com/botsie02-lgtm/bushmeshmain/actions/workflows/android-production-security-v1.yml

Extract `securityprobe-debug.apk`,
`securityprobe-debug-androidTest.apk`, and `SHA256SUMS.txt` into one folder,
verify that each hash matches the same workflow run, then run:

```powershell
$ErrorActionPreference = 'Stop'
adb devices -l
adb shell getprop ro.product.model
adb shell getprop ro.build.version.sdk
adb shell pm path com.bushmeshmain
Get-FileHash .\securityprobe-debug.apk -Algorithm SHA256
Get-FileHash .\securityprobe-debug-androidTest.apk -Algorithm SHA256

adb install -r -t .\securityprobe-debug.apk
adb install -r -t .\securityprobe-debug-androidTest.apk

adb shell am instrument -w -e class "com.bushmesh.securityprobe.SecurityProbeHardwareInstrumentationTest#bothAlgorithmsExposeOrderedSanitizedFirstFailingStage" com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner
adb shell am instrument -w -e class "com.bushmesh.securityprobe.SecurityProbeHardwareInstrumentationTest#stagedProbeDoesNotLeaveTemporaryKeyAliases" com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner
adb shell am instrument -w com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner

adb shell am start -n com.bushmesh.securityprobe/.ProbeActivity
```

In the app, press **Run isolated capability test** then **Export report JSON**.
Optionally use the debug-only read in PowerShell:

```powershell
$json = adb exec-out run-as com.bushmesh.securityprobe cat files/capability-report.json | ConvertFrom-Json
$json.capabilities.ed25519Diagnostics | Select-Object firstFailingStage,errorCode,details,stages | ConvertTo-Json -Depth 12
$json.capabilities.x25519Diagnostics | Select-Object firstFailingStage,errorCode,details,stages | ConvertTo-Json -Depth 12
adb shell pm path com.bushmeshmain
```

The two focused instrumentation tests should each report `OK (1 test)`.
That verifies the diagnostic contract, **not** Curve25519 hardware support.
Save the JSON and full instrumentation output. A key remains unsupported
until level is exactly TRUSTED_ENVIRONMENT or STRONGBOX, encoding is
NON_EXPORTABLE, and all subsequent exact-format and crypto checks PASS.
A StrongBox *feature* bit does not prove a Curve25519 key was placed there.

If installation fails because the debug signing certificate changed,
preserve any earlier probe-only report and reinstall **only**
`com.bushmesh.securityprobe.test` and `com.bushmesh.securityprobe`.
Never uninstall, clear, replace or instrument `com.bushmeshmain`; never
reset its Android Keystore, Radio History, settings or Melbourne map packs.
Security v1/v2 production activation stays disabled and no merge is allowed.

---

# Galaxy S22+ — Ed25519/X25519 staged AndroidKeyStore diagnostic retest

**Only** on feature/android-production-security-v1. The existing
com.bushmeshmain Wave 3 installation, native radio and map assets MUST NOT be
installed over, uninstalled, cleared, instrumented or modified.

## Confirmed physical evidence entering this investigation

Physical Samsung SM-S906E, Android 16, API 36, security patch 2025-10-01:

- AES-256-GCM wrapping key: TEE (confirmed on device)
- SQLite: synchronous=2 (FULL), secure_delete=1, journal_mode=delete,
  verifiedFullDurability=true (confirmed on device)
- StrongBox feature reported: true (feature != Curve25519 key placement)
- Ed25519: false / IllegalStateException (stage not yet known)
- X25519: false / IllegalStateException (stage not yet known)
- productionSecurityActivated: false (must remain false)

On earlier Android 13 API 33 firmware, the observed Ed25519 failure was
NoSuchAlgorithmException and X25519 failure was IllegalStateException.
Do NOT interpret the changed class on Android 16 as evidence that either
algorithm now works. No replacement or fallback algorithm is authorized.

## AOSP/provider comparison and why the new diagnostics matter

AOSP AndroidKeyStoreProvider.java registers KeyPairGenerator.XDH and, on
newer source revisions, KeyPairGenerator.ED25519. Its Curve25519
generator wraps the KeyMint EC curve-25519 operation, but uses distinct JCA
names and validates ECGenParameterSpec("x25519") vs
ECGenParameterSpec("ed25519"). KeyGenParameterSpec is required so Android
can bind generated keys to an app-scoped Keystore alias and authorized
PURPOSE_AGREE_KEY or PURPOSE_SIGN. Its agreement provider has KeyAgreement.XDH.
Source revisions and OEM/provider firmware behavior need direct device
inspection; provider registration alone does NOT demonstrate KeyMint key
generation, hardware placement, KeyFactory KeyInfo support, signing or
agreement.

AOSP references:
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/keystore/java/android/security/keystore2/AndroidKeyStoreProvider.java
- https://android.googlesource.com/platform/frameworks/base/+/7e336d6d7e476c2b4efbebccbb79074a8509af2b/keystore/java/android/security/keystore2/AndroidKeyStoreKeyPairGeneratorSpi.java
- https://android.googlesource.com/platform/frameworks/base/+/25c8f48a8dd430dc14644a773bf39b0c5b8ee3c7/keystore/java/android/security/keystore2/AndroidKeyStoreKeyAgreementSpi.java
- https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec
- https://developer.android.com/privacy-and-security/keystore

The old code collapsed all failure modes of checkHardware() into
IllegalStateException and kept only the exception's simple class.
The new probe exposes candidate KeyFactory algorithms (AndroidKeyStore
only), whether factory registration or getKeySpec(KeyInfo) failed, and
the first failing stage. It never stores Throwable.message or stack traces.
**Do not patch away KeyInfo verification to make the probe succeed.**

## 11 explicit stages — independently reported for BOTH algorithms

Each of capabilities.ed25519Diagnostics and capabilities.x25519Diagnostics
contains: algorithm, passed, firstFailingStage, exceptionClass,
causeExceptionClass when present, errorCode, safeMessage, stages, details.

| JSON stages key | What it establishes | First-failure classification |
| --- | --- | --- |
| serviceRegistration | AndroidKeyStore registers exact Ed25519/XDH KeyPairGenerator | SERVICE_NOT_REGISTERED |
| providerSelection | Explicit AndroidKeyStore KeyPairGenerator.getInstance succeeds | ANDROID_KEYSTORE_PROVIDER_UNAVAILABLE |
| parameterSpec | Exact KeyGenParameterSpec construction for private app alias | KEY_SPEC_BUILD_FAILED |
| curvePurposeCompatibility | initialize(spec) accepts named curve and PURPOSE_SIGN/AGREE_KEY, Ed digest NONE | CURVE_OR_PURPOSE_REJECTED |
| keyGeneration | AndroidKeyStore creates persistent asymmetric pair, no fallback | HARDWARE_KEY_GENERATION_FAILED |
| keyInfoRetrieval | KeyFactory(..., AndroidKeyStore) retrieves KeyInfo | KEYINFO_INSPECTION_FAILED |
| hardwareSecurityLevel | KeyInfo proves TEE or StrongBox; privateKey.encoded is null | TEE_STRONGBOX_VERIFICATION_FAILED |
| rfc8410PublicEncoding | SPKI prefix matches exact RFC 8410 OID, public body = 32 bytes | RFC8410_ENCODING_INCOMPATIBLE |
| ed25519SignVerify | Native private-key sign, exact 64-byte signature, public verify | SIGN_OR_VERIFY_FAILED |
| x25519Agreement | Two native private-key handles agree and yield matching 32-byte nonzero shared secrets | HARDWARE_AGREEMENT_FAILED |
| keyCleanup | Removes every probe-generated app-owned alias, including after errors | PROBE_KEY_DELETE_FAILED |

For Ed25519 x25519Agreement is NOT_APPLICABLE, for X25519
ed25519SignVerify is NOT_APPLICABLE. All other stages are PASS/FAIL/NOT_RUN;
later stages are NOT_RUN if an earlier stage fails, except keyCleanup.
A PRECONDITION stage may be recorded when Android API<33 or hardware
AES storage is unverified. A skipped/inapplicable stage is NEVER a pass.

A failed keyInfoRetrieval includes details.keyInfoAttempts, an array of
per-algorithm attempts for the private key's reported JCA algorithm, EC,
Ed25519 and XDH (deduplicated). Each attempt distinguishes
factorySelection from keySpecExtraction and gives a sanitized exception
class plus KEY_FACTORY_NOT_REGISTERED or KEYINFO_KEYSPEC_REJECTED.
These details identify a shared KeyInfo issue independently from
unsupported hardware key generation. None contain a KeyStore alias or
certificate/public/private-key bytes.

Both report fields ed25519 and x25519 remain FALSE until every applicable
stage passes, the keys are confirmed non-exportable and TEE/StrongBox, and
temporary aliases are deleted. Production Security v1/v2 stays disabled.

## Obtain updated GitHub CI APK artifacts

From the successful workflow run on this feature branch:
https://github.com/botsie02-lgtm/bushmeshmain/actions/workflows/android-production-security-v1.yml

Download and extract three artifacts whose names start with:
- bushmesh-securityprobe-install-<COMMIT> (securityprobe-debug.apk)
- bushmesh-securityprobe-instrumentation-<COMMIT>
  (securityprobe-debug-androidTest.apk)
- bushmesh-securityprobe-checksums-<COMMIT> (SHA256SUMS.txt)

Check both SHA-256 digests against the same run's SHA256SUMS.txt.
Only a completed green run produces trusted matching pairs. Debug APKs
are NOT production-security app releases.

## Windows PowerShell — update ONLY the isolated probe packages

In the folder with both extracted APKs:

    $ErrorActionPreference = "Stop"
    adb devices -l
    adb shell getprop ro.product.model
    adb shell getprop ro.build.version.sdk
    adb shell getprop ro.build.version.security_patch
    adb shell pm path com.bushmeshmain
    Get-FileHash .\securityprobe-debug.apk -Algorithm SHA256
    Get-FileHash .\securityprobe-debug-androidTest.apk -Algorithm SHA256

If multiple devices are present, add -s <GALAXY_SERIAL> immediately
after adb in EVERY command and keep the serial out of reports.

Reinstall ONLY the independent securityprobe package and its tests:

    adb install -r -t .\securityprobe-debug.apk
    adb install -r -t .\securityprobe-debug-androidTest.apk
    adb shell pm path com.bushmesh.securityprobe
    adb shell pm path com.bushmesh.securityprobe.test

If and ONLY if a debug signature mismatch gives
INSTALL_FAILED_UPDATE_INCOMPATIBLE, preserve any earlier exported probe
report and uninstall ONLY the two isolated packages:

    adb uninstall com.bushmesh.securityprobe.test
    adb uninstall com.bushmesh.securityprobe
    adb install -t .\securityprobe-debug.apk
    adb install -t .\securityprobe-debug-androidTest.apk

Never uninstall, clear, reinstall or run instrumentation against
com.bushmeshmain; never reset the handset's Keystore.

## Focused staged diagnostics

    adb shell am instrument -w -e class com.bushmesh.securityprobe.SecurityProbeHardwareInstrumentationTest#bothAlgorithmsExposeOrderedSanitizedFirstFailingStage com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner | Tee-Object .\s22-stage-diagnostics-test.txt

Expected: OK (1 test). This validates structured reporting, safe
first-failure codes, and per-KeyInfo attempts when appropriate. It DOES
NOT demand hardware support or count an unsupported algorithm as a pass.

Probe-key cleanup regression:

    adb shell am instrument -w -e class com.bushmesh.securityprobe.SecurityProbeHardwareInstrumentationTest#stagedProbeDoesNotLeaveTemporaryKeyAliases com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner | Tee-Object .\s22-curve-key-cleanup.txt

Expected: OK (1 test); new aliases have not leaked. A failed cleanup is
a blocking security defect, NOT evidence of successful hardware support.

Run all of the standalone test APK's instrumentation tests:

    adb shell am instrument -w com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner | Tee-Object .\s22-full-securityprobe-tests.txt

Existing tests cover SQLite FULL/secure_delete, encrypted metadata,
restart-safe nonce and replay, rollback of interrupted SQLite operations,
epoch CAS, handle lifecycle and retirement. Hardware-specific tests can be
SKIPPED when unsupported; treat that as UNSUPPORTED/UNVERIFIED, not PASS.

Run the UI and export the new sanitized report:

    adb shell am start -n com.bushmesh.securityprobe/.ProbeActivity

Tap **Run isolated capability test**. Then **Export report JSON** using
Android's system document picker. As a debug-only alternative:

    $report = (adb exec-out run-as com.bushmesh.securityprobe cat files/capability-report.json) -join [Environment]::NewLine
    $report | Set-Content -Encoding UTF8 .\s22-curve-staged-capabilities.json
    $json = Get-Content -Raw .\s22-curve-staged-capabilities.json | ConvertFrom-Json
    $json.capabilities.ed25519Diagnostics | ConvertTo-Json -Depth 10
    $json.capabilities.x25519Diagnostics | ConvertTo-Json -Depth 10
    adb shell pm path com.bushmeshmain

DO NOT use adb logcat stack-trace dumping or key-store alias exports.
The diagnostics JSON intentionally stores only fixed code descriptions
and exception CLASS NAMES, not raw vendor exception messages or secrets.

## Physical result interpretation and next security gate

Possible outcomes are:

- serviceRegistration FAIL: no provider service for exact algorithm.
- curvePurposeCompatibility FAIL: Java provider rejects exact curve/purpose.
- keyGeneration FAIL: KeyMint/provider cannot generate requested key on
  this firmware, without proving whether another firmware could.
- keyInfoRetrieval FAIL: KeyFactory or KeyInfo fails; inspect
  keyInfoAttempts. The crypto operation may or may not be supported,
  but cannot be used without hardware verification.
- hardwareSecurityLevel FAIL: TEE/StrongBox/non-exportability not proven.
- rfc8410PublicEncoding FAIL: do NOT accept or rewrite the key format to
  make it pass.
- ed25519SignVerify/x25519Agreement FAIL: functional private key operation
  failed even if generation and KeyInfo were valid.
- keyCleanup FAIL: probe-generated keys cannot be reliably cleaned up;
  fail closed and document separately.

Save before/after Android version + patch, unchanged com.bushmeshmain
package path, both APK hashes, exact feature SHA, action run URL,
focused/full instrumentation outputs, and exported report. Do not publish
IMEI/serial, location, convoy identity, radio history, private or group
keys. Reboot recovery requires separate prepare/verify evidence as
documented in docs/GALAXY_S22_SECURITY_PROBE.md.

**No successful physical Curve25519 test is claimed by this code/CI.
Only a new Galaxy S22+ report can establish Ed25519 or X25519 support.**
