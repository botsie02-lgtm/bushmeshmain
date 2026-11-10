# BushMesh Android production security v1 — isolated candidate, NOT ACTIVATED

**Branch:** feature/android-production-security-v1  
**Exact parent:** ca3388e54deafbe5e6bc854c1a145873a1508d01  
**Status:** Candidate Android crypto and storage infrastructure, intentionally NOT used by live Security v1, convoy enrolment, maps, GPS, BLE or Background Radio. A successful compile, emulator run or local capability probe is not a production security certification.

## Platform capability matrix

| Android version | Keystore storage AES-256-GCM | Ed25519 signing + X25519 agreement | Guarantee in this implementation |
| --- | --- | --- | --- |
| API 24–27 (Android 7–8.1) | Only if AES KeyInfo reports secure hardware | Disabled: no assumed Curve25519 KeyMint v2 | Hardware-backed *storage* only when runtime key info passes |
| API 28–30 (Android 9–11) | TEE; optional StrongBox hardware feature may exist, but this code does NOT request StrongBox | Disabled | Hardware-level inspection; no Curve25519 |
| API 31–32 (Android 12/12L) | TEE when KeyInfo returns TRUSTED_ENVIRONMENT | Disabled; KeyMint v1 does not establish exact hardware Curve25519 | No software fallback |
| API 33–36+ (Android 13+) | TEE when verified by KeyInfo; no automatic StrongBox request | Candidate only: AndroidKeyStore "Ed25519" and "XDH" with "ed25519"/"x25519" curves, exact RFC 8410 public key encodings, non-exportable AndroidKeyStore handles, verified via per-process sign/verify + two-party shared-secret self-tests AND hardware KeyInfo | **Enabled by explicit factory only if every native test passes.** Hardware/vendor Java provider availability is not inferred from OS version |
| Galaxy S22+ | **UNVERIFIED ON ACTUAL DEVICE** | **UNVERIFIED ON ACTUAL DEVICE** | Run the instrumentation test and inspect capability report, then independently confirm restart and lock/invalidation behavior |

KeyMint v2 introduced Curve25519 in Android 13. AOSP KeyMint specifies TEE support; StrongBox is not expected to support Curve25519. Java JCA provider registration, key generation, KeyInfo extraction, signing, agreement, raw public-key encoding and device firmware are each separately tested; missing support fails closed. This feature NEVER substitutes P-256, RSA, exportable PKCS#8, JCA software private keys or encrypted-on-disk private keys. Its adapter does not touch existing WebCrypto development provider.

**References:** 
- Android Keystore: https://developer.android.com/privacy-and-security/keystore
- Android KeyInfo security level: https://developer.android.com/reference/android/security/keystore/KeyInfo
- Android 13 KeyMint v2 curve support: https://source.android.com/docs/security/features/keystore
- AOSP KeyMint Curve25519 vs StrongBox: https://android.googlesource.com/platform/hardware/interfaces/+/8c7558625f8e5d985af8e7e35d9e47737fdfccd7/security/keymint/aidl/android/hardware/security/keymint/IKeyMintDevice.aidl
- AOSP Java AndroidKeyStore Ed25519/XDH generator and curve requirements: https://android.googlesource.com/platform/frameworks/base/+/7e336d6d7e476c2b4efbebccbb79074a8509af2b/keystore/java/android/security/keystore2/AndroidKeyStoreKeyPairGeneratorSpi.java

## Source, boundaries and registration

- android/securitycore/src/main/java/com/bushmeshmain/security/BushMeshSecurityCore.kt — AES-GCM sealed SQLite storage in noBackupFilesDir; durable nonce, replay, consumed handshake IDs; typed group-epoch CAS, integrity failure handling.
- BushMeshCurve25519Keys.kt — Ed25519/X25519 KeyMint hardware-only opaque key operations; per-process probe; a handle is an alias+purpose+algorithm descriptor, NEVER private bytes.
- BushMeshSecurityModule.kt / BushMeshSecurityPackage.kt — opt-in React Native bridge; no secret or key payload logging.
- src/security/platform/androidProductionSecurity.ts — Security v1 ports, opt-in crypto provider, metadata and secret adapters, storage-only V2 CAS.
- MainApplication.kt — **the only shared native registration change**, adding BushMeshSecurityPackage alongside the unchanged radio package. No live service or provider calls this package.
- android/app/build.gradle — Android instrumentation test runner/dependencies only.
- .github/workflows/android-production-security-v1.yml — feature-branch CI, no integration branch affected.

App manifest already declares android:allowBackup="false"; the new database is additionally created in context.noBackupFilesDir. The native package is registered, but createAndroidProductionSecurity is **never called** by the live app. Do not inject it into the service graph without field acceptance and security review.

## Exact guarantee boundaries

| Property | Implemented | NOT guaranteed |
| --- | --- | --- |
| Opaque signing/agreement private handles | KeyStore aliases after hardware KeyInfo and exact algorithm self-tests; permanent aliases survive ordinary app-process restart; deleted alias has no private key | Ed25519/X25519 available on all phones; physical Galaxy S22+ result; reliable operation after key invalidation or reinstall |
| Symmetric secret encryption at rest | AES-256-GCM + random 96-bit IV + 128-bit tag; AAD includes kind and logical key; Keystore hardware level required | Private *symmetric* keys never enter JS; rooted-device plaintext-in-use protection; guaranteed flash overwrites after deletion |
| Durable metadata, nonce and replay | SQLite FULL synchronous transactions, data+high-water same commit; replay windows including 1024 bits, consumed handshake IDs persist across ordinary restart | Hardware anti-rollback, SQLite rollback protection, cross-device monotonicity, protection against complete database snapshot restoration |
| Identity/handle metadata consistency | Single SQLite commit of both identity and current handles; identity integrity checked by frozen IdentityManager on use | Atomicity across AndroidKeyStore key-generation/deletion and SQLite (different transactional domains); automatic orphan-key removal after crash |
| Group key + roster + epoch | Separate storage-only transactional CAS, idempotency log, new 32-byte epoch secret sealed with metadata and local epoch high-water | Security v2 approval, authenticated owner/admin authority, protocol enrolment, global consensus, hardware anti-rollback or global distribution convergence |
| Authentication/device lock | AndroidKeyStore origin and hardware security checked; unavailable/invalidated keys fail closed | Biometrics/device-unlock requirement (no setUserAuthenticationRequired), biometric invalidation behavior unless configured, attested remote trust |
| StrongBox | Feature bit is reported by Android PackageManager; hardware KeyInfo reveals actual level | Mandatory StrongBox placement; StrongBox Ed25519/X25519; StrongBox availability simply because device advertises feature |

