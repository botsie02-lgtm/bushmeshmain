# BushMesh Device GPS preferences v1

## Scope and integration

Branch: `feature/device-gps-preferences-v1`. Base:
`f3eeef684d9d817382a4090d7a52709b47a5cbaa`.

Exported Device UI: `src/components/DeviceGpsSettingsPanel.tsx`.
The integrator should mount this **alongside** the existing
`LocationScreen` within the Device → GPS section in
`src/screens/DeviceHubScreen.tsx`, without mounting another
`LocationSessionProvider`, `NativeEventEmitter` or GPS service.
**DeviceHubScreen is intentionally unchanged on this branch.**

The UI uses `useLocationSession`, read-only native `BushMeshLocation.getStatus()`,
`PermissionsAndroid.check()`, `AppState` and the existing encrypted
breadcrumb trail. It never requests runtime permissions, changes GPS
tracking or starts/stops the radio service while mounted or unmounted.
The existing explicit `LocationScreen` → Start GPS remains the sole
permission-requesting action. A session's last fix disappears on stop
by design; a previously encrypted track can supply a **historical**
last-known position, never assumed current or GPS-sourced if unknown.

## Persisted non-sensitive preferences

`src/device/gps/gpsPreferenceCodec.ts` whitelists:
- `acquisitionMode`: responsive (1 s / 0 m, original behavior), balanced
  (5 s / 5 m), battery-saver (15 s / 25 m)
- `staleAfterSeconds`: 45, 90 or 180
- `accuracyWarningMeters`: 25, 100 or 500
- `showCoordinates`: false by default

All values are versioned and strictly validated; no raw coordinates,
PSKs, identity secrets, route history or extra keys are stored here.
`GpsPreferencesStore` serializes updates, rejects failed commits and
restores stored values after app/process restart. Corrupt snapshots
fail to safe defaults with visible error. Android uses an isolated
key/AAD on the already-existing `BushMeshPersistenceModule`, without
registering another native module or persistence owner.

The existing `AndroidGpsLocationProvider.start` defers its native
`start(minTimeMs, minDistanceMeters)` until the preferences have loaded,
and serializes native start/stop to avoid reconnect and cancellation races.
The component **never** calls `start`; user-initiated `startNativeGps`
in the existing session provider remains the only entry point.
Preferences saved mid-session apply to the **next explicit GPS start**;
the current session is never restarted by UI settings edits.

The native parameters are Android LocationManager minimum request
**hints**, not guarantees of hardware fix frequency or energy use.
GNSS hardware may remain powered; use battery saver only after
field tests of position freshness in moving convoys.

## Foreground/background policies

The checked-in AndroidManifest declares:
- `ACCESS_FINE_LOCATION`
- `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION`
- `BushMeshRadioService` with foreground type `location`

It **does not** declare `ACCESS_BACKGROUND_LOCATION`.
`gpsReadiness.ts` checks fine/approximate permission and existing
`BushMeshLocation.getStatus()` without requesting permissions.
`gpsDiagnostics.ts` distinguishes unsupported, denied, unknown,
GPS disabled and app backgrounded states.

A foreground-started location foreground service may continue updating
when the app is backgrounded. However, independent background starts
and restoration of GPS tracking after process death are **not**
guaranteed; the UI deliberately reports background-start readiness
as **not configured**. No background permission request or automatic
tracking launch is added. Android 12+ foreground-service background
launch restrictions and Android 14+ while-in-use enforcement make
this distinction important. References:
- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- https://developer.android.com/about/versions/14/changes/fgs-types-required

## Radio-position and freshness ownership

`BushMeshPositionPlanner` already chooses LoRa send cadence via
`getAdaptivePositionDecision` and rejects poor position inputs.
`LocationSessionContext.respondToPositionRequest` currently uses a
separate **45-second** hard guard. Both are intentionally untouched.
The new stale/accuracy preferences affect only **Device diagnostics**.
Neither GPS preferences nor Android GPS switch/location changes
automatically alter MeshCore RF settings.

## Verification & known dependencies

Dedicated tests cover:
- serialization/invalid profiles/secrets excluded
- atomic ordered saves, restart restore, absent native port, corrupt data
- read-only permission check, GPS-disabled, denied/unknown status
- missing GPS, stale/future timestamps, accuracy, historical breadcrumbs
- foreground vs background readiness and device/simulator distinction
- native GPS cancellation/order and saved acquisition hints

Outstanding **integration**:
1. Mount the exported `DeviceGpsSettingsPanel` in Device → GPS
   (without changing `App.tsx` or adding a location provider).
2. Keep the existing Start GPS / Stop GPS controls visible alongside it.
3. Field-test Android 12–16 foreground-service transitions,
   precise permission denial, disabled GPS, power saver, and app restarts.
4. If background-initiated tracking is required later, a separate
   Android permission/manifest and native lifecycle design is mandatory;
   a display setting alone cannot grant this capability.
