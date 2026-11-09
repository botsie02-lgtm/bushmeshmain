#!/usr/bin/env python3
"""Independent read-only archive/manifest/provenance inspection for BushMesh.

Validates EVERY raster tile, SQLite integrity, XYZ->TMS coverage, actual
byte length and SHA-256. A valid archive is not proof of on-device rendering,
nor does its metadata independently authenticate the OSM publisher.
"""
import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import sqlite3

from PIL import Image
from build_melbourne_mbtiles import MAX_TILES, tile_list

MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_TILE_BYTES = 1024 * 1024
ROAD_COLOURS = {(251, 252, 247), (232, 172, 99), (157, 171, 168)}


def checked(condition, description):
    if not condition:
        raise ValueError(description)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as input_stream:
        for block in iter(lambda: input_stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def inspect(archive_path, require_real=False, source_pbf=None):
    archive = Path(archive_path)
    manifest_path = Path(str(archive) + '.manifest.json')
    provenance_path = Path(str(archive) + '.provenance.json')
    checksum_path = Path(str(archive) + '.sha256')
    checked(archive.is_file() and archive.stat().st_size in range(1, MAX_ARCHIVE_BYTES + 1),
            'Archive missing or too large for Android document import')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    provenance = json.loads(provenance_path.read_text(encoding='utf-8'))
    checksum = checksum_path.read_text(encoding='ascii').strip().split()
    digest = sha256(archive)
    checked(manifest.get('schemaVersion') == 1 and manifest.get('format') == 'mbtiles' and
            manifest.get('tileSize') == 256, 'Unsupported manifest schema/format/tile size')
    checked(manifest.get('expectedBytes') == archive.stat().st_size and
            manifest.get('sha256') == digest and
            checksum == [digest, archive.name], 'Manifest/checksum does not match actual archive bytes')
    checked(manifest.get('source', {}).get('kind') == 'import' or
            manifest.get('source', {}).get('kind') == 'remote', 'Unrecognised map pack source')
    checked(bool(manifest.get('attribution')), 'Missing archive attribution')
    bounds = manifest.get('bounds', {})
    checked(isinstance(bounds, dict) and set(bounds) == {'south','west','north','east'},
            'Manifest geographic bounds missing or malformed')
    south, west, north, east = (bounds[k] for k in ('south','west','north','east'))
    checked(all(isinstance(v, (float, int)) and math.isfinite(v) for v in
                (south, west, north, east)) and
            -85 < south < north < 85 and -180 < west < east < 180,
            'Invalid geographic bounds')
    minzoom, maxzoom = manifest.get('minZoom'), manifest.get('maxZoom')
    checked(type(minzoom) is int and type(maxzoom) is int and
            0 <= minzoom <= maxzoom <= 16, 'Invalid raster zoom levels')
    expected_xyz = set(tile_list((south, west, north, east), minzoom, maxzoom))
    checked(0 < len(expected_xyz) <= MAX_TILES, 'Tile count outside supported budget')
    checked(provenance.get('schemaVersion') == 1 and
            provenance.get('archiveSha256') == digest and
            provenance.get('archiveBytes') == archive.stat().st_size and
            provenance.get('archiveName') == archive.name and
            provenance.get('bounds') == bounds and
            provenance.get('minZoom') == minzoom and
            provenance.get('maxZoom') == maxzoom and
            provenance.get('tileCount') == len(expected_xyz), 'Recorded provenance disagrees with actual archive')
    mode = provenance.get('kind')
    checked(mode in ('osm-roads', 'synthetic-fixture'), 'Unrecognised provenance mode')
    checked(not require_real or mode == 'osm-roads', 'SYNTHETIC TEST PIXELS are not genuine OSM road data')
    source = provenance.get('source')
    if mode == 'osm-roads':
        checked(isinstance(source, dict) and source.get('bytes', 0) > 0 and
                isinstance(source.get('sha256'), str) and len(source['sha256']) == 64,
                'Real map is missing source PBF fingerprint/size')
        checked(provenance.get('roadStrokes', 0) > 0 and
                provenance.get('tilesWithRoads', 0) >= max(1, len(expected_xyz) // 20),
                'Real map has inadequate rendered OSM road geometry')
        checked('OpenStreetMap' in manifest['attribution'],
                'Real OSM basemap lacks required OpenStreetMap attribution')
        if source_pbf is not None:
            pbf = Path(source_pbf)
            checked(pbf.is_file() and pbf.stat().st_size == source['bytes'] and
                    sha256(pbf) == source['sha256'], 'Local source PBF differs from recorded provenance')
    else:
        checked(source is None and provenance.get('roadStrokes') == 0 and
                provenance.get('tilesWithRoads') == 0 and 'SYNTHETIC' in manifest['attribution'],
                'Synthetic fixture must remain explicitly distinguishable from real roads')
        checked(source_pbf is None, 'Do not supply real OSM source for a synthetic fixture')
    road_tiles = 0
    with sqlite3.connect(f'file:{archive}?mode=ro', uri=True) as db:
        checked(db.execute('PRAGMA integrity_check').fetchone() == ('ok',),
                'SQLite integrity check failed')
        metadata = dict(db.execute('SELECT name, value FROM metadata'))
        checked(metadata.get('format') == 'png' and
                metadata.get('minzoom') == str(minzoom) and
                metadata.get('maxzoom') == str(maxzoom), 'MBTiles raster metadata mismatched')
        expected_bounds = [west, south, east, north]
        actual_bounds = [float(v) for v in metadata['bounds'].split(',')]
        checked(len(actual_bounds) == 4 and
                all(abs(x-y) < 1e-8 for x, y in zip(expected_bounds, actual_bounds)),
                'MBTiles metadata bounds disagree with manifest')
        checked(metadata.get('attribution') == ('SYNTHETIC TEST PIXELS' if mode == 'synthetic-fixture'
                else manifest['attribution']), 'Archive metadata attribution mismatch')
        coords = set()
        for z, x, tms_y, blob in db.execute(
                'SELECT zoom_level,tile_column,tile_row,tile_data FROM tiles'):
            checked(isinstance(z, int) and isinstance(x, int) and isinstance(tms_y, int) and
                    minzoom <= z <= maxzoom and 0 <= x < (1 << z) and
                    0 <= tms_y < (1 << z), 'Out-of-range archive tile coordinates')
            xyz = (z, x, (1 << z) - 1 - tms_y)
            checked(xyz in expected_xyz and xyz not in coords,
                    'Unexpected/duplicate tile outside declared geographic coverage')
            coords.add(xyz)
            checked(isinstance(blob, bytes) and 0 < len(blob) <= MAX_TILE_BYTES,
                    'Invalid or oversized raster tile')
            with Image.open(io.BytesIO(blob)) as image:
                checked(image.format == 'PNG' and image.size == (256,256),
                        'Unsupported raster image format or pixel dimensions')
                image.load()  # decode ALL pixels, not just the PNG header
                colours = image.convert('RGB').getcolors(maxcolors=256*256)
                if colours and any(colour in ROAD_COLOURS for _, colour in colours):
                    road_tiles += 1
        checked(coords == expected_xyz,
                f'Missing {len(expected_xyz - coords)} tile(s) from expected coverage')
    if mode == 'osm-roads':
        checked(road_tiles > 0 and road_tiles >= provenance.get('tilesWithRoads', 0),
                'Real OSM roads not found in decoded map imagery')
    return {'kind': mode, 'tileCount': len(expected_xyz), 'roadColourTiles': road_tiles,
            'bounds': bounds, 'minZoom': minzoom, 'maxZoom': maxzoom,
            'archiveBytes': archive.stat().st_size, 'archiveSha256': digest,
            'source': source}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', help='Generated .mbtiles path')
    parser.add_argument('--require-real', action='store_true', help='Reject synthetic pixels')
    parser.add_argument('--source-pbf', help='Optional input clip, independently compare its SHA-256')
    args = parser.parse_args()
    result = inspect(args.archive, args.require_real, args.source_pbf)
    print('VALIDATED BUSHMESH MBTILES')
    print(json.dumps(result, indent=2, ensure_ascii=False))
