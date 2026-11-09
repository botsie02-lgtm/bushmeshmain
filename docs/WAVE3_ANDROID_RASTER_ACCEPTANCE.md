# Wave 3 Android acceptance — real trusted Australian offline raster

**Purpose:** Unblock the only Wave 2 physical test not executed: real regional raster basemap on Galaxy S22+ (starting with a **small Melbourne/Victoria test region**, not a statewide or enormous download). This is a test procedure, **not** a claim that trusted packs are currently available.

## Gate A — provision a legally reviewable *real* pack

**Blocker today:** \`MapPackCatalogPanel\` displays/installs already registered packs; it does **not** discover or trust an external manifest by itself. The feature worker must deliver a trusted catalog/provisioning entry point that calls \`OfflineMapContext.registerMapPackManifest\` only with **reviewed** metadata. No fake/demo coverage, arbitrary user URL, or radio/contact invitation can be passed off as trusted map source.

1. Select a licensed source allowing the intended download, redistribution, rasterization, offline use and attribution. Record exact source name, source/download page, license terms/version and attribution obligations; check separate imagery/terrain layers before combining. Never assume all publicly accessible tiles are redistributable.
2. Prepare a **real PNG/JPEG/WebP raster** \`MBTiles\` or \`PMTiles v3\` archive for a compact Victoria/Melbourne coverage polygon and compatible zoom range. MBTiles metadata must declare a supported raster format and use normal SQLite/TMS indexing. PMTiles supports XYZ/Hilbert v3 with no/gzip directory+tile compression; vector tiles, Brotli/Zstd and AVIF are not accepted by the existing reader. Use tile dimensions 256 or 512 and keep per-tile decoded images within the native 1 MiB safety bound.
3. Inspect a known in-bounds road/terrain tile **before** publishing: correct archive type, license/attribution, useful tile pixels, expected zooms and bounds, no empty/missing-only archive. Use deterministic generation commands, inputs, tool versions, region geometry and output artifact version in the feature branch.
4. Calculate **exact** archive byte length and SHA-256 after finalization. On macOS/Linux: \`wc -c < pack.mbtiles\` and \`sha256sum pack.mbtiles\` (or pmtiles). On PowerShell: \`(Get-Item .\pack.mbtiles).Length\` and \`(Get-FileHash .\pack.mbtiles -Algorithm SHA256).Hash\`. Never reuse values from an older archive build.
5. Publish the immutable artifact at a vetted **HTTPS** URL and commit/review its matching \`BushMeshMapPackManifestV1\` entry. Required fields: \`schemaVersion: 1\`, stable \`id\`, \`name\`, \`version\`, \`bounds: {south,west,north,east}\`, \`format: 'mbtiles'|'pmtiles'\`, \`minZoom\`, \`maxZoom\`, \`tileSize: 256|512\`, \`expectedBytes\`, 64-character \`sha256\`, \`source: {kind:'remote',url:'https://...'}\`, and correct \`attribution\`. The reviewed manifest **must** match exact archived content. Validate via \`validateMapPackManifest\` plus a fixture validating raster headers/expected tile coordinates.
6. Expose an explicit staging **Register/Select region → Download → Verify** workflow. Do not download on app start or quietly register user-provided/untrusted JSON. Respect cancellation, disk-space and network errors. No new radio/GPS/BLE ownership commands.

Evidence required from worker: producer version and commands, license/provenance record, manifest JSON, archive size/hash, actual tile probe(s), fixture outputs, HTTPS accessibility and attribution screenshot.

## Gate B — install and render on Samsung Galaxy S22+

**Preconditions:** Wave 3 debug APK built from a recorded commit; original Wave 2 baseline preserved; phone app data, Radio History, channel #4 PSK and Australia (Narrow) profile retained; GPS remains user-controlled.

1. Upgrade BushMesh **without uninstalling/clearing data**. From **Device → Offline Maps** (or the delivered trusted catalog UI) select the reviewed Melbourne test region. Confirm catalog shows real version, expected size, attribution and coverage. Explicitly choose **Download**, wait for full file and SHA-256 verification, then **Verify** so \`BushMeshMapPacks\` creates its app-private verification receipt.
2. Inspect native install/reader state: registered \`BushMeshOfflineTiles\` bridge is available; \`BushMeshMapPacks\` verified size/hash; pack ID/version/format match receipt; no unsafe paths or external URL are passed to tile reads. These checks are prerequisites, **not** proof of rendered imagery.
3. Manually start phone GPS via existing explicit controls. Open **Drive → Open ConvoyMap** (or **Device → Offline Maps → Map**), select the verified pack and pan to a **known tile coordinate inside its actual extent**, at one of its declared zoom levels. Confirm real roads/terrain tiles render under the self marker. \`OFFLINE BASEMAP READY\` (or partial) can appear **only after a React Native Image \`onLoad\` for actual archive data**, not just manifest coverage/native module presence.
4. Record phone screenshots of readable regional roads/terrain, selected pack/zoom, attribution, last-fix freshness, actual loaded tiles and absence of online loading. Do not capture PSKs, private keys, message contents or precise GPS coordinates in diagnostic exports; screenshots can be cropped/redacted.
5. Enable **Airplane mode** and turn Wi-Fi/mobile data off while leaving location enabled. Force-close/restart app. Confirm encrypted catalog is restored, pack is reverified against native receipt/digest and the same real tiles render with **no network**. Pan/zoom within bounds and try north-up/heading-up/follow; no web fallback.
6. Navigate outside bounds, request an unsupported zoom or a deliberately missing tile. Expect unavailable/missing/partial status and **no fabricated basemap**; confirm other app UI and radio ownership are not affected.
7. With a **disposable non-production test pack only**, reject wrong SHA, modified bytes/same-size-and-changed-timestamp, wrong manifest version/format, missing receipt, unsupported vector/compression, malformed raster and invalid tile coords. Confirm null/rejection and no stale ready state or crash; repeat after a cold restart. Separately exercise cancel/retry, network loss and low-storage behavior.
8. Remove the disposable pack; confirm native receipt invalidation, catalog downgrade and image disappearance. Confirm pack management never deletes message history, radio settings, PSK, or GPS recordings.
9. Verify GPS stopping makes last-known position visibly stale/unavailable without marking any unverified public node as a convoy member. Changes to GPS controls must not stop the radio and vice versa.

**Map acceptance PASS:** licensed/provenanced raster archive and reviewed manifest; verified private installation and receipt; *real* raster pixels displayed at known in-bounds coordinates, also after airplane-mode cold restart; negative corruption/bounds/zoom tests fail closed; attribution and no online fallback confirmed. A download progress bar, SHA success, coverage rectangle or JVM test alone is **not** a pass.

## Gate C — Wave 2 radio and ownership regression (repeat on Wave 3 APK)

1. **Background Radio** connects to Heltec A with the existing MeshCore Australia (Narrow), channel #4 and unchanged PSK.
2. Send S22+ → LilyGo B. LilyGo displays one unique message. Record queued, GATT callback and \`PACKET_OK (0x00)\` stages separately from actual peer receipt; never infer RF delivery from local acceptance.
3. Send LilyGo B → BushMesh. Confirm displayed **once** and retained in encrypted Radio History after app restart.
4. **Stop Background Radio**. Confirm Android GATT ownership actually released, persisted reconnect target cleared, no automatic reconnect loop, and GPS state unaffected.
5. **BLE Tools** connects and sends/receives; disconnect cleanly. Background Radio reconnects and sends/receives. Repeat **three full handoff cycles**, including a Stop retry/error diagnostic if safely reproducible.
6. Move among all five tabs and return to Drive/Device GPS preferences and offline map management; native radio or GPS must not restart from mounting UI. Confirm preview-only STOP/HELP/HAZARD/REGROUP, no authorized convoy roster/alerts without Security v1 production binding, and no unverified position plotted as a member.
7. Preserve application data, Australia (Narrow) profile, channel #4 PSK, native command recovery, and encrypted history. Treat any deviation as a Wave 3 release blocker and return to the protected Wave 2 SHA for diagnosis.

## Gate D — report evidence and disposition

For each step record **tested APK SHA**, device/Android version, two radio endpoints, test pack ID/version/format, **non-secret** SHA-256, viewport zoom/area (without exposing exact user location), offline/network state, result (PASS/FAIL/BLOCKED), screenshot or redacted diagnostic reference, and reproduction of failures. Do not mark Wave 3 physically validated if any required gate is blocked. Commit only sanitised evidence/documentation to the Wave 3 branch; never upload secrets or raw private location traces.
