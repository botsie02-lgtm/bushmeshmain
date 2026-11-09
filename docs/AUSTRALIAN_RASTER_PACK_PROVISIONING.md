# BushMesh: trusted Australian raster map provisioning (field-test v1)

## Scope and provenance — no imaginary map packs

**No Melbourne or Victoria binary map pack, trusted HTTPS artifact host or SHA-256
digest is hardcoded into BushMesh.** Until you run the builder, there is no real
road basemap available to register. The app does not bulk-download from a public
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

1. Download the official **Victoria OSM PBF**, not tiles:

       curl --fail --location --output victoria-latest.osm.pbf \
         https://download.geofabrik.de/australia-oceania/australia/victoria-latest.osm.pbf

   The URL above is for *raw data*. Record its download date, source and
   SHA-256; ideally use a dated Geofabrik extract for reproducible source
   provenance. Save it in a working directory OUTSIDE Git.

2. Clip the Melbourne source first, adding a margin to preserve complete ways:

       osmium extract --strategy complete_ways \
         --bbox 144.92,-37.86,145.04,-37.76 \
         -o melbourne-central.osm.pbf victoria-latest.osm.pbf
       sha256sum melbourne-central.osm.pbf

   The clip must be below 64 MiB for the intentionally bounded builder.
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
