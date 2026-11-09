# GPS Field Validation v2 — Device diagnostics

**Branch:** `feature/gps-field-validation-v2`
**Exact base:** `9956ef244881c79a64e582a08136eceb0a90dce5`

## Integration and ownership

`GpsFieldDiagnosticsPanel` is embedded within the already-integrated
`DeviceGpsSettingsPanel` under Device → GPS. The only existing application
source changed is the import and child render within that panel.

New modules:
- `src/device/gps/gpsFieldDiagnostics.ts`: bounded, deterministic, pure
  monitoring and field-summary export; no coordinates are kept in samples.
- `src/components/GpsFieldDiagnosticsPanel.tsx`: React Native read-only
  status screen, periodic observation, reset and user-triggered JSON export.
- `__tests__/gpsFieldDiagnostics.test.ts`: deterministic field timelines.

**Not changed:** `AppShell`, `DeviceHubScreen`, `LocationSessionContext`,
`AndroidGpsLocationProvider`, radio, transport, Android service, Security v1,
Protocol v1, or any GPS permission/manifest contract.

Existing inputs:
1. `useLocationSession()` is the **only** source for live accepted
   fixes, provider label, session lifecycle and saved breadcrumbs.
2. `readAndroidGpsReadiness()` reuses native
   `BushMeshLocation.getStatus()` and `PermissionsAndroid.check()`;
   the panel refreshes status every 10 seconds when the app is active,
   and upon foreground/background transitions.
3. `gpsPreferences` supplies saved Responsive, Balanced or Battery
   Saver request hints and display warning thresholds.
4. `nativeFileExport.saveJson()` saves a technical summary **only**
   after a user taps Export. Without the existing Android native export
   module, the button is disabled.

The panel neither requests location permissions nor invokes GPS
`start`/`stop`, BLE commands, or `NativeEventEmitter`.
Only the existing explicit Start GPS / Stop GPS controls own acquisition.

## What is actually measured

Every distinct, validated, already-accepted fix emitted to the mounted
React Native `LocationSessionProvider` is counted once. The model captures
the **UI observation wall-clock time** and the reported fix timestamp, with
128-sample bounded buffers. It does **not** store or export sample coordinates.

Statistics:
- Total distinct fixes seen and measurable adjacent intervals.
- Mean, median, p95, maximum observed UI-arrival gap.
- Approximate UI-observed fix frequency (derived from mean gaps).
- Long gaps `> max(15 seconds, 3 × requested minTimeMs)`.
- Current silence duration while a session is active.
- Invalid or future-dated observations discarded from cadence samples.
- GPS-disabled, permission-denied, background, loss and recovery
  transitions **observed while the component is mounted**.

A React component may miss callbacks when not mounted, when the screen
is locked, during device sleep, or when JS is suspended in the background.
A persisted track can show historical breadcrumbs but is **never**
interpreted as a continuously measured GPS fix stream.

The monitor is intentionally process-local and resets on process restart.
Historical breadcrumb position is labeled **last known**, not live.
There is no missed-fix count: it would be fabricated when the native
hardware supplies best-effort location updates.

## Request hints versus actual measurements

| Preference | Android `minTimeMs` hint | Android `minDistanceMeters` hint | Trade-off |
| --- | ---: | ---: | --- |
| Responsive | 1,000 ms | 0 m | Potentially more GPS updates and battery cost |
| Balanced | 5,000 ms | 5 m | Moderate request rate |
| Battery Saver | 15,000 ms | 25 m | Lower request rate; may leave longer convoy location gaps |

The table describes **saved preferences for the next manually initiated
GPS session**, not proof of the parameters applied to an already active
session. Changing the mode mid-session does **not** reconfigure the provider
or alter the existing LoRa airtime planner. The screen shows measured
React Native arrival intervals separately from requested hints.
No quantitative power consumption, receiver duty cycle or device current
is measured. Heading is Android's course/bearing, **not** a measured compass
accuracy; quality is conservatively degraded for low speed, poor GPS
accuracy, unavailable speed, stale fixes or invalid bearings.

## Platform lifecycle truth

The current Android manifest declares precise location permission and
a foreground service location type. It does **not** declare
`ACCESS_BACKGROUND_LOCATION`. Foreground-started tracking may continue
in an Android foreground service, but independent background GPS start,
screen-locked fix continuity and tracking restoration after process death
are **not established**. No new permissions or lifecycle services are added.

