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

The native `BushMeshOfflineTiles` module implements
`readTileBase64(packId, manifestVersion, format, z, x, y)` and returns a
`{mimeType: 'image/png' | 'image/jpeg' | 'image/webp', base64: string} | null`
object. It reads real raster imagery directly from the already installed,
SHA-256-verified app-private archive. It does not download any tiles or accept
arbitrary file paths, and it rejects unsupported/corrupt/absent tiles.

Supported archives: **MBTiles** with SQLite metadata `format` of PNG/JPEG/WebP,
TMS Y-coordinate reversal, or **PMTiles v3** with XYZ Hilbert indexing,
root/leaf varint directories, and internal/tile compression **none** or
**gzip**. PMTiles Brotli/Zstd, vector/AVIF raster formats and unusual tile sizes
are **not** supported; a verified archive with unsupported content still yields
an unavailable-tile state, never invented basemap imagery. Individual image
blobs and decompression output are limited to 1 MiB; directory output is limited
to 2 MiB; file handles are opened and closed per request. Two worker threads
with a bounded queue serve native requests.

A native-only verification receipt is created by `BushMeshMapPacks` after a
successful SHA-256 verification (download or explicit `verifyPack`). The reader
resolves only `filesDir/bushmesh-map-packs/<id>/pack.<format>` and checks native
receipt ID, version, format, size and modified time; the full file SHA-256 is
checked on first tile access each process and after a file-stat change. Packs
installed before this feature must be reverified once (the existing
`OfflineMapProvider` restart flow performs this on Android). Removing a pack
invalidates the receipt. The receipt is not a substitute for the secure
catalog's metadata or pack download manifest.

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


## Airplane-mode acceptance test (physical Android device)

1. Build and install the feature branch's APK. Confirm `BushMeshOfflineTiles`
   is registered and the app launches. You will need a trustworthy *raster*
   regional MBTiles (metadata `format=png|jpg|webp`) or PMTiles v3 (raster
   type PNG/JPEG/WebP, internal+tile compression none/gzip) with accurate bounds,
   zoom range, length, SHA-256, source URL, and required attribution in its
   V1 manifest. Avoid vector-only PMTiles packs.
2. While online, provision a **trusted** manifest into `OfflineMapProvider`
   via `registerMapPackManifest` (or a trusted catalog integration) and
   explicitly choose **Download**. The base branch's pack-management panel
   lists registered packs but does not itself discover or register new regions:
   a prepared trusted manifest/test integration is a prerequisite. Wait for
   SHA-256 verification.
   Use **Verify** in map-pack management to establish the native receipt.
3. Open Drive / Map, choose the verified region. With phone GPS on and the
   camera centered **inside the downloaded coverage**, check that actual
   offline basemap details (roads/terrain) appear behind the self marker.
   Status must advance to `OFFLINE BASEMAP READY` or `PARTIAL OFFLINE
   BASEMAP` only after React Native Image `onLoad` succeeds.
4. Enable **Airplane mode**, disable Wi-Fi and cellular data, and leave
   location enabled. Force-close and relaunch BushMesh (the encrypted map
   catalog is restored and the native archive SHA-256 rechecked). Confirm
   imagery remains visible; pan/zoom within the downloaded region; switch
   NORTH/HEADING and FOLLOW/CONVOY. No network should be needed.
5. Move beyond pack bounds or zoom into a level without tiles; expect
   unavailable tiles, not online basemap substitution. Stop GPS: last-known
   fix must be marked stale; convoy members must still be explicitly
   authorised. Verify a non-member public MeshCore node is **not** plotted.
6. Corrupt/delete the local archive using a debug-only method, or remove it
   from pack management; relaunch and verify ready state is revoked and no
   map imagery is displayed. Exercise cancellation, invalid SHA and low disk
   space separately with a disposable test pack.

The existing UI does not auto-create map sources: without an actual downloaded
raster pack and a suitable manifest, an offline basemap cannot be demonstrated.
