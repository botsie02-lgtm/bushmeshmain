# ConvoyMap v1 — Drive integration boundary

`src/maps/ConvoyMap.tsx` exports `ConvoyMap`, `ConvoyMapProps`, and
`ConvoyMapTileSource`. `src/maps/convoyMapModel.ts` exports the pure location,
freshness, projection, camera, tile-planning, and overlay types.

## Public inputs

- `activeConvoyId: string | null` — authoritative active convoy context.
  When null the renderer suppresses all member positions.
- `authorisedMembers: readonly ConvoyMapMember[]` — **pre-filtered** list of
  active-convoy members that this user is allowed to see. Each member is
  `{id, label, position: ConvoyMapFix | null}`. Pass explicit null when
  location is missing. **Never** pass every discovered MeshCore contact,
  public radio node, or all entries from `ConvoyContext.vehicles`.
- `selfFix: ConvoyMapFix | null` — GPS coordinate, `receivedAtMs` epoch ms,
  optional accuracy and heading degrees. A disappearing fix retains the last
  valid in-memory position as **last known**. No persisted stale position is
  invented after a cold start.
- `packCatalog: readonly BushMeshMapPackCatalogEntry[]` — existing authenticated
  catalog state from `useOfflineMaps()`. A pack is eligible only when its
  artifact matches the exact manifest and installation is verified. Metadata
  or simulated coverage is not tile data.
- `tileSource?: ConvoyMapTileSource` — optional offline-only image resolver
  accepting `{pack, z, x, y}`. It must return a local `file://`, `content://`,
  or `data:image/...;base64` URI (or null when unavailable). HTTP(S) responses
  are explicitly rejected; the renderer never downloads geographic data.
- `overlays?: readonly ConvoyMapOverlay[]` — explicit, trusted geometry for
  future route, hazard, checkpoint and regroup layers. These are not pulled
  from broad radio discovery.
- `height?: number` (default 350), `nowMs?: number` (deterministic testing).

`MapScreen` is a compatibility host with optional `activeConvoyId`,
`authorisedMembers`, `overlays`, and `tileSource` props. The existing app
mounts it with no active-convoy context, so it shows **self only** until the
App Shell worker supplies authorised active-convoy membership.

## Current capabilities and hard prerequisite

The viewport supports Web Mercator, pan, zoom, follow-self, frame-convoy,
north-up/heading-up, fresh-first convoy framing, position age and last-known warnings, headings, missing
member positions, antimeridian wrapping, an explicit regional pack selector,
tile error/empty states, and offline-only raster tile rendering **when a tile
source exists**. The map labels itself "position plot only" otherwise.

The already-working `BushMeshMapPacks` Android module downloads and
SHA-256-verifies PMTiles/MBTiles archives and persists catalog metadata. **It
does not read tiles from those archives.** No Android code or package ownership
was changed here. The optional `nativeOfflineTileSource` expects the future
Android-owned `NativeModules.BushMeshOfflineTiles.readTileBase64(packId,
manifestVersion, format, z, x, y)` method returning
`{mimeType: 'image/png' | 'image/jpeg' | 'image/webp', base64: string} | null`.
The Android worker must implement PMTiles and MBTiles decoding, supported
compression, tileset metadata/projection validation, local file isolation,
memory-bounded reads, and lifecycle handling. Until then, no basemap is
rendered, including after downloading an archive. This limitation is surfaced
to the driver, never hidden behind an online or simulated map.

**Security:** native should enforce app-private pack paths and revalidate
requested manifest/version/format against its own verified metadata, not
trust arbitrary URI strings. Avoid decoding huge tile blobs at once. Cross
tile boundaries, format compatibility and attribution require device testing.

## Offline storage and restart

`OfflineMapProvider` owns registration, explicit download, cancellation,
verification, removal and encrypted catalog snapshots. On Android restore,
`revalidateRestoredMapCatalog` rechecks every recorded ready pack using the
existing native SHA-256 verifier, before marking it ready; missing files are
demoted and failed verification is visible. No download occurs on restart.
Download errors, disk exhaustion and invalid manifests are surfaced by
existing installer/catalog APIs; the Android native writer already cleans
partial files. Region selection is local UI state and defaults to the first
verified pack after a restart; it is not falsely claimed persisted.

## Testing and integration responsibilities

`__tests__/convoyMapModel.test.ts` covers authorisation, missing/stale/lost
fixes, camera fallback, orientation, Web Mercator, antimeridian, tile budget
and offline-only URI checks. `__tests__/mapPackRecovery.test.ts` covers
reverification on restart. Native archive decoding, Android rendering and
download interruption/storage-full tests still require an Android runner.
The App Shell worker should embed `ConvoyMap` in Drive, supplying the explicit
authorised active-convoy member projection. Never let the map derive active
membership from radio discovery.
