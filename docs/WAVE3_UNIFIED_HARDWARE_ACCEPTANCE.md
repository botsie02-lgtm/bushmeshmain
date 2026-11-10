# Wave 3 unified Galaxy S22+ physical acceptance — NOT YET EXECUTED

## Verified 10 November 2026 Melbourne map integration update

The final seven commits of `feature/trusted-australian-map-packs-v1` through `a71366b82a0519a514f1032a2c7ba6ad9146d4b7` are integrated as a two-parent staging merge `b7e4ca01d8f7c40d57d3c769dafec83786cb1b65`; no generated PBF, MBTiles or tile pixels were committed or embedded.

The official map worker run at https://github.com/botsie02-lgtm/bushmeshmain/actions/runs/42574447304 created the real BBBike `melbourne-cbd-osm-roads-v1` version `bbbike-20261109`, 96 actual road PNG tiles at zoom 12–15, 1,331,200 bytes, reviewed SHA-256 `2801b85fff3eb42dca50179a6c729a523ae239258112cfe96f2ca7201689fb70`. Download the separate `bushmesh-melbourne-cbd-real-osm-mbtiles` artifact and verify its own manifest/checksum before Android import. It expires 16 November 2026 UTC. See `docs/AUSTRALIAN_RASTER_PACK_PROVISIONING.md`.

### Choose the correct APK for OFFLINE physical testing

The normal `assembleDebug` artifact is for developer testing with the React Native Metro server; by default it does **not** include an app JavaScript bundle. The Wave 3 CI now also builds `assembleRelease` (currently signed by the existing Android **debug keystore**, so this is NOT a production signed release). It verifies `assets/index.android.bundle` inside that APK and checks that the compiled Hermes bytecode contains `VIEW PACK`. Download the artifact named `bushmesh-wave3-standalone-fieldtest-<staging-SHA>`, extract `app-release.apk`, and install over the existing app without clearing its data. Use this standalone field-test variant for airplane-mode tests; it should not require a Metro server.

### VIEW PACK test without a Melbourne GPS fix

From Drive select **Open ConvoyMap**, or the existing Map view. First import and verify the **real** `.mbtiles` using Device → Offline map packs → ADD REVIEWED MAP PACK → IMPORT FILE. In the map choose `melbourne-cbd-osm-roads-v1` and press **VIEW PACK**. The control centres on **(-37.81, 144.98)** from the manifest rather than the phone's current location, at a clamped zoom (13 for this pack). A camera and tile-request Jest regression also checks this exact region with `selfFix=null` and untrusted members excluded. Native `Image.onLoad` must still be observed on the Galaxy S22+ before claiming actual map rendering, and force-close/restart in airplane mode must still pass.

This standalone APK includes **no map archive**: it preserves operator-reviewed document-picker import and local archive digest verification. The field-test build remains Security v3 enrolment-disabled and quick-action previews stay non-transmitting.


**Record the exact APK GitHub commit SHA and Android version before testing.** Use a Samsung Galaxy S22+, Heltec A, LilyGo B, the same previously working Australia (Narrow) MeshCore carrier profile and private channel **#4**, with the existing PSK and encrypted Radio History. Do not uninstall, clear data, reset a secret, or replace protected Wave 2 staging. A failure in previously validated radio behavior is a release blocker.

## A — Synthetic offline MBTiles plumbing (not geographic evidence)

On a workstation in the repository checkout (Python 3.10+):
```sh
python -m pip install Pillow
python -m unittest discover -s tools/maps -p 'test_*.py'
python tools/maps/build_melbourne_mbtiles.py --fixture --id melbourne-synthetic-pixels-v1 --version fixture-v1 --minzoom 12 --maxzoom 13 --output melbourne-synthetic.mbtiles
sha256sum -c melbourne-synthetic.mbtiles.sha256
```

Inspect `melbourne-synthetic.mbtiles.manifest.json`: `schemaVersion: 1`, `format: mbtiles`, `source.kind: import`, correct byte count, SHA-256, geographic bounds and attribution containing **SYNTHETIC**. The fake tiles are deliberately marked **NO REAL ROADS**; do not describe them as an Australian map.

