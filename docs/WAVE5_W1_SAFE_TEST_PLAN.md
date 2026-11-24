# Wave 5 W1 — isolated research-only test and S22+ safety plan

**Status:** R1 refusal implementation ONLY. No W1 private key, wrapped ciphertext
or persistent vault has been created. No APK implements W1. The existing
`com.bushmeshmain` installation is a protected, unrelated asset.
Read `docs/WAVE5_W1_CRYPTO_IMPLEMENTATION_DECISION.md` before interpreting tests.

## What these tests actually prove

The new `android/securityw1research` Android library is NOT referenced by
`:app`, `:securityprobe`, any RN bridge, Security v1 factory, convoy
authorisation or Security v2. It has no Service, Activity, permission, Keystore
alias or connection capability. It contains only pure deterministic policy,
public-metadata-only AAD **layout** checks and refusal/recovery decisions.

Its JVM tests cover:
- A permanently false production activation flag, no automatic H1-to-W1,
  no native sign/agreement/unseal/provision/commit/retire operation;
- A *simulated wrapper-evidence fixture* that only considers a TEE or StrongBox
  AES-256/GCM/NoPadding randomized-encryption configuration structurally
  eligible. SOFTWARE, UNKNOWN_SECURE, UNKNOWN, missing and invalidated fixture
  states reject, but a passing fixture does NOT establish actual KeyInfo;
- version-1 provider/record/algorithm/purpose/binding/epoch validation, raw
  32-byte **public digests** (not private keys), distinct AAD domain and
  deterministic length-delimited metadata framing, IV size 12 and minimum
  ciphertext+tag length checks. A passing shape check is NOT AEAD authentication;
- AAD/record transplantation, stale epoch, operation/identity mismatch,
  invalid record versions, purpose mismatch, incorrect IV/truncated fixture,
  and absence of a valid runtime provider;
- simulated restart of an in-memory journal, PREPARING/SEALED_PENDING and
  committed-but-unconfirmed quarantine, conflicted operation IDs, wrapper
  loss/invalidation, failed cleanup, final tombstone retirement, unsolved
  independent rollback fencing and the always-closed research gate.

Tests DO NOT generate, wrap, unwrap, sign, agree or persist Ed25519/X25519
private keys. They are NOT RFC 8032/7748 cryptographic known-answer tests,
AES-GCM tamper tests, process-death/reboot persistence, device-lock behavior,
hardware attestation or KeyStore-invalidation evidence. Those remain explicit
approval blockers and cannot be claimed as passing.

## Windows PowerShell — run safe local tests

On a development computer with repository/Android SDK, in PowerShell:

```powershell
git fetch origin
git checkout feature/wave5-security-w1-experimental-v1
git rev-parse HEAD
npm ci
npm test -- --runInBand
npx tsc --noEmit
npm run lint
cd android
.\gradlew.bat :securityw1research:testDebugUnitTest :securityw1research:assembleDebug --no-daemon
.\gradlew.bat :securitycore:testDebugUnitTest --no-daemon
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest --no-daemon
.\gradlew.bat :securityprobe:assembleDebug :securityprobe:assembleDebugAndroidTest --no-daemon
```

No `installDebug` task, `adb install`, `pm clear` or uninstall is required
or authorised. No W1 standalone APK is generated or distributed. The existing
probe APK is merely **compiled** for regression and isolation; it does not
contain the W1 research module. CI additionally verifies the app/probe
runtime classpaths omit `:securityw1research` and checks the probe manifest
for zero requested permissions.

JUnit XML is local at:
`android/securityw1research/build/test-results/testDebugUnitTest/`.
The W1 CI workflow publishes only these non-secret XML test reports.

## Galaxy S22+ physical test plan — read-only until separate W1 authorisation

1. Leave Wave 3 running/installed as it is. You do **not** need to install any
   W1 binary or touch radio, encrypted Radio History, map packs or Keystore.
2. For non-invasive environmental evidence, with user-approved USB debugging:

```powershell
adb devices -l
adb shell getprop ro.product.model
adb shell getprop ro.build.version.sdk
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.security_patch
adb shell pm path com.bushmeshmain
```

3. Compare this to the already documented physical S22+ baseline: Android
   16/API 36, TEE AES storage, SQLite FULL/secure_delete/DELETE, but
   AndroidKeyStore Ed25519/X25519 **SOFTWARE** and NON_EXPORTABLE. Do not infer
   W1 readiness from those H1 diagnostics.
4. No further W1 device test is valid until the cryptographic library,
   private-memory exposure, dedicated AES wrapper/KeyInfo inspection, lock
   policy, crash/reboot recovery and rollback-fence review has approved an
   isolated native implementation.
5. A future expressly authorised test APK must use its own app ID and UID,
   zero radio and location permissions, and a new W1-specific KeyStore alias
   namespace. Never install it over `com.bushmeshmain` or reuse its
   private database. No W1 APK has been built in this branch.

## Future required *cryptographic* known-answer test gate (NOT executed)

Use exact RFC 8032 Ed25519 test #1 (empty-message signature):
- seed: `9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60`
- raw public: `d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`
- signature: `e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b`

Use RFC 7748 §6.1 X25519 agreement:
- Alice scalar: `77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a`
- Alice raw public: `8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a`
- Bob raw public: `de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f`
- expected shared: `4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742`

A future implementation must also test malformed/short public keys, invalid
Ed25519 signatures, RFC 8410 exact SPKI and raw public extraction, X25519
low-order/all-zero rejection, purpose/epoch misuse and no key bytes in JS,
logs, exports, reports or generated binaries' embedded fixtures. The above
vectors are public RFC fixtures; none is an identity private key in use.

## Go/no-go and return criteria

No implementation of actual sealed private records until all of the
following are reviewed and recorded: pinned crypto dependency/Android
compatibility, native custody/zeroisation with JVM/GC limitations, new
Keystore AES wrapper with real KeyInfo proof, GCM randomized IV and AAD
validation, device-lock/biometric policy, two-phase provisioning/retirement,
missing/replaced/invalidation handling, process-death/reboot proof, snapshot
rollback/epoch recovery policy, isolated APK test permission, and independent
Security v2 authority convergence.

**Expected current result:** CI green for structural negative tests;
no W1 APK and no W1 cryptographic capability claim. Production Security v1/v2
remains disabled, and H1's explicit hardware-backed Curve25519 gate remains
unchanged.
