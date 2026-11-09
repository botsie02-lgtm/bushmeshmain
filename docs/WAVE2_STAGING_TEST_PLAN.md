# BushMesh Wave 2 — staged field acceptance (NOT yet hardware validated)

Protected physical Wave 1 baseline: `81ee28123dbfbc35dfce1bbe8ff2067500fe40b4`.
Keep original Australia (Narrow), Heltec A carrier slot #4, private channel
secret, radio configuration, pairing/trust data, encrypted Radio History and
Android native BLE ownership untouched. Do not clear application data.

## Trusted offline raster pack prerequisite

A verified **raster** pack is essential. No fake map readiness is permitted.
Obtain a permitted, attributed regional archive and an independently reviewed
`BushMeshMapPackManifestV1` with:
`schemaVersion: 1`, stable `id`, `name`, `version`, exact
`bounds: {south, west, north, east}`, `format: 'mbtiles'|'pmtiles'`,
`minZoom`, `maxZoom`, `tileSize: 256|512`, exact `expectedBytes`,
a 64-character SHA-256 `sha256`, `source: {kind:'remote', url: 'https://...'}`,
and required `attribution`. The app does not discover or sign manifests.
A trusted provisioning flow must explicitly call
`OfflineMapContext.registerMapPackManifest`; do **not** treat a carrier
invite, arbitrary downloaded JSON or a path from JavaScript as a trusted
manifest. The existing UI lists trusted/registered packs but cannot discover
new regions by itself.

Supported raster inputs: MBTiles SQLite with PNG/JPEG/WebP raster
metadata and TMS Y conversion; PMTiles v3 XYZ raster PNG/JPEG/WebP,
internal/tile compression none or gzip. Vector-only, Brotli/Zstd, AVIF,
unsupported zooms, oversize or corrupt raster content must fail closed.
The Android `BushMeshMapPacks` installer downloads HTTPS explicitly,
verifies exact length and SHA-256, and writes a native verification receipt.
Older packs must be manually re-verified to establish a receipt. Native
`BushMeshOfflineTiles` resolves the app-private pack only after verifying
the receipt, version, format, file stats and digest.

## On-phone map validation

1. Install the Wave 2 staging APK on the Galaxy S22+ without wiping data.
   Confirm Native Radio and BLE Tools retain existing credentials.
2. Provision the reviewed raster manifest using a trusted development/test
   integration. Explicitly Download then Verify; wait for the native receipt.
   No background download or registration occurs by opening Drive.
3. Open Drive > Open ConvoyMap with the phone's explicit GPS session active.
   Choose the verified pack, pan to a known in-bounds region and supported
   zoom, and confirm **real streets/terrain pixels** load (React Native
   Image `onLoad`). Only then can the map say OFFLINE BASEMAP READY.
4. Enable Airplane mode, turn off Wi-Fi/mobile data but leave GPS enabled;
   force close/reopen and confirm map catalog revalidation and actual offline
   pixels. Pan/zoom within bounds, test heading/follow and map pack switching.
5. Move out of bounds or beyond supported zoom; see unavailable tiles and no
   remote map fallback. Remove or corrupt a disposable test pack and verify
   its readiness revokes. Also test invalid hash, download cancel, low storage
   and restored-pack revalidation.

## Radio and provider regression

1. Native Background Radio connects to Heltec A; verify S22+ sends a unique
   channel #4 message received by LilyGo B. Confirm local queued, GATT
   callback and firmware PACKET_OK diagnostics are distinct from peer receipt.
2. LilyGo B sends a unique message; BushMesh displays it exactly once,
   persists encrypted Radio History, and retains carrier secrets on restart.
3. Native Stop clears Android ownership and persisted reconnect target;
   check no reconnect loop while GPS session remains independently running.
4. BLE Tools connects afterward and exchanges traffic in both directions;
   disconnect BLE Tools; Background Radio reconnects in both directions.
5. Repeat three ownership-switching cycles; inspect Stop retry failures,
   native command-session recovery, radio diagnostics and history preservation.
6. Switch among Drive, Radio, Convoy, Contacts, Device; ensure neither
   radio/GPS provider restarts on a tab change. GPS preferences must not
   request permission, start/stop tracking or alter the LoRa airtime policy.
7. With no verified Security v1 membership provider, Drive must show no
   authorised roster, no verified alerts and no authorised carrier binding.
   STOP, HAZARD, HELP and REGROUP remain previews, never transmissions.
   No MeshCore contact, channel PSK or invitation may create authorization.

## Simulator is a separate test fixture, not radio validation

Staging copies ONLY the deterministic simulator harness, two scenario suites
and isolated TS config from `test/network-simulator-v1`. It does not
merge that branch's old app, native, protocol, identity or runtime code.
Loss, duplication, partitions, stale GPS, 20-node congestion, security
adapter rejection and embedded/authenticated source mismatch are test models;
they cannot establish real RF delivery or production Security v1 readiness.

**Wave 2 hardware acceptance remains pending** until the full physical
sequence completes, including real archive tile display. Authenticated
membership activation and remote administration remain separately gated.