### Nonce durability and rollback threat

reserveNonce commits the next counter AND its high-watermark in the same SQLite transaction before resolving. A reservation lost to a process crash is spent, never re-issued on normal recovery. If either stored value is less than a known external high-watermark, the arithmetic rejects rollback. The database itself **is not a hardware-maintained monotonic counter**; a privileged attacker restoring the entire SQLite database to a prior snapshot could reuse counters. No production anti-rollback guarantee or Security v2 activation may be inferred from this. Security v2 must either obtain a genuinely rollback-resistant independent anchor or define a fail-closed fresh-key/epoch recovery protocol.

### Native key lifecycle

Create keys only after probe succeeds in that process. Generated handles have provider="android-keystore-curve25519-v1", random 18-byte opaque IDs and an encrypted stored algorithm+purpose binding. KeyInfo MUST report secure hardware and generated public keys MUST match the exact RFC 8410 SubjectPublicKeyInfo prefix + 32 raw bytes. Provider sign and derive do not import/export PKCS#8. hasKey returns false for genuinely deleted/missing handles; malformed/foreign/wrong-purpose handles fail closed. deleteKey removes the AndroidKeyStore alias before removing its protected metadata; deleting a missing handle is safe. A crash between KeyStore generation and metadata commit can leave an orphaned private alias; this is NOT an active identity, and a future recovery sweep must be reviewed before deployment. Neither routine deletion nor KeyStore deletion promises recovery-proof erasure from physical flash.

The fixed 16 KiB one-time entropy pool has been REMOVED. The candidate now obtains every synchronous CryptoProvider.randomBytes draw (bounded 1–1024 bytes) from native java.security.SecureRandom through a native ReactMethod(isBlockingSynchronousMethod=true), validating output length and failing closed if the method is missing/throws. This is not verified on RN 0.85 New Architecture; physical bridge validation or a reviewed JSI/TurboModule is required before activation. No silent Math.random, finite pool, exportable private-key or algorithm downgrade fallback is permitted.

The bridge transports symmetric group/session key material in JS base64 because frozen CryptoProvider/SecureSecretStore v1 contracts require Uint8Array. Hardware-backed *master key wrapping* and AES-GCM at rest do not turn those JS-accessible session/group bytes into hardware non-exportable keys.

## Security v2 storage-only interface

AndroidSecurityEpochStorage.commitGroupEpoch accepts transaction ID, group ID, digest, expected and next epoch, fresh 32-byte symmetric key, key reference and GroupRecord. The native commit compares the local epoch high-water, rejects reused transaction IDs with a conflicting digest, requires a fresh secret reference and writes encrypted key, group record, epoch high-water and transaction receipt in one SQLite transaction. Identical retry returns false (already committed), not a second mutation.

**Absolutely no authorization occurs here.** The caller MUST independently verify an authenticated owner/admin chain, trusted identities, canonical AAD, signed roster digest, fresh entropy, pinned recipients and monotonic global authority. No real incremental enrolment is implemented or enabled. Current Security v1 setGroup and setSecret remain separate and are not retroactively made atomic by providing this proposed API.

## Standalone Galaxy S22+ test (mandatory, do not install over Wave 3)

All hardware checks must use the **independently installed**
com.bushmesh.securityprobe test app and com.bushmesh.securityprobe.test
instrumentation APK. Its private data, app UID and Keystore namespace are
isolated from the existing Wave 3 com.bushmeshmain installation.
The standalone app has no radio modules or Android permissions and cannot
access live convoy, Radio History or offline map packs. The shared core
is compiled from android/securitycore.

The only approved operator instructions, safe adb commands, report export,
failure classifications, two-phase process/reboot tests and Security v2
transactional gap review are in **docs/GALAXY_S22_SECURITY_PROBE.md**.
Do **NOT** run :app:installDebug or com.bushmeshmain instrumentation; old
instructions for running these tests against the existing app are superseded.
A successful build is NOT a Galaxy S22+ hardware result.

## Remaining before any production integration

- Actual Galaxy S22+ report with firmware, API, provider, hardware KeyInfo, Ed/XDH sign/agree and persistent restart evidence.
- Android test results plus interruption/fault-injection and lock/invalidation tests on physical hardware.
- Review of hardware-backed rollback resistance or mandatory fresh-key recovery; independent group epoch/nonce high-water and restore/reinstall behavior.
- Security v2 authenticated authority, atomic old-key retirement, failure recovery and consent/UI activation (NOT this branch).
- Full static analysis, supply-chain/app signing review and UX test for corrupted/destroyed keys and device-reinstall.
- Physical RN synchronous CSPRNG bridge validation (or reviewed JSI/TurboModule), secure deletion and orphan-alias GC review.

**Activation gate:** leave all new providers unattached to production; do not merge main or staging, publish production-identity claims, enrol members or assert device-specific support until these gates are satisfied.
