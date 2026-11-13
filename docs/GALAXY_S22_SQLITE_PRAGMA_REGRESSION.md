# Galaxy S22+ SQLite FULL/secure_delete regression — isolated probe rerun

**Status (13 November 2026):** The physical Galaxy S22+ rerun CONFIRMED
SQLite synchronous=2 (FULL), secure_delete=1, journal_mode=delete and
verifiedFullDurability=true, with hardware AES TEE. The next unresolved
device test is exact Ed25519/X25519 stage diagnosis; see
docs/GALAXY_S22_CURVE25519_STAGE_DIAGNOSTICS.md. The earlier
physical result was PROBE_FAILED_CLOSED / SQLiteException, specifically
"Queries can be performed using SQLiteDatabase query or rawQuery methods only"
from BushMeshSecurityCore.database during ProbeReport.inspect/close. This is
a concrete device failure, NOT evidence about hardware Ed25519/X25519.

## Root cause and corrective design

The original SQLiteDatabase.execSQL("PRAGMA synchronous=FULL") and
execSQL("PRAGMA secure_delete=ON") could produce result sets, which Android's
execSQL forbids. The original lazy database was also accessed by close(),
causing that failed first initialization to occur *during cleanup* and masking
the hardware probe's actual result.

The corrected SecurityCore:
1. On Android API 28+, calls SQLiteDatabase.openDatabase(File, OpenParams)
   with setSynchronousMode("FULL"), setJournalMode("DELETE"), and read/write
   create flags. This configures the platform's actual open connection(s).
2. On API 24–27, disables WAL and uses rawQuery for the result-capable
   "PRAGMA journal_mode=DELETE" and "PRAGMA synchronous=FULL" assignments.
3. On every supported API, applies PRAGMA secure_delete=ON using rawQuery,
   forces execution, then READS BACK actual "PRAGMA synchronous",
   "PRAGMA secure_delete" and "PRAGMA journal_mode" values. It requires exactly
   synchronous=2 (FULL), secure_delete=1 (ON), journal_mode=delete, otherwise
   rejects the database. The validation occurs before and after schema
   initialization; no fallback to NORMAL/OFF or WAL is permitted.
4. If initialization fails, closes only the connection already opened,
   attaches any cleanup error as a suppressed error, and rethrows the
   ORIGINAL initialization exception. A lazily unopened database is never
   initialized by close(), including after a failed first open.
5. ProbeReport.inspect NOW actually opens and verifies SQLite (a successful
   AES-only Keystore probe previously did not exercise its database), reports
   the sanitized effective SQLite configuration, preserves original failure
   class independently of cleanupFailureClass, and uses PROBE_FAILED_CLOSED
   for configuration/cleanup failures.

The SQLite DELETE/FULL configuration is selected deliberately to avoid
an uncontrolled pool of WAL connections where secure_delete can vary
per connection. This does not prove secure flash erasure, hardware rollback
resistance, or physical power-loss guarantees beyond SQLite's platform/VFS
contract. No Security v1/v2 activation is allowed.

Android API compatibility:

| API | Configuration method | Required observed values |
| --- | --- | --- |
| 24–27 | Android rawQuery setter, WAL explicitly disabled | FULL=2, secure_delete=1, journal_mode=delete |
| 28–36+ | Android OpenParams.setSynchronousMode/setJournalMode; rawQuery secure_delete | FULL=2, secure_delete=1, journal_mode=delete |
| Galaxy S22+ | Both APKs compile; pending new physical check | Only a real probe/instrumentation result can prove effective values |

References:
- https://developer.android.com/reference/android/database/sqlite/SQLiteDatabase
- https://developer.android.com/reference/android/database/sqlite/SQLiteDatabase.OpenParams.Builder
- https://www.sqlite.org/pragma.html

## Zero-risk PowerShell setup: NO changes to Wave 3

The working BushMesh Wave 3 package is com.bushmeshmain and must NEVER be
installed over, uninstalled, cleared or instrumented. The ONLY packages
used here are com.bushmesh.securityprobe and
com.bushmesh.securityprobe.test. These have a distinct Android UID/data
sandbox, Keystore alias namespace, and no radio/BLE/network permissions.

Obtain the APK ZIP artifacts and SHA256SUMS.txt from the most recent
successful run of:

https://github.com/botsie02-lgtm/bushmeshmain/actions/workflows/android-production-security-v1.yml

Unzip the APKs into a folder, open PowerShell in that folder, then:

    $ErrorActionPreference = "Stop"
    adb devices -l
    adb shell getprop ro.product.model
    adb shell getprop ro.build.version.sdk
    adb shell pm path com.bushmeshmain
    Get-FileHash .\securityprobe-debug.apk -Algorithm SHA256
    Get-FileHash .\securityprobe-debug-androidTest.apk -Algorithm SHA256

