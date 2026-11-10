# Wave 4 Android Security candidate — isolated physical Galaxy S22+ test build

**Security source under test:** `feature/android-production-security-v1` pinned to `b0558b643ffed8e839267bca16d4ae5cd363536b`. This is **not merged into the Wave 4 app**. The native source is registered on the worker branch but no application service selects the security provider.

**Non-negotiable isolation:**
- Working BushMesh Android applicationId: `com.bushmeshmain` — **must remain installed, no wipe, no in-place upgrade**.
- Candidate test target applicationId: `com.bushmeshmain.securityfieldtest`; test package: `com.bushmeshmain.securityfieldtest.test`.
- Keep code `namespace com.bushmeshmain` and Kotlin packages unchanged; patch only applicationId/testApplicationId and absolute manifest component names **in a disposable CI checkout**. The candidate's private `noBackupFilesDir`, database and AndroidKeystore aliases are scoped by the different app UID, not the production installation. Never reuse production app UID, data or aliases.
- Candidate launcher is removed from isolated APK; native radio foreground/car services disabled in the temporary manifest. **Run instrumentation only**; do not launch it as your normal navigation or radio app. No channel PSK provisioning or stored live identity migration.

## Reproducible independent diagnostic build

`workflow_dispatch` on `.github/workflows/wave4-isolated-android-security-fieldtest.yml` is an **opt-in** staging-only workflow. It checks out the Android worker commit into a separate `candidate` directory, applies the isolated application/test IDs in the ephemeral runner, sets a unique app label, builds `:app:assembleDebug` and `:app:assembleDebugAndroidTest`, and checks Android output-metadata applicationId before uploading **two isolated APKs**. **No** Security v2 source, native provider or test dependency is merged into live Wave 4 staging by this workflow.

Manual dispatch must explicitly acknowledge the app is isolated and cannot be certified from CI. No Android device instrumentation is run in hosted CI; the generated two APKs are for explicit user-controlled test on a sacrificial diagnostic package.

After extracting both uploaded ZIP artifacts (not their ZIP files):
```bash
adb install -r app-debug.apk
adb install -r app-debug-androidTest.apk
adb shell pm list packages | grep -E 'com.bushmeshmain'
adb shell am instrument -w -e class com.bushmeshmain.security.BushMeshSecurityInstrumentationTest com.bushmeshmain.securityfieldtest.test/androidx.test.runner.AndroidJUnitRunner
```
On Windows, use `adb shell pm list packages` and inspect both names; do **not** delete or uninstall `com.bushmeshmain`. The test package may be removed separately after recording evidence, but leave the main app untouched.

## Hardware evidence to collect

1. S22+ Android API, security patch/firmware, Galaxy model, build SHA and isolated package ID; confirm **separate app UIDs**.
2. Native capability report: actual AES wrapping key security level, StrongBox **feature** vs actual per-key StrongBox/TEE, Ed25519 KeyInfo level, X25519 KeyInfo level, exact JCA provider and failure class where unsupported.
3. Confirm real Ed25519 32-byte raw public / 64-byte sign/verify, X25519 32-byte raw / 32-byte shared secret, alias non-exportability and stable opaque handles after module recreation and ordinary force-stop/reboot.
4. Repeat nonce reservations/replay/handshake durable state across process death; test failures on key alias deletion, lock change/invalidation and database corruption. A skipped/unsupported Curve25519 test must be **reported unverified**, never passed.
5. Verify no production app Radio History, offline MBTiles, private channel PSK, GPS preferences or BLE ownership changed before and after diagnostic installation.
6. Record entropy-pool exhaustion behavior, JS-visible symmetric key exposure, orphan Keystore alias recovery limitations, rollback-restored SQLite snapshots and absence of hardware rollback-resistant high-water.

**Decision:** This is candidate qualification only. Even a fully green S22+ instrumentation report does NOT implement `SecurityV2TransactionalStore`, authorize owner/admin roles, prove monotonic rollback resistance, or activate joining.
