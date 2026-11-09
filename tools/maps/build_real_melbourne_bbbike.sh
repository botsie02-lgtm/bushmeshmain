#!/usr/bin/env bash
# Build REAL Melbourne roads using BBBike's raw city OSM PBF, not tile servers.
# Sources, clips, and large map binaries remain outside the Git checkout.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$HOME/bushmesh-melbourne-cbd"
if (( $# > 0 )); then WORK="$1"; fi
BBBIKE_URL="https://download.bbbike.org/osm/bbbike/Melbourne"
CITY="$WORK/Melbourne.osm.pbf"
CHECKSUMS="$WORK/CHECKSUM.txt"
CLIP="$WORK/melbourne-central.osm.pbf"
ARCHIVE="$WORK/melbourne-cbd-roads.mbtiles"
for program in curl osmium grep md5sum sha256sum python3; do
  command -v "$program" >/dev/null || { echo "Missing: $program" >&2; exit 2; }
done
mkdir -p "$WORK"
case "$WORK/" in "$REPO/"*) echo "Work directory must be OUTSIDE Git" >&2; exit 2 ;; esac

if [[ ! -f "$CITY" && ! -f "$CHECKSUMS" ]]; then
  echo "Downloading BBBike city PBF (raw OSM; NOT raster map tiles)."
  curl -fLSs --retry 2 --connect-timeout 20 --max-time 360 \
    --max-filesize 125000000 "$BBBIKE_URL/Melbourne.osm.pbf" -o "$CITY.part"
  mv "$CITY.part" "$CITY"
  curl -fLSs --retry 2 --connect-timeout 20 --max-time 60 \
    "$BBBIKE_URL/CHECKSUM.txt" -o "$CHECKSUMS.part"
  mv "$CHECKSUMS.part" "$CHECKSUMS"
elif [[ -f "$CITY" && -f "$CHECKSUMS" ]]; then
  echo "Reusing the saved source PBF and its original checksum; no update."
else
  echo "Incomplete source pair. Provide both PBF and CHECKSUM.txt, or use a fresh work directory." >&2
  exit 2
fi
(
  cd "$WORK"
  grep -E '^[0-9a-fA-F]{32}[[:space:]]+Melbourne[.]osm[.]pbf$' CHECKSUM.txt \
    | head -n 1 > Melbourne.osm.pbf.md5
  test -s Melbourne.osm.pbf.md5
  md5sum --check Melbourne.osm.pbf.md5
)
CITY_SHA="$(sha256sum "$CITY" | cut -d ' ' -f1)"
echo "Actual city PBF SHA-256: $CITY_SHA"

if [[ ! -f "$CLIP" ]]; then
  osmium extract --strategy complete_ways \
    --bbox 144.92,-37.86,145.04,-37.76 \
    --output "$CLIP" "$CITY"
fi
CLIP_BYTES="$(stat -c %s "$CLIP")"
if (( CLIP_BYTES < 1 || CLIP_BYTES > 67108864 )); then
  echo "CBD clip too large or empty ($CLIP_BYTES bytes). Reduce source bounds." >&2
  exit 2
fi
CLIP_SHA="$(sha256sum "$CLIP" | cut -d ' ' -f1)"
if [[ ! -d "$WORK/.venv" ]]; then python3 -m venv "$WORK/.venv"; fi
"$WORK/.venv/bin/python" -m pip install --disable-pip-version-check \
  -r "$REPO/tools/maps/requirements.txt"
"$WORK/.venv/bin/python" "$REPO/tools/maps/build_melbourne_mbtiles.py" \
  --input "$CLIP" --source-sha256 "$CLIP_SHA" \
  --source-url "$BBBIKE_URL/Melbourne.osm.pbf" \
  --upstream-source-sha256 "$CITY_SHA" \
  --output "$ARCHIVE" --id melbourne-cbd-osm-roads-v1 \
  --version "bbbike-$(date -u +%Y%m%d)" --minzoom 12 --maxzoom 15
"$WORK/.venv/bin/python" "$REPO/tools/maps/validate_melbourne_mbtiles.py" \
  "$ARCHIVE" --require-real --source-pbf "$CLIP"
( cd "$WORK"; sha256sum --check melbourne-cbd-roads.mbtiles.sha256 )
cat > "$WORK/source-checksums.txt" <<EOF
Downloaded source: $BBBIKE_URL/Melbourne.osm.pbf
Licence: OpenStreetMap ODbL 1.0 - https://www.openstreetmap.org/copyright
Build completed UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Upstream city PBF SHA-256: $CITY_SHA
Upstream city PBF MD5 from BBBike CHECKSUM.txt: $(cat "$WORK/Melbourne.osm.pbf.md5")
Complete-ways extraction bounds (W,S,E,N): 144.92,-37.86,145.04,-37.76
Clipped PBF SHA-256: $CLIP_SHA
Clipped PBF bytes: $CLIP_BYTES
Generated archive: $ARCHIVE
$(sha256sum "$ARCHIVE")
EOF
echo "SUCCESS: real OSM roads MBTiles and manifest/provenance: $WORK"
echo "No map binary or downloaded source was committed to Git."
