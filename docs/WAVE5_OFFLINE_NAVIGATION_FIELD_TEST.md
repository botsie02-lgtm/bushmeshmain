# BushMesh Wave 5 — offline map and navigation field acceptance

**Feature branch:** feature/wave5-offline-navigation-v1
**Exact upstream base:** 37ded9fa36de2a14970b522a4e9fd1e677534dc2
**Physical baseline:** Galaxy S22+ owner-reported real Melbourne OSM raster
imagery in airplane mode with successful app force-close/restart
(docs/WAVE3_HARDWARE_ACCEPTANCE_REPORTED.md). This evidence is protected, not
claimed to have been repeated during this implementation.

## Preconditions: preserve verified archive, GPS and convoy security

Use the **already installed, verified** Melbourne OSM roads MBTiles with
manifest ID melbourne-cbd-osm-roads-v1, archive SHA-256
2801b85fff3eb42dca50179a6c729a523ae239258112cfe96f2ca7201689fb70.
Do not re-render, regenerate, mutate, replace or recalculate that archive's
manifest/receipt. Use a fresh test region only if separately verified.
Do not clear app data, uninstall over an incompatible signing key, or alter
radio channel PSK, Security v1/v2/v3 credentials or GPS permissions.

The map is NOT a road-routing engine. The Melbourne raster has genuine OSM road
drawings, not road graph topology, turn restrictions or turn-by-turn directions.
Only an attached and ready BushMeshOfflineRouteEngine can create real route
geometry and progress (src/state/RouteSessionContext.tsx). No engine = direct
bearings and breadcrumb visualisation only.

## Acceptance checklist — record screen/video + commit, no private coordinates

- [ ] Launch a Wave 5 integrated APK without wiping data. Check the installed
  real Melbourne pack remains VERIFIED; manually VERIFY the pack if needed.
  Record test APK commit, Android version and pack ID/digest, not personal GPS
  coordinates or radio secrets.
- [ ] With airplane mode ON, Wi-Fi/mobile data OFF, open the Map view, select
  Melbourne, VIEW PACK. Confirm actual road graphics beneath the existing
  markers; real tiles render, not a synthetic fixture, blank screen or catalog
  placeholder. Attribution remains visible even before the first image loads.
- [ ] Force-close/relaunch while still offline. Confirm that encrypted
  catalog restore and native receipt validation allow the same real local
  tiles to render without a request to any tile server.
- [ ] Pan continuously, then zoom between supported levels. Verify the image
  follows finger movement without reloading all nearby tiles or blanking
  already decoded visible tiles unnecessarily. Inspect counters for missing
  tiles. Explicit RETRY TILES must not create infinite retries.
- [ ] With a fresh self fix, use FOLLOW and zoom; the camera remains following
  the self marker. Toggle NORTH ↑ and HEADING ↑. Small GPS jitter should
  not cause constant map movement; larger real movements and heading changes
  should update. Stale or absent self heading must not rotate the map.
- [ ] Set camera to VIEW PACK without a current GPS fix. The map stays on
  local Melbourne coverage; FOLLOW without a current fix should not invent a
  new geographic position.
- [ ] Verify accuracy circle/approximate horizontal uncertainty for fixes
  with available accuracy. Low quality (>100m) and last-known positions get
  visible warning; unknown accuracy gets no invented circle. Do not confuse
  radio-heard field-test accuracy with authenticated member accuracy.
- [ ] Record a short real GPS trip through existing LocationSession.
  Breadcrumb trail must be visible under map markers. Map shows a bounded
  line while recorded distance comes from TrackRecorder. Close/reopen the app
  to verify the trail restores. Export GPX using existing Map Tools, verify
  timestamps/coordinates privately and full retained point count; rendering
  simplification must NOT remove points from GPX.
- [ ] With no authorised active convoy, no member positions appear. When
  legacy radio-heard positions exist, RADIO DIAG is OFF by default. Toggle
  RADIO DIAG ON: entries use the UNVERIFIED RADIO visual style and remain
  excluded from authorised member counts, convoy framing and routing.
  A MeshCore contact/channel invite never becomes verified membership.
- [ ] Pan beyond Melbourne's declared bounds. There must be no inferred road
  tiles, remote fallback, fake coverage or misleading ready state. Switching
  packs must discard old base64 results, even if their z/x/y keys overlap.
- [ ] Remove a disposable pack and confirm its readiness/tiles disappear.
  Test an independently corrupted disposable pack with wrong bytes/SHA: a
  failed native verification must not become installed-ready after restart.
  Do not corrupt the preserved physically tested Melbourne baseline.
- [ ] With no actual offline road graph engine attached, the route display
  must not claim turn-by-turn guidance. If a real ready engine exists, inspect
  the engine-generated polyline/progress separately from the recorded trail.

## Implementation-level regression expectations

Wave 5 Jest tests must cover: viewport priority, four-inflight read cap,
20 retained data-URI cap, stale archive response isolation, no HTTPS tile URL,
explicit retry, declared coverage/antimeridian, small camera jitter, GPS
accuracy, field-channel authority separation, track point preservation, and
bounded route/trail geometry.

Run the feature-scoped CI workflow for Jest, TypeScript, lint, Python raster
fixtures, Android testDebugUnitTest and assembleDebug. CI cannot prove RF,
realistic road-driving frame rates, Android resident memory pressure or actual
airplane-mode pixels. Attach device measurements/screenshots separately.