Copy `.mbtiles` to Android Downloads without modifying bytes. Open BushMesh **Device → Offline map packs → ADD REVIEWED MAP PACK**. Paste the exact local-import manifest JSON; separately compare/copy SHA-256 from the generated `.sha256` file; acknowledge source, fingerprint and attribution; register. Registration alone must show **NOT INSTALLED**. Choose **IMPORT FILE**, select the archive through Android's own document picker, await checksum and raster inspection, then **VERIFY**. Check the native `BushMeshMapPacks` receipt and the `BushMeshOfflineTiles` resolver via actual tile display in **Drive → Open ConvoyMap**. Confirm synthetic pixels load as real local images but are not described as streets.

Negative tests on a **disposable synthetic pack only**: cancel the picker, cancel an in-progress import if possible, choose wrong file/size/hash, unsupported vector or malformed raster, stop/restart during import, remove and reimport, and force close/restart. Invalid/unverified or missing tiles must fail closed, no false `INSTALLED · VERIFIED`, no crash, no radio/GPS effect, and no JS-supplied file/content URI.

## B — Real Melbourne OSM roads raster (the previously BLOCKED Wave 2 test)

Use genuine, licensed raw OSM data; **never bulk-download tiles from tile.openstreetmap.org**. Follow `docs/AUSTRALIAN_RASTER_PACK_PROVISIONING.md`. The recommended small CBD test bounding box is **south -37.84, west 144.94, north -37.78, east 145.02**, zoom **12–15**. One reproducible route:

1. Obtain an actual small Melbourne `.osm.pbf` extract from BBBike (the resulting dynamic download URL must be provided by BBBike), or obtain Geofabrik's Victoria **raw OSM PBF** and clip it with `osmium extract --strategy complete_ways --bbox 144.92,-37.86,145.04,-37.76`. Record raw-source date/URL, hash and local license review; keep source files out of Git.
2. Install the documented `tools/maps/requirements.txt` dependencies (`Pillow` and Python `osmium`); install `osmium-tool` for the statewide clip. Run:
   ```sh
   python tools/maps/build_melbourne_mbtiles.py --input melbourne-central.osm.pbf --output melbourne-cbd-roads.mbtiles --id melbourne-cbd-osm-roads-v1 --version source-snapshot-v1 --minzoom 12 --maxzoom 15
   sha256sum -c melbourne-cbd-roads.mbtiles.sha256
   ```
3. Confirm archive metadata `format=png`, TMS rows, 256px PNG tile samples, nonempty genuine OSM road geometry, exact byte count and measured digest. Attribute **© OpenStreetMap contributors / ODbL** and review derivative/distribution obligations. The simple roads renderer does NOT add terrain or hillshade; do not claim terrain readiness.
4. Copy the locally produced MBTiles and manifest to S22+ Downloads. **Device → Offline map packs → ADD REVIEWED MAP PACK → IMPORT FILE → VERIFY**. Independently pin the actual digest. Do not use an invented hosted pack URL. Android must obtain its own SAF document URI and copy bytes into private storage, then create a native SHA-256 verification receipt.
5. **Drive → Open ConvoyMap**, navigate/pan to the actual declared bounds at z12–15. Confirm visible genuine roads and at least one successfully decoded `Image.onLoad` raster tile, with `OFFLINE BASEMAP READY`/partial only as warranted by real loaded pixels. A ready manifest or map coverage rectangle alone is insufficient. **Field Readiness may still say imagery not confirmed** because this build does not fabricate/forward map image-load evidence from ConvoyMap.
6. Turn Airplane mode ON, Wi-Fi and cellular OFF, leave GPS available if permitted; force-close and restart. Check encrypted catalog recovery, native revalidation/receipts and actual same roads rendered **without connectivity**, plus pan, zoom, north-up/heading-up and follow. Out-of-region/unsupported zoom should show unavailable tiles with no HTTP fallback.
7. On disposable packs only, test wrong hash, changed file after receipt, malformed/unsupported archive, absent tile, deletion, low storage, interrupted import or download. Never modify production credentials. Take redacted screenshots of rendered roads, pack ID/version and status, never PSKs or private precise coordinates.

**Map PASS requires actual offline geographic raster pixels after restart**, not just a synthetic fixture or successful Android JVM test.

## C — GPS diagnostics and lifecycle

