# BushMesh: trusted Australian raster map provisioning (field-test v1)

## Verified real Melbourne CBD pack — 9 November 2026

**A real roads-only raster archive has now been generated and validated on GitHub
Actions.** It is a temporary downloadable Actions artifact, NOT a binary in
Git and NOT a geographically imaginary test fixture:

- **Download real MBTiles ZIP:** https://github.com/botsie02-lgtm/bushmeshmain/actions/runs/42574447304/artifacts/13654109795
- **Generation/validation run:** https://github.com/botsie02-lgtm/bushmeshmain/actions/runs/42574447304
- Artifact name: bushmesh-melbourne-cbd-real-osm-mbtiles.
- The Actions artifact expires **16 November 2026 UTC** (seven-day retention).
- MBTiles: melbourne-cbd-roads.mbtiles, **1,331,200 bytes**, **96 actual PNG
  raster tiles at z12–z15**, tile dimensions 256x256.
- Declared bounds: **south -37.84, west 144.94, north -37.78, east 145.02**.
- Exact archive SHA-256:
  **2801b85fff3eb42dca50179a6c729a523ae239258112cfe96f2ca7201689fb70**.
- Source: BBBike's Melbourne city OSM PBF, 9 November 2026 fetch, with publisher
  CHECKSUM.txt MD5 **b4133b19665cd7c74bb38c9f4bad225e**. Full city source
  SHA-256 **2f710009566d4d9d466fc1f0b36965174581f2aef3c48b65054f1bf8726331b2**.
- Independently clipped PBF: **13,638,332 bytes**, SHA-256
  **21196db231f4e0fb1507020e106a6305c909c3c237d0c95ff256a53c134d3f9f**.
- Production path: complete_ways clip to (west 144.92, south -37.86,
  east 145.04, north -37.76), then in-repository PNG MBTiles builder.
- Provenance: the ZIP includes the full source-checksums.txt and
  .provenance.json (date, upstream/clip SHA-256, Python/Pillow/SQLite versions,
  generator fingerprint, tile count, road stroke count).
- Validation: ZIP CRC, SQLite PRAGMA integrity_check, exact manifest
  size/SHA-256, all 96 images decoded, tile coordinate/zoom/bounds consistency,
  and genuine road-colour pixels in all 96 tiles.
- Licence/attribution: **© OpenStreetMap contributors · ODbL 1.0**,
  https://www.openstreetmap.org/copyright.
- **Limitation:** simple road strokes over a background, NOT hillshade,
  elevation, street labels or a complete outdoor/topographic basemap.

Download this ZIP while still available and keep a private copy. Extract it.
It contains the actual MBTiles, .manifest.json, .sha256, .provenance.json
and source-checksums.txt. Do NOT import the ZIP or JSON as a map archive:
IMPORT FILE must select only the **.mbtiles** file.

The app does not automatically trust a ZIP because it came from Actions.
Use the reviewed-manifest registration + native SHA-256 verification described
below. This is not a signed cartographic publisher catalog and no phone
rendering claim is made until an on-device test actually passes.

### Windows PowerShell — verify the downloaded real archive

Unzip the Actions download into a directory, for example
C:\Users\<YOUR_USER>\Downloads\BushMeshMaps\melbourne-real.
In a **PowerShell** window:

~~~powershell
$mapDir = Join-Path $env:USERPROFILE 'Downloads\BushMeshMaps\melbourne-real'
$archive = Join-Path $mapDir 'melbourne-cbd-roads.mbtiles'
$manifest = Get-Content (Join-Path $mapDir 'melbourne-cbd-roads.mbtiles.manifest.json') -Raw | ConvertFrom-Json
$expectedSha = '2801b85fff3eb42dca50179a6c729a523ae239258112cfe96f2ca7201689fb70'
$actualSha = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$actualBytes = (Get-Item -LiteralPath $archive).Length
if ($actualSha -ne $expectedSha -or $actualSha -ne $manifest.sha256 -or
    $actualBytes -ne $manifest.expectedBytes) {
  throw 'STOP: Melbourne raster archive differs from the reviewed manifest.'
}
Write-Host "Real Melbourne MBTiles SHA-256 verified: $actualSha ($actualBytes bytes)"
~~~

