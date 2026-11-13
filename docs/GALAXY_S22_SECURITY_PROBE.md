# Galaxy S22+ — independently installed BushMesh security capability probe

**Status (13 November 2026):** Physical Samsung Galaxy S22+ SM-S906E,
Android 16/API 36 (2025-10-01 patch) has confirmed AES-GCM at TEE,
SQLite FULL=2/secure_delete=1/DELETE, and StrongBox feature present. Ed25519
and X25519 were each reported unsupported by the earlier capability probe,
with IllegalStateException before a detailed stage was known. A new
stage-specific retest remains pending. This is an independent native app,
NOT a flavor of the installed Wave 3 application.

## Galaxy S22+ SQLiteException regression (12 November 2026)

The physical phone's first probe failed with SQLITE_OK / SQLiteException
because Android disallowed result-capable PRAGMA writes through execSQL and
close() accidentally initialized the lazy connection. The corrected provider
now applies, reads back, and requires FULL synchronous, secure_delete=ON and
DELETE journaling. Use the newer, more focused rerun procedure:

**docs/GALAXY_S22_SQLITE_PRAGMA_REGRESSION.md**

That document includes exact PowerShell commands, updated independently
signed test packages, a focused lifecycle regression suite, and a clear
"unsupported" rather than false hardware-success classification.

## Next hardware diagnostic — Ed25519/X25519 precise failure stages

See **docs/GALAXY_S22_CURVE25519_STAGE_DIAGNOSTICS.md** for the newest
instrumentation APKs, per-stage KeyInfo/KeyFactory failure codes and safe
PowerShell retest. Do not interpret Ed25519 or X25519 as supported until
every stage actually passes on the physical Galaxy S22+.

## Absolute isolation

| Package | Use | Guard |
| --- | --- | --- |
| com.bushmeshmain | Existing Wave 3 radio/history/maps | DO NOT install, uninstall, clear, replace, reset, instrument or modify |
| com.bushmesh.securityprobe | Isolated, zero-permission hardware probe | Only target for the standalone APK |
| com.bushmesh.securityprobe.test | Isolated instrumentation target | Only target for test APK |

The standalone app does not depend on React Native or radio code and requests
**zero Android permissions** (no Internet, Bluetooth, Location, foreground
service, storage or radio). It runs only in its own application UID, data
sandbox and AndroidKeyStore namespace. Its AES storage database is in
noBackupFilesDir with probe-specific filename and wrapping-key alias.
An independent SecurityCore Android library makes the actual provider core
available to the probe and the inactive production bridge without bundling
the Wave 3 application or its services into the probe.

No tests send packets, access live convoy data, or touch the existing app's
Keystore keys or storage. There is no automatic background operation.
Do NOT execute :app:installDebug, adb uninstall com.bushmeshmain, pm clear
com.bushmeshmain, or a global Android Keystore reset.

## APK acquisition

Build from this feature branch on a development PC:

    npm ci
    cd android
    ./gradlew :securitycore:testDebugUnitTest :securityprobe:assembleDebug :securityprobe:assembleDebugAndroidTest --no-daemon

On Windows, use gradlew.bat rather than ./gradlew.

Outputs (two distinct APKs):
- android/securityprobe/build/outputs/apk/debug/securityprobe-debug.apk
- android/securityprobe/build/outputs/apk/androidTest/debug/securityprobe-debug-androidTest.apk

Alternatively download from the successful run of:
https://github.com/botsie02-lgtm/bushmeshmain/actions/workflows/android-production-security-v1.yml

Artifact names start with bushmesh-securityprobe-install-, 
bushmesh-securityprobe-instrumentation-, and
bushmesh-securityprobe-checksums-. GitHub stores each artifact as a ZIP;
extract before installing. Record the exact commit SHA and verify both
APK file hashes against SHA256SUMS.txt. The workflow checks package IDs,
zero permissions and that radio-service classes are absent from the probe.

A debug APK and test APK are NOT production signed and never evidence of
an activated production identity.

## Safety checks BEFORE installing

Use Android platform-tools on a connected S22+. If multiple devices are
connected add -s <SERIAL> directly after adb in EVERY command. Do not
publish the serial number.

    adb devices -l
    adb shell getprop ro.product.model
    adb shell getprop ro.build.version.sdk
    adb shell getprop ro.build.version.release
    adb shell pm path com.bushmeshmain
    adb shell pm path com.bushmesh.securityprobe

Preserve the com.bushmeshmain package-path output so you can later show it
is unchanged. If the Galaxy already has Wave 3 installed, leave it alone.

## Install ONLY the standalone test application

