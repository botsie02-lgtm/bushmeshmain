# BushMesh Wave 5 — GPS and Drive field validation

**Repository:** `botsie02-lgtm/bushmeshmain`  
**Branch:** `feature/wave5-gps-drive-v1`  
**Exact base:** `37ded9fa36de2a14970b522a4e9fd1e677534dc2`

## Ownership and safety

This branch extends the existing Android `BushMeshLocationModule`, existing
`GpsFieldDiagnosticsPanel`, and the already-connected Drive dashboard.
It does **not** add another GPS provider, change Android permissions,
start tracking when a screen mounts, change the shared LocationSessionProvider,
enqueue positions, alter convoy-map authentication, or modify BLE/security/radio
ownership. The existing LocationScreen Start/Stop GPS commands remain the sole
acquisition lifecycle owner. The native Foreground Service lifecycle is intact.

The Drive dashboard adds `DriveGpsStatusBanner` through an optional
`gpsStatusBanner` slot on **both** FieldReadinessDashboard (the default
Drive home) and DriveDashboard (detailed mode), wired from their existing
connected wrappers. No AppShell or main navigation change.

## Real Android delivery measurements

`BushMeshGpsCallbackStats.kt` counts existing
`BushMeshLocationModule.onLocationChanged` callbacks on the Android side.
It measures callback interarrival with `SystemClock.elapsedRealtime()`;
fix age uses `Location.elapsedRealtimeNanos`. These clocks are monotonic
and do not depend on timezone or phone wall-clock changes.

The bounded 64-interval window reports a callback count; measured mean,
median, p95 and max; time since last callback; monotonic age of last fix;
rejected anomalous native timestamps; and the *actually requested* minimum
time/distance for the current, explicitly started GPS session. The model
stores no coordinates or track. Counts reset on a new explicit GPS session.

Speed, course, horizontal accuracy and (where Android supplied them)
`Location.speedAccuracyMetersPerSecond` and
`Location.bearingAccuracyDegrees` are sampled only as technical quality
metadata. Missing uncertainty is reported as **unknown**, never inferred.
Native status is read through the existing `getStatus()` method with
an optional `delivery` object; TypeScript accepts older Android binaries
that omit it.

The previously implemented React Native `GpsFieldMonitor` remains
available and reports **UI-observed** arrival intervals, which can differ
from native callback counts during screen-off, background JS suspension,
unmounts, or React render batching. Neither is a guaranteed hardware fix
cadence. The chosen Responsive / Balanced / Battery Saver setting is a
**requested Android `LocationManager.requestLocationUpdates` hint**,
not guaranteed delivery and not a measured power saving:

| Mode | Requested minimum time | Requested movement |
| --- | ---: | ---: |
| Responsive | 1 s | 0 m |
| Balanced | 5 s | 5 m |
| Battery Saver | 15 s | 25 m |

Settings apply on the next explicit user-started GPS session, **not**
retroactively to one already running. The diagnostics show the selected
preference, actual current session request and measured callback gaps
separately.

## Drive display policy

`driveGpsMotion.ts` implements read-only validation and limited three-fix
display smoothing. It is not fed into convoy maps, location storage or
transmission decisions. Rules:

- No fix, stopped GPS, unknown source, permission denial, GPS disabled,
  simulation, invalid/future-dated fix or stale fix: movement is **hidden**.
- The live Android GPS fix requires confirmed native tracking, precise
  permission and accuracy no worse than the configured warning limit
  (never above 100 m) for a field-ready label.
- Speed/course smoothing requires even better horizontal accuracy (50 m).
  The GPS course is hidden under 5 km/h or when heading is absent.
  Android-reported speed/course uncertainties are used only when the
  native fix age closely matches the JavaScript fix age. Poor uncertainty
  suppresses that reading. Missing uncertainty remains explicitly unknown.
- Angular smoothing uses circular mean near north (359° + 1°), falling
  back to the latest actual heading on sharp turns. After a long gap,
  samples are discarded.
- A current GPS fix does **not** establish radio delivery. The banner
  shows independent transport readiness and cautions when disconnected.

## Technical JSON export

Existing user-initiated `nativeFileExport.saveJson` exports aggregate
callback counts/timing, requested hints, reported accuracy/uncertainty and
bounded diagnostic summaries. Precise latitude/longitude is **absent by
default**. The existing separate checkbox explicitly opts in to include
only the latest location. No source dumps, track points, BLE addresses,
security keys or PSKs are exported.