This validates actual archive bytes against the fingerprint above and the
generated JSON. It does not replace the Android native verifier. The
corresponding source-provenance fields are in the ZIP.

### Rebuild from actual raw OSM using Windows + WSL (no statewide download)

**PowerShell**, in your BushMesh checkout (adjust this path if needed):

~~~powershell
Set-Location (Join-Path $env:USERPROFILE 'GitHub\bushmeshmain')
git fetch origin feature/trusted-australian-map-packs-v1
git switch feature/trusted-australian-map-packs-v1
wsl --install -d Ubuntu
~~~

If WSL Ubuntu is already installed, skip the install command and open Ubuntu.
If Windows requests a reboot during WSL installation, complete that first.

**WSL Ubuntu terminal**, from the repository root (replace the example
Windows user/path if your checkout is elsewhere):

~~~bash
sudo apt-get update
sudo apt-get install -y osmium-tool python3 python3-venv python3-pip curl
cd /mnt/c/Users/<YOUR_WINDOWS_USER>/GitHub/bushmeshmain
bash tools/maps/build_real_melbourne_bbbike.sh "$HOME/bushmesh-melbourne-cbd"
~~~

This scripted workflow (1) downloads the **~86 MB city PBF** from
https://download.bbbike.org/osm/bbbike/Melbourne/Melbourne.osm.pbf
and its same-directory CHECKSUM.txt, (2) checks the supplier MD5,
(3) clips the smaller CBD PBF with osmium complete_ways, (4) calculates
upstream and clipped SHA-256, (5) rasterizes the true road ways, (6) validates
**every** MBTiles tile, SQLite integrity, bounds/zoom, source/manifest hashes,
and (7) writes source-checksums.txt and provenance. All output/source files
stay in the **WSL home directory outside Git**. It will not silently overwrite
an existing archive.

Inspect all real-archive output and drag the file to Windows Downloads with:

~~~bash
explorer.exe "$(wslpath -w "$HOME/bushmesh-melbourne-cbd")"
~~~

In that Explorer window, copy melbourne-cbd-roads.mbtiles and its
.manifest.json/.sha256 companions to Windows Downloads, then transfer
the archive to the Galaxy S22+ using USB file transfer.

Because BBBike continuously updates the city PBF, **a future rebuild may
produce different bytes and SHA-256**. That is expected: review the
newly calculated manifest/size/hash instead of reusing the 9 November
fingerprint. For byte-for-byte reproduction of that exact build, preserve
the upstream PBF snapshot and clipped source outside Git, and consult the
recorded generator/Python/Pillow/SQLite fingerprints.

### Separate Galaxy S22+ tests (after Wave 3 integration)

**Prerequisite:** install an Android APK that actually includes both the
existing native BushMeshOfflineTiles reader and this feature branch's
manifest-registration/Android document-picker integration. Installing an
earlier Wave 2 APK does not make a new UI/native module magically available.
Preserve app data/radio trust; do not clear storage.

**Test 1 — synthetic MBTiles fixture (plumbing only):**

1. Use the previously supplied synthetic fixture ZIP, or create an equivalent
   explicitly synthetic archive with:

       python tools/maps/build_melbourne_mbtiles.py --fixture \
         --id melbourne-synthetic-pixels-v1 --version fixture-v1 \
         --minzoom 12 --maxzoom 13 --output melbourne-synthetic.mbtiles

2. Copy the **synthetic .mbtiles** to Galaxy S22+ Downloads; use its **own**
   .manifest.json and .sha256, not those for real Melbourne roads.
3. Open BushMesh Map > Verified pack catalog > ADD REVIEWED MAP PACK.
   Paste full manifest JSON; paste the checksum independently read from its
   .sha256; acknowledge the synthetic source; REGISTER REVIEWED MANIFEST.
4. Tap IMPORT FILE and select the synthetic .mbtiles using Android Files.
   Expect INSTALLED · VERIFIED, then VERIFY. In ConvoyMap choose its pack and
   press **VIEW PACK**. Confirm the **SYNTHETIC FIXTURE / NO REAL ROADS**
   images render, not real streets. Test airplane mode and restart.
5. This **does not** qualify the real road/terrain acceptance gate.

**Test 2 — genuine Melbourne CBD OSM road pack:**