Run in the directory where the extracted two APKs are located:

    adb install -r -t securityprobe-debug.apk
    adb install -r -t securityprobe-debug-androidTest.apk
    adb shell pm path com.bushmesh.securityprobe
    adb shell pm path com.bushmesh.securityprobe.test
    adb shell am start -n com.bushmesh.securityprobe/.ProbeActivity

The -r option can replace only those two probe package IDs. It cannot
replace com.bushmeshmain because the application IDs differ.

The UI has two buttons: Run isolated capability test and Export report JSON.
The first performs explicit local AES + Curve25519 self-tests, never networking;
the second invokes the Android system document picker.

## Capability report: no secrets

Export JSON using the UI or (debug build only):

    adb exec-out run-as com.bushmesh.securityprobe cat files/capability-report.json > galaxy-s22-security-capabilities.json

Record: SDK/API, manufacturer/model, Android release, security patch,
AndroidKeyStore provider name, installed JCA provider names, StrongBox
feature, AES KeyInfo level, Ed25519/X25519 hardware KeyInfo levels (where
available), JCA failure class names, raw public-key length and probe status.
The JSON explicitly states no remote attestation and no hardware
rollback-resistance proof. It contains NO device identity, serial/IMEI,
GPS coordinates, convoy roster, radio history, secrets, signatures or
private/public key bytes.

Expected classification:

| Value | Meaning / required operator action |
| --- | --- |
| LOCAL_HARDWARE_SELF_TEST_PASS_NOT_ATTESTED | Local AES hardware and exact Ed25519/X25519 tests passed; still requires persistent restart/reboot and bridge review |
| UNSUPPORTED_OR_UNVERIFIED_NO_PRODUCTION_USE | One or more hardware/JCA/KeyInfo tests unavailable; do not downgrade, do not call it supported |
| PROBE_FAILED_CLOSED | Isolation, report or native error; inspect failureClass without dumping secrets and stop |

A skipped conditional key test is **not a hardware pass**.

## Instrumentation: native runtime, algorithms, persistence, corruption

    adb shell am instrument -w com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner
    adb logcat -d -s BushMeshSecurityProbe:I '*:S'

Expected instrumentation output ends with OK (N tests). Required evidence
includes ISOLATION_PASS with permissions=0, CAPABILITY_CLASSIFICATION with
AES/Ed25519/X25519 statuses, and (only on supported devices)
EXACT_HARDWARE_CURVE25519_NONEXPORTABLE_PASS.

Tests include:
- AES hardware KeyInfo, random-IV AES-GCM at rest and persisted content.
- Ed25519 sign/verify, X25519 pairwise agreement, two 32-byte raw RFC 8410
  public keys, AndroidKeyStore privateKey.encoded == null.
- Handle purpose and algorithm mismatches, missing/deleted handles.
- Restart-safe sealed SQLite content, concurrent nonce counter reservations,
  replay/handshake ID rejection, corrupted ciphertext and interrupted writes.
- Local group roster/epoch key CAS, idempotent transaction retry and
  conflicting transaction rejection, one-way identity-retirement tombstone.
- No background radio code or requested permissions in the probe package.

Key invalidation from deletion and retirement is testable. These keys are NOT
bound to Android user authentication: changing PIN/biometrics is neither
required nor safe on this Wave 3 phone, and user-auth key invalidation remains
NOT_APPLICABLE/UNVERIFIED. Ordinary screen lock/unlock can be observed without
changing credentials.

## Process-death evidence: separate instrumentation invocations

This is a **two-phase one-time fixture**. Preserve both transcripts. Do not
prepare twice on the same fixture.

    adb shell am instrument -w -e class com.bushmesh.securityprobe.SecurityProbeRecoveryInstrumentationTest -e bmPhase prepare com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner
    adb shell am force-stop com.bushmesh.securityprobe
    adb shell am instrument -w -e class com.bushmesh.securityprobe.SecurityProbeRecoveryInstrumentationTest -e bmPhase verify com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner

Expected: RECOVERY_PREPARED then RECOVERY_VERIFIED, nonce advancing 1 to 2,
duplicate replay/handshake refused, protected group epoch and key restored.
If Ed25519/X25519 were supported, existing **opaque hardware-backed
private handles** must sign and agree after recovery; unsupported hardware
must be reported as such. A second verify intentionally fails because the
nonce/replay state was advanced; this prevents false reuse claims.

## Reboot evidence: use a FRESH probe-only fixture

For a second independent run, first preserve the original test logs/report.
You may remove or reset **only com.bushmesh.securityprobe/test**, never the
existing Wave 3 package. Reinstall the two probe APKs to start a fresh
fixture if needed. An ordinary process-death pass does NOT prove reboot
persistence.

    adb shell am instrument -w -e class com.bushmesh.securityprobe.SecurityProbeRecoveryInstrumentationTest -e bmPhase prepare com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner
    adb reboot