Check both hashes against the CI SHA256SUMS.txt before installing. If more
than one device is attached, insert -s <serial> immediately after EVERY adb.

Only install the standalone probe APKs (never app-debug.apk):

    adb install -r -t .\securityprobe-debug.apk
    adb install -r -t .\securityprobe-debug-androidTest.apk
    adb shell pm path com.bushmesh.securityprobe
    adb shell pm path com.bushmesh.securityprobe.test
    adb shell am start -n com.bushmesh.securityprobe/.ProbeActivity

**Important CI debug signing note:** A different ephemeral GitHub runner
may have a different debug signing certificate. If adb install -r fails
with INSTALL_FAILED_UPDATE_INCOMPATIBLE, export the previous *probe-only*
report first if needed, then uninstall ONLY the isolated probe packages:

    adb uninstall com.bushmesh.securityprobe.test
    adb uninstall com.bushmesh.securityprobe
    adb install -t .\securityprobe-debug.apk
    adb install -t .\securityprobe-debug-androidTest.apk

Never run adb uninstall or pm clear against com.bushmeshmain, and never
reset the handset's Android Keystore. The two probe packages are the only
allowable uninstall/reinstall targets.

## Focused regression test (run before full suite)

    adb shell am instrument -w -e class com.bushmesh.securityprobe.SecuritySQLiteLifecycleInstrumentationTest com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner | Tee-Object .\sqlite-lifecycle-result.txt

Expected: OK (9 tests), not a SQLiteException. Coverage includes fresh
database opening, effective FULL/secure_delete/DELETE readings, protected
metadata writes/reads, close without initial access, idempotent close
after open, rejected incompatible schema, actual SQLite open failure,
preserved underlying exception, ProbeReport.inspect success/error, and
restart persistence of nonce/replay/metadata. Each test fixture uses a
random database name and isolated Keystore alias; it never touches Wave 3
or the capability report's default database.

## Full independent probe suite

    adb shell am instrument -w com.bushmesh.securityprobe.test/androidx.test.runner.AndroidJUnitRunner | Tee-Object .\securityprobe-full-instrumentation.txt

Expected: OK (N tests). Some hardware Curve25519 tests can be SKIPPED when
unsupported; skip is NOT hardware success. Do not run this suite against
com.bushmeshmain.test.

Run the probe UI's Run isolated capability test, then export sanitized JSON
with the Export report JSON document-picker action, OR use debug-only run-as:

    adb exec-out run-as com.bushmesh.securityprobe cat files/capability-report.json > .\galaxy-s22-security-capabilities.json
    adb logcat -d -s BushMeshSecurityProbe:I '*:S' | Tee-Object .\securityprobe-events.txt

Expected JSON capabilities.sqlite object:

    "sqlite": {
      "synchronous": 2,
      "secureDelete": 1,
      "journalMode": "delete",
      "verifiedFullDurability": true
    }

It must no longer show SQLiteException from an unrelated close().
If it does, save both logs and the sanitized JSON and report FAIL.
"LOCAL_HARDWARE_SELF_TEST_PASS_NOT_ATTESTED" is only possible after actual
hardware test success; "UNSUPPORTED_OR_UNVERIFIED_NO_PRODUCTION_USE" must
remain explicit where hardware/algorithm capability is lacking. Do not
substitute software keys. Hardware success is NOT implied by a functional
SQLite test.

Record before-and-after Wave 3 installation presence:

    adb shell pm path com.bushmeshmain

## Separate restart/reboot evidence (optional after fixing SQL)

Full instructions and restrictions:
docs/GALAXY_S22_SECURITY_PROBE.md

The regression suite exercises close+reopen within instrumentation. For real
process death and reboot, use the explicit one-time fixture protocol
com.bushmesh.securityprobe.SecurityProbeRecoveryInstrumentationTest
with -e bmPhase prepare, followed by separate -e bmPhase verify after
force-stop or reboot (on fresh probe-only fixtures). Preserve both
transcripts; do not repeat verify against the same advanced counters.

Do not clear the live application, change phone unlock credentials, or claim
Keystore invalidation/rollback resistance without separate controlled
evidence. Save: final commit, successful Actions link, both APK SHA-256,
device API/patch, original and fixed capability classification, full test
transcript and two-phase recovery logs if run.

**Activation:** Still OFF. This only fixes Android SQLite initialization and
probe error handling. It does not implement or enable Security v2 enrollment,
owner-genesis, authenticated epoch commit/install, receipts or revocation.