1. Unzip the verified REAL archive artifact above (or your local rebuild) and
   copy melbourne-cbd-roads.mbtiles to the S22+ Downloads folder.
2. Open the new reviewed-manifest control, paste the **real** JSON, verify the
   real source/attribution/region/zoom/byte count, paste the independently
   checked real SHA-256, tick review, REGISTER REVIEWED MANIFEST.
3. Tap **IMPORT FILE**, choose the matching .mbtiles (not ZIP/JSON). Wait for
   the verified native receipt. Expect INSTALLED · VERIFIED, then VERIFY.
4. In ConvoyMap select the actual Melbourne pack and press **VIEW PACK**.
   This centres the CBD even when you are not physically there or GPS is
   unavailable. Confirm road imagery underneath your existing overlays,
   and the renderer's OFFLINE BASEMAP READY/PARTIAL status **only after
   actual image onLoad**, never just manifest registration.
5. With Wi-Fi and cellular **off**, enable airplane mode but keep GPS on.
   Force-close/reopen BushMesh, choose VIEW PACK again and confirm real
   imagery is still there. Pan/zoom within z12–15.
6. Pan outside bounds: missing data stays missing (no online fallback).
   Test REMOVE (confirmation), re-import, and a corrupted copy of the
   .mbtiles: an invalid SHA-256 must never become installed/ready.
7. Test authenticated member filtering independently. An offline map does not
   authorize any radio contact to appear as a convoy member.

### Source/licensing and provenance cautions

The BBBike city MD5 is a source-download integrity check, **not a
publisher signature**. The subsequent SHA-256 is computed on actual downloaded
and clipped bytes; it is not a magic assertion that a future updated BBBike
extract will have the same fingerprint. Keep all source PBFs and test binaries
out of Git. If redistributing derived OSM databases, review ODbL obligations.

~~~bash
# WSL independent file-level and geographic validation:
"$HOME/bushmesh-melbourne-cbd/.venv/bin/python" \
  tools/maps/validate_melbourne_mbtiles.py \
  "$HOME/bushmesh-melbourne-cbd/melbourne-cbd-roads.mbtiles" \
  --require-real \
  --source-pbf "$HOME/bushmesh-melbourne-cbd/melbourne-central.osm.pbf"
~~~


## Scope and provenance — no imaginary map packs

**No Melbourne or Victoria binary map pack, trusted HTTPS artifact host or SHA-256
digest is hardcoded into BushMesh.** A verified, explicitly imported raster
archive is required. The completed real Melbourne test pack is available
as an external Actions artifact above; it is not bundled or pre-registered. The app does not bulk-download from a public
raster tile server, and there is no online raster fallback.

Recommended initial region: **Melbourne CBD**, a deliberately selected, small
test rectangle: south -37.84, west 144.94, north -37.78, east 145.02,
zoom 12–15, 256px PNG raster MBTiles. These are generator settings, not a
guarantee that an arbitrary source contains roads or that the entire State of
Victoria is covered. The default builder outputs at most **400** tiles (normally
96 tiles in this test rectangle). App support can be checked independently
with synthetic fixture tiles at zoom 12–13, but those are NOT actual geography.

### Licensed source, no scraping