After Android boots, unlock with the device's CURRENT credential, reauthorize
adb when prompted, and verify without reinstalling either APK:

    adb devices -l
    adb shell am instrument -w -e class com.bushmesh.securityprobe.SecurityProbeRecoveryInstrumentationTest -e bmPhase verify com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner

Capture logs, test outputs, Android build/security-patch before and after,
reboot time and exact APK hashes. NO production key persistence claim is
permitted without this on-device evidence.

Optional fixture-only cleanup (never targets the Wave 3 application):

    adb shell am instrument -w -e class com.bushmesh.securityprobe.SecurityProbeRecoveryInstrumentationTest -e bmPhase cleanup com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner

After saving all evidence, you may uninstall the two TEST packages only:

    adb uninstall com.bushmesh.securityprobe.test
    adb uninstall com.bushmesh.securityprobe

Recovery fixture cleanup does not pretend to reset monotonic nonce/replay
domains. For repeat experiments, use a fresh probe-only installation.

## Result classification matrix

| Scenario | Success evidence | Failure or unavailable outcome |
| --- | --- | --- |
| API/provider identification | Model/API/patch/JCA provider report recorded | No probe result: PROBE_FAILED_CLOSED |
| Hardware AES-256-GCM | KeyInfo TEE/StrongBox + authenticated roundtrip | UNSUPPORTED; no software wrapper accepted |
| Ed25519 / X25519 | Hardware KeyInfo and exact local sign/agree | UNSUPPORTED; no P-256/RSA/JCA export fallback |
| Raw public formats | Exactly 32 bytes and RFC 8410 SPKI prefix validated | FAIL format mismatch |
| Opaque non-exportable handle | AndroidKeyStore key encoded == null and restarted use | FAIL if encoded or handle missing |
| Key purpose/missing/deleted | Explicit rejection, no hidden recreation | FAIL if allowed |
| SQLite nonce/replay | Atomic increment, durable duplicate refusal | FAIL on rollback/reuse |
| Corruption or interrupted write | Reject tamper; preserve previous transaction | FAIL if accepted/lost |
| Group epoch CAS | One winner, stale/duplicate conflict rejected | FAIL if unauthorized state mutation |
| Retired identity | Persistent one-way marker; no silent re-create | FAIL if recreated |
| Device lock / user-auth invalidation | Basic lock-unlock behavior may be observed | NOT_APPLICABLE for user-auth-bound invalidation |
| Rollback/recovery | Full device evidence of ordinary restart + reboot | NOT_PROVEN for hardware snapshot rollback |
| React Native synchronous CSPRNG | Not exercised by standalone native app | Requires separate, reviewed RN bridge test; remains production blocker |

## Security v2 interface gap review

Based on docs/WAVE3_SECURITY_V2_FORMAL_REVIEW.md and
src/convoy/enrolmentV3/SECURITY_V2_CONTRACT_PROPOSAL.md:

| Proposed contract | Storage implementation | Missing before enabling |
| --- | --- | --- |
| prepareAddMember | NONE | Signed authorization, owner/admin graph, durable prepared roster/epoch proposal, replay/idempotent prepare |
| commitPreparedAddition | Local SQLite group key+metadata+epoch high-water CAS and tx/digest record | Authority validation, verified roster digest, prior prepare binding, hardware rollback-resistant high-water, distributed ordering |
| installCommittedEpoch | NONE | Recipient verifies signed bound distribution, atomic recipient install and forward-only epoch |
| wrapCommittedEpoch | NONE | Signed, authenticated recipient/session/roster/epoch/ciphertext/AAD binding |
| verifyInstalledAck | NONE | Signed install ACK verification, durable per-recipient receipt and retry journal |
| authority revocation | NONE | Genesis owner anchor, role delegation revocation, identity rotation, total-order conflict handling |
| epoch recovery and invalidations | Local restart restores sealed metadata/key and replay counters | Verified current global epoch, old-key retirement, offline convergence, verified receipts, rollback policy and directory invalidation |

A local CAS is only a storage primitive. No Security v2 enrolment,
authentication, authorization, distribution, install or acknowledgement is
performed. No production Security v1 or v2 is activated or merged.

## Submission evidence

Keep the SHA of this branch and CI run URL, both APK SHA-256 values,
reported API/Android release/patch, JCA and KeyInfo capability results,
sanitized JSON, ordinary full instrumentation log, separate prepare/verify
logs for process death and reboot, error classes, and before/after package
paths for com.bushmeshmain. Do not include private keys, raw shared secrets,
private radio history, precise locations or phone serial numbers.