Reset only clears diagnostic monitoring counters. GPS, active session,
history and radio are untouched.

## Automated tests

- `BushMeshGpsCallbackStatsTest.kt`: monotonic callback intervals,
  loss/recovery gaps, duplicate/out-of-order and future timestamps,
  no-fix/silence, preference changes across sessions and bounded percentiles.
- `wave5GpsDrive.test.ts`: empty/stale/future fixes, permission/GPS disabled,
  simulated source, poor accuracy, missing speed, low-speed heading,
  circular smoothing, sharp turns, long gaps, radio independence,
  native telemetry parsing/backward compatibility and export privacy.
- Full Jest, TypeScript, ESLint, Android `testDebugUnitTest` and
  `assembleDebug` run in dedicated feature-branch CI.

## Galaxy S22+ Android 16 physical validation — pending

This is a **test procedure**, not a claim that the following tests were
performed. Use the same Galaxy S22+ (SM-S906E, Android 16, API 36)
with a tester/passenger operating the handset. Observe safely while
parked; never manipulate the screen while driving.

1. **Baseline:** Note the branch SHA, precise Location permission,
   system Location enabled, battery mode and radio connection. Open
   Device → GPS without pressing Start. Confirm **no** new permission
   request and **no** native tracking activation.
2. **Responsive:** Press the existing Start GPS, stand in open sky,
   record at least 20 fixes over 1–2 minutes. Compare native callback
   count/mean/p95/max to the 1 s / 0 m *request* and UI-observed gaps.
3. **Balanced/Battery Saver:** Stop GPS, choose Balanced, explicitly
   restart, then repeat with Battery Saver. Check that the *actually
   requested native session* shows 5 s / 5 m and 15 s / 25 m respectively.
   Record observed rates and battery setting; do **not** claim measured
   current draw or guaranteed battery savings.
4. **Signal loss and recovery:** Start outside, take the phone into
   reliably poor-signal conditions for 2–5 minutes, return outdoors.
   Check increasing fix age/callback silence, stale warnings and no
   phantom movement; confirm that fresh fixes recover without changing
   radio transport or silently requesting permissions.
5. **GPS disabled:** While a session runs, disable Android Location.
   Confirm status reports disabled, activity stops or errors, and Drive
   hides live speed/course. Re-enable Location and **explicitly** start
   again if necessary (no automatic restart).
6. **Permission denial:** Revoke precise Location permission in Android
   app settings. Return to BushMesh. Confirm no implicit permission
   prompt from either diagnostics or Drive; explicit GPS Start handles
   permission through the existing flow.
7. **Heading degradation:** Safely compare open-sky movement with
   low-speed/stationary GPS, wooded cover and high reported accuracy
   radius. Verify course is withheld under 5 km/h or when absent,
   and sudden turns are not smoothed into fictitious intermediate
   directions. Report any missing Android uncertainty fields.
8. **Clock anomalies:** With a deterministic Jest test for futures,
   observe actual clock/timezone changes on a *stationary* test phone
   only if safe; native monotonic age must remain nonnegative, and a
   wrong wall-clock fix must not be shown as live navigation.
9. **Screen off:** Start GPS in foreground, lock screen for 2–5 minutes,
   unlock. Compare native callback count/last age and UI-observed count.
   Record OEM battery restriction and FGS notification. Do not treat
   success on this handset as process-restart support.
10. **Background/foreground:** Start while visible, switch to another
    app and return. Record native tracking status and callbacks.
    The current manifest does not declare independent
    `ACCESS_BACKGROUND_LOCATION`; background *start* is not assumed.
11. **Process death/restart:** Force-stop and relaunch. Confirm the
    diagnostic counters reset; saved breadcrumbs may be restored as
    **historical**, not proof GPS continued. GPS is not silently started.
12. **Privacy & reset:** Export JSON with precise-coordinate checkbox
    disabled and inspect for coordinate values. Repeat with intentional
    opt-in in a secure test environment. Reset counters and verify
    tracking, breadcrumbs and radio ownership are unchanged.

For each step record: actual device/Android build, commit SHA,
permission state, GPS profile, user start/stop actions, signal conditions,
fix age, callback intervals/counts, screen state, radio status and
pass/fail. Do not include precise convoy coordinates in shared reports
without explicit consent.