- Real source: [Geofabrik's Victoria OpenStreetMap extract](https://download.geofabrik.de/australia-oceania/australia/victoria.html),
  in **.osm.pbf** form. This is raw vector map data, not pre-rendered raster
  map tiles. Expect the original state file to be much larger than the local
  Melbourne clip. Keep a dated source reference and hash locally.
- Data licence: [OpenStreetMap Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
  Credit **© OpenStreetMap contributors**, link to the licence information and
  assess ODbL share-alike/database distribution obligations before public
  redistribution. Geofabrik is the data extract distributor; it is not a
  blanket licence for arbitrary commercial raster style assets or terrain.
- **Do not** collect bulk tiles from https://tile.openstreetmap.org. Its
  [tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
  expressly prohibits tile archives/offline prefetching.
- The included simple renderer draws **genuine OSM road ways**; it does not
  generate elevation, hillshade, street names or a complete cartographic
  basemap. Terrain awaits a separately permitted dataset and styling workflow.

## Path A: first test with no geography (bounded synthetic fixture)

On a machine with Python 3.10+ and Pillow:

    python -m pip install Pillow
    python tools/maps/build_melbourne_mbtiles.py \
      --fixture \
      --id melbourne-synthetic-pixels-v1 \
      --version fixture-v1 \
      --minzoom 12 --maxzoom 13 \
      --output melbourne-synthetic.mbtiles

This produces three files, all on your machine:

- melbourne-synthetic.mbtiles: a real SQLite raster archive with 13 PNG tiles,
  every one conspicuously labeled **SYNTHETIC FIXTURE / NO REAL ROADS**;
- melbourne-synthetic.mbtiles.manifest.json: the exact reviewed map-pack V1
  metadata, local-import source, archive size and measured SHA-256;
- melbourne-synthetic.mbtiles.sha256: the independently inspectable checksum.

The fixture is for document-import, Android bitmap reading, restart and airplane
mode plumbing checks ONLY. It does not satisfy real-road/terrain acceptance.

Run its fixture test without OSM input:

    python -m unittest discover -s tools/maps -p 'test_*.py'

## Path B: actual Melbourne roads raster (preferred on Galaxy S22+)

Run in Ubuntu/WSL or an equivalent environment with **osmium-tool**,
Python 3.10+, the **osmium** Python package and Pillow. Keep the .osm.pbf
source outside the repository. Typical Ubuntu/WSL preparation:

    sudo apt-get update
    sudo apt-get install -y osmium-tool python3 python3-pip
    python -m pip install -r tools/maps/requirements.txt

1. **Preferred: request a SMALL Melbourne OSM PBF**, not a statewide
   download, from the [BBBike custom OSM extract service](https://extract.bbbike.org/).
   Choose PBF/Protocol Buffer (raw OSM data), select a rectangle around
   Melbourne roughly west 144.92, south -37.86, east 145.04, north -37.76
   and request the extract. Download the actual unique link supplied by
   BBBike; do not invent a static URL. Record its checksum and source.
   Name your local file `melbourne-central.osm.pbf` and proceed directly
   to step 3 below. BBBike provides raw OSM extracts under the applicable
   OSM data licence; it is NOT an offline raster tile server.

   **Alternative when using the official Geofabrik Victoria source**:
   Download the larger **Victoria OSM PBF**, not tiles:

       curl --fail --location --output victoria-latest.osm.pbf \
         https://download.geofabrik.de/australia-oceania/australia/victoria-latest.osm.pbf

   The URL above is for *raw data*. Record its download date, source and
   SHA-256; ideally use a dated Geofabrik extract for reproducible source
   provenance. Save it in a working directory OUTSIDE Git.

2. **Only for the larger Geofabrik source:** clip Melbourne first, adding a margin to preserve complete ways:

       osmium extract --strategy complete_ways \
         --bbox 144.92,-37.86,145.04,-37.76 \
         -o melbourne-central.osm.pbf victoria-latest.osm.pbf
       sha256sum melbourne-central.osm.pbf

   The smaller BBBike extract or the Geofabrik clip must be below 64 MiB for the intentionally bounded builder.
   If it is larger, reduce the region; do not raise the limit casually.

3. Generate a local PNG raster MBTiles **from OSM data**:

       python tools/maps/build_melbourne_mbtiles.py \
         --input melbourne-central.osm.pbf \
         --output melbourne-cbd-roads.mbtiles \
         --id melbourne-cbd-osm-roads-v1 \
         --version source-snapshot-v1 \
         --minzoom 12 --maxzoom 15
       sha256sum -c melbourne-cbd-roads.mbtiles.sha256

   Use the date/hash of the actual input extract for release naming instead of
   implying that 'source-snapshot-v1' refers to any particular published
   snapshot. The builder checks tile count, image samples, format metadata,
   geographic bounds and zoom and writes an archive SHA-256 *calculated from
   the bytes that really exist*. It never fabricates a map URL, hash or coverage.

4. Copy **melbourne-cbd-roads.mbtiles** into Downloads on the Galaxy S22+
   (USB file transfer, private transfer or Android Files). Also transfer
   the corresponding JSON manifest/checksum file or their text, and independently
   compare the checksum on your computer. Do not expose the archive on a
   public tile server.

5. Install the APK built from this feature branch. Open BushMesh's Map screen,
   scroll to **Verified pack catalog > ADD REVIEWED MAP PACK**. Paste the
   exact JSON from **melbourne-cbd-roads.mbtiles.manifest.json**. Inspect
   the rendered bounds, attribution, zoom, format, file size, source and hash;
   paste the separately reviewed archive SHA-256 from the **.sha256** file;
   explicitly tick the source/licence/fingerprint acknowledgement; press
   **REGISTER REVIEWED MANIFEST**. Registration alone does not install a pack.

6. Under the registered pack select **IMPORT FILE**. Android opens its
   system document picker. Select the matching .mbtiles file in Downloads.
   BushMesh streams it to app-private storage (512 MiB import limit),
   verifies **exact file length and SHA-256**, checks raster format and sample
   decoding, and issues the native verified receipt. No filesystem path or
   content URI is accepted from JavaScript.

7. Once status reads **INSTALLED · VERIFIED**, tap **VERIFY** and open the
   ConvoyMap near the centre of the declared region (e.g. within the CBD
   rectangle) at z12–15. Ensure **genuine OSM roads** are visible under the
   normal position/convoy overlays. Image load events, not manifest presence,
   control **OFFLINE BASEMAP READY / PARTIAL OFFLINE BASEMAP**.

### Alternative path: explicit HTTPS archive hosting

If **you** have created an HTTPS download endpoint you control and verified
its licence, build using:

    python tools/maps/build_melbourne_mbtiles.py \
      --input melbourne-central.osm.pbf \
      --output melbourne-cbd-roads.mbtiles \
      --url 'https://YOUR-REAL-REVIEWED-HOST/your-archive.mbtiles'

Replace that placeholder with a genuine existing HTTPS archive URL
**before running**. The generated remote-source manifest can be reviewed,
registered and installed via **DOWNLOAD**. The native installer enforces length
and SHA-256. BushMesh does not supply or invent such a host. Avoid publishing
files whose content hash will change at the same URL without a new manifest.

## Airplane-mode hardware acceptance

1. With a genuine pack **INSTALLED · VERIFIED**, image details must appear
   under ConvoyMap, within its coverage and supported zoom. Note the pack
   size and actual SHA-256 and inspect road geometry against the input source.
2. Enable airplane mode, disable cellular/Wi-Fi and keep GPS available.
   Fully force-close and restart BushMesh. Encrypted catalog restoration
   re-verifies each ready archive and native receipts; no network requests
   are required to read tiles.
3. Test follow-self, heading-up/north-up, frame-convoy, pan and zoom.
   Member markers still require the upstream authorised active-convoy
   roster; installing a map grants no membership.
4. Pan outside the declared bounds. Missing/unavailable tile areas must
   remain blank. **No tile-server fallback is permitted.**
5. Remove the test pack using **REMOVE** (confirm) and check that readiness
   disappears. For a *disposable* pack, edit/truncate the private archive
   with debug tooling, restart, and check that SHA verification revokes it.
   Verify a wrong manifest digest similarly fails without promoting data.
6. Run native fixture tests and standard build checks on a workstation:

       npm ci
       npm test -- --runInBand
       npx tsc --noEmit
       npm run lint
       cd android
       ./gradlew testDebugUnitTest assembleDebug --no-daemon

   Keep the rest of Wave 2 (radio/security/GPS) behaviour unchanged.

## Trust and known limits

The manual field-test registration form represents an **explicit operator
review**, not a signed catalog or remotely authenticated publisher. The
independent SHA-256 entered in the form only protects the bytes *to the extent
the operator obtained that digest from a trusted, independent source*.
A malicious JSON plus its own matching digest cannot prove publisher identity.
Production catalog rollout should reuse the existing pinned-host/catalog-ID
policy and add authenticated distribution/review where required.

The reader accepts MBTiles raster PNG/JPEG/WebP and supported PMTiles v3
raster/gzip variants. This builder deliberately outputs **MBTiles PNG 256px
without online requests**. "Unsupported" appears for non-raster/unsupported
archives; "INVALID" for failed digests/installation; status is only
"INSTALLED · VERIFIED" after native verification. The UI never promises
terrain from the roads-only builder.

**Physical validation is required on the Galaxy S22+ before Wave 2 accepts
real offline mapping.**