1. Open **Device → GPS and location**: manual GPS controls appear. No permission dialog or tracking start on screen mount. Start GPS **explicitly** using the existing control (handle Android permission there).
2. Open **GPS preferences** and inspect the embedded **GPS Field Diagnostics**. Check source, fix age, precision/accuracy, heading, last-known/invalid/future-dated states and foreground/background limitations. Try Responsive, Balanced and Battery Saver preferences; show Android **requested update hints** separately from **actually measured fix interval/gaps**. Changing a preference never restarts active tracking or triggers radio sends.
3. Simulate losing location by disabling device location or moving into a low-signal environment, then restore. Confirm unavailable/stale/recovered status and safe reset behavior. No claim of autonomous background/process-restart tracking.
4. Export a technical diagnostic summary only by explicit action; verify coordinates are **excluded by default**. Check no passive export, no PSKs or identifiers. Stop GPS manually; Background Radio should remain unaffected.

## D — Drive navigation and safety

1. Five tabs remain **Drive, Radio, Convoy, Contacts, Device**. The Drive **Field Readiness** briefing is default; **Detailed Drive dashboard** opens the preserved previous dashboard separately, and **Back to Drive** returns without duplicated cards or loops.
2. From the briefing, test **Open ConvoyMap**, **Manage offline map packs** (real Device pack manager), **GPS details** (existing Device GPS preferences), **Radio messages** and **Convoy selection**. Returning between tabs must not restart GPS/BLE or reset radio ownership. Device hub **GPS and location** should return to manual controls.
3. Without production authenticated membership, roster, alerts and carrier authorization must remain unavailable, never inferred from MeshCore contacts or channel #4. **STOP / HELP / HAZARD / REGROUP** are LOCAL PREVIEW ONLY, with critical confirmation, no outgoing packet or history entry. Verify warnings for poor/stale GPS and nonexistent/unrendered maps.
4. If real speed is above the moving threshold, complex previews and map management should disable; test carefully in a safe parked setting using a controlled fixture where possible. Do not interact while driving.

## E — Galaxy S22+ Background Radio regression (three cycles)

1. Preserve **Australia (Narrow)** and private **channel #4 / unchanged PSK**. Background Radio connects to **Heltec A** with a single Android-native BLE owner.
2. S22+ → LilyGo B: send a unique message, verify LilyGo B actually receives it. Differentiate local queue, GATT callback, MeshCore `PACKET_OK (0x00)` and real peer delivery; no automatic resend on ambiguous acceptance.
3. LilyGo B → BushMesh: confirm live incoming `0x83` message appears **once** and survives restart in encrypted Radio History.
4. Select Background Radio **Stop**; verify physical disconnect, no zombie owner or reconnect loop, and radio Stop does not stop GPS. Use **BLE Tools** to connect and exchange messages **both directions**; explicitly disconnect BLE Tools.
5. Reconnect Background Radio to Heltec A, repeat bidirectional messaging. Perform the complete **Stop → BLE Tools → disconnect → Background Radio** ownership handoff **three times**, with status/diagnostic evidence. Any ownership uncertainty should fail closed, not create a second GATT connection.
6. Confirm radio/history/settings unchanged after moving among all five tabs, enabling GPS diagnostics, importing maps, and an app restart. No secret rotation or app-data wipe.

## F — Security gating, simulator and disposition

- `src/convoy/enrolmentV3` remains DISABLED. No joining completion, role elevation, verified remote convoy position, admin grant, revocation propagation or real Drive quick-action transmission. A proposal/signature is NOT authorization.
- Exercise simulator replay/partition/revocation and embedded node ID versus authenticated source mismatch regressions; simulator results are deterministic tests only, **not real RF or production cryptography validation**.
- Record APK SHA, date, Galaxy S22+ Android build, Heltec/LilyGo firmware, test pack ID, real raster source/hash, online/offline condition, route, observed actual pixels, and PASS/FAIL/BLOCKED for each section. Redact exact private location, secret keys and message bodies.

**Decision rule:** Full green CI + packaged APK means **ready for physical Wave 3 testing only**. Mark **Wave 3 hardware-validated** ONLY after A–F pass on the real phone (and genuine B raster renders in airplane mode). Otherwise retain protected Wave 2 `9956ef244881c79a64e582a08136eceb0a90dce5` as rollback.