The field panel's foreground-ready indication is a read-only check of
the platform's current permission, GPS switch and app visibility. It is
**not** a promise that starting a foreground service will succeed on
every Android version/lock state.

## Diagnostic reset and export

`GpsFieldMonitor.reset(currentObservation)` clears only in-memory
diagnostic counters and interval buffers, while baselining the current
fix so reset does not immediately double-count it. It does **not** clear
encrypted tracks, preferences, the latest live fix, or the GPS/radio owner.

Export summary schema version 1 includes aggregate statistics, coarse
source class, request hints, accuracy, heading quality, freshness and
limitations. It excludes user-entered errors, device/radio identifiers,
raw tracks, private keys, PSKs, and exact coordinates **by default**.
An unchecked-by-default control offers **explicit** opt-in to include
only the last position (marked historical if from a saved breadcrumb).
Coordinates are never retained by the field-statistics model.

`gpsFieldExportSummary` constructs the object from a strict set of
fields, rather than serializing a location session or raw native status.

## Reproducible automated field scenarios

Run:

```sh
npm test -- --runInBand gpsFieldDiagnostics
npx tsc --noEmit
npm run lint
cd android && ./gradlew assembleDebug --no-daemon
```

Tests exercise, using a deterministic clock and synthetic observation
objects (not a new runtime GPS provider):
- GPS disabled mid-tracking, one loss event, then fix recovery.
- Denied precise permission; repeated polling must not double-count.
- No fix, long silence, stale fix then recovery; no fabricated dropped callbacks.
- Actual observation gap stats versus different preference request hints.
- Explicit stop/start across a long break, without spanning sessions.
- Inaccurate, low-speed, invalid-heading and future-dated positions.
- App restart: historical saved breadcrumb only, no restored measurement.
- Background/screen-lock uncertainty without a false background claim.
- Reset preserving current session and track.
- Duplicate fixes and bounded coordinate-free memory.
- Privacy-safe export and explicit precise-coordinate opt-in.

## Physical Android field-validation checklist

**These scenarios are test plans, not claims of completed hardware tests.**
Use a real Android handset with the integrated screen visible, and retain
a redacted JSON report for each scenario. Observe the existing GPS
session controls; do not modify radio profiles.

| Scenario | Steps | Expected observation | Physical status |
| --- | --- | --- | --- |
| GPS disabled during tracking | Start GPS explicitly, obtain fixes, disable Android Location | GPS-disabled status at next check, session may error, loss/staleness warning; no automatic restart | **Pending** |
| Permission denial | Revoke precise permission in Android Settings; return to app | `permission-denied`, foreground not ready; no settings-screen permission dialog | **Pending** |
| Loss then recovery | Track outside; enter area with unreliable GNSS; return outside | Increasing fix age/silence and loss count, then fresh fix and recovery; timestamps reasonable | **Pending** |
| Extended gap | Leave location unavailable longer than freshness threshold | Stale historical/last position warnings, no invented delivery counts | **Pending** |
| Profile changes | Measure Responsive; stop; choose Balanced and start; repeat Battery Saver | Request hint changes only on explicit starts; measured intervals vary; no LoRa scheduler changes | **Pending** |
| Locked screen | Start GPS visibly, lock phone for 2–5 min, unlock | Record whether foreground service persisted, whether gap includes suspended UI time, and whether fixes resume; **do not assume** it works | **Pending** |
| Foreground/background | Start GPS visibly, switch apps, return | Visibility and readiness update; actual fix continuation is observed and documented, not presumed | **Pending** |
| App restart | Stop/force-close and relaunch | Counters reset; encrypted historical breadcrumbs may restore; no claim tracking restarted | **Pending** |
| Export privacy | Export default JSON then explicit opt-in JSON | Default contains no precise coordinates; opt-in includes only last coordinate; neither contains PSKs | **Pending** |
| Reset while active | Collect fixes, tap Reset, leave tracking active | Counters clear without stopping GPS or clearing trip history; next *new* fix counted | **Pending** |

Also test approximate-only permission, battery restriction, device thermal
throttling, different Android versions (especially Android 12–16), and
low-speed headings when physically safe. Do not interact with this
diagnostic screen while driving; use a passenger/tester.

Record hardware model, Android release, app commit SHA, profile, duration,
observed gaps, screen-lock state, OS battery policy and pass/fail outcome.
Treat this test record separately from exported coordinates to protect
route privacy.
