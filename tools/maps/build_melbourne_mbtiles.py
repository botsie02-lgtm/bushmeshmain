#!/usr/bin/env python3
"""Create honest, bounded 256px raster MBTiles from a LOCAL OSM extract.

No use of any public tile server. --fixture renders labels indicating its
pixels are synthetic and must NEVER be passed off as real geography.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import sqlite3
import sys
import PIL
from urllib.parse import urlsplit
from PIL import Image, ImageDraw

BBOX = (-37.84, 144.94, -37.78, 145.02)  # south,west,north,east: small Melbourne CBD test
MAX_TILES = 400
MAX_SOURCE_BYTES = 64 * 1024 * 1024  # clip first with osmium extract
ATTRIBUTION = '© OpenStreetMap contributors · ODbL 1.0 https://www.openstreetmap.org/copyright'
WIDTHS = {'motorway': 5, 'trunk': 5, 'primary': 4, 'secondary': 3,
          'tertiary': 3, 'residential': 2, 'unclassified': 2,
          'living_street': 2, 'service': 1, 'pedestrian': 2,
          'footway': 1, 'path': 1, 'cycleway': 1}


def px(lon, lat, z):
    lat = max(-85.05112878, min(85.05112878, lat))
    size = (1 << z) * 256
    return ((lon + 180) / 360 * size,
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * size)


def tile_list(bounds, minzoom, maxzoom):
    south, west, north, east = bounds
    result = []
    for z in range(minzoom, maxzoom + 1):
        a, b = px(west, north, z)
        c, d = px(east, south, z)
        for x in range(int(a // 256), int(c // 256) + 1):
            for y in range(int(b // 256), int(d // 256) + 1):
                result.append((z, x, y))
                if len(result) > MAX_TILES:
                    raise ValueError(f'Exceeded {MAX_TILES} tile budget')
    return result


def real_roads(input_path):
    try:
        import osmium
    except ImportError as error:
        raise SystemExit('Install dependencies: pip install pillow osmium') from error
    if input_path.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError('Clip the Victoria .osm.pbf to Melbourne first (max 64 MiB)')
    roads = []

    class Handler(osmium.SimpleHandler):
        def way(self, way):
            kind = way.tags.get('highway')
            if kind not in WIDTHS:
                return
            points = [(node.location.lon, node.location.lat)
                      for node in way.nodes if node.location.valid()]
            if len(points) >= 2:
                roads.append((WIDTHS[kind], kind, tuple(points)))
                if len(roads) > 150_000:
                    raise ValueError('Source road complexity exceeds test budget')

    Handler().apply_file(str(input_path), locations=True)
    if not roads:
        raise ValueError('No genuine OSM road geometries present')
    return roads


def raster(z, x, y, roads, fixture, statistics=None):
    img = Image.new('RGB', (256, 256), '#e4e9de')
    painter = ImageDraw.Draw(img)
    if fixture:
        painter.rectangle((8, 8, 248, 248), outline='#bb1717', width=5)
        painter.text((16, 90), 'SYNTHETIC FIXTURE', fill='#bb1717')
        painter.text((16, 120), 'NO REAL ROADS', fill='#bb1717')
        painter.text((16, 151), f'z{z} x{x} y{y}', fill='#202e31')
    else:
        left, top = 256 * x, 256 * y
        drawn = 0
        for width, road_class, points in roads:
            coords = [(a - left, b - top)
                      for lon, lat in points for a, b in [px(lon, lat, z)]]
            if max(p[0] for p in coords) < -8 or min(p[0] for p in coords) > 264:
                continue
            if max(p[1] for p in coords) < -8 or min(p[1] for p in coords) > 264:
                continue
            if width >= 2:
                painter.line(coords, fill='#9daba8', width=width + 2, joint='curve')
            colour = '#e8ac63' if road_class in ('motorway', 'trunk', 'primary') else '#fbfcf7'
            painter.line(coords, fill=colour, width=width, joint='curve')
            drawn += 1
        if statistics is not None:
            statistics['road_strokes'] += drawn
            if drawn:
                statistics['tiles_with_roads'] += 1
    buffer = io.BytesIO()
    img.save(buffer, 'PNG', optimize=False)
    return buffer.getvalue()


def inspect(archive, expected_count, minzoom, maxzoom):
    with sqlite3.connect(f'file:{archive}?mode=ro', uri=True) as conn:
        metadata = dict(conn.execute('SELECT name,value FROM metadata'))
        assert metadata['format'] == 'png', 'MBTiles must have raster PNG metadata'
        actual = conn.execute('SELECT COUNT(*),MIN(zoom_level),MAX(zoom_level) FROM tiles').fetchone()
        assert actual == (expected_count, minzoom, maxzoom), f'Tile mismatch: {actual}'
        for data, in conn.execute('SELECT tile_data FROM tiles ORDER BY zoom_level DESC LIMIT 3'):
            assert len(data) <= 1024 * 1024, 'Tile exceeds Android limit'
            img = Image.open(io.BytesIO(data))
            img.verify()
            img = Image.open(io.BytesIO(data))
            assert img.size == (256, 256) and img.format == 'PNG'


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                return digest.hexdigest()
            digest.update(chunk)


def build(args):
    archive = Path(args.output)
    if archive.suffix.lower() != '.mbtiles' or archive.exists() or any(
        Path(f'{archive}{suffix}').exists() for suffix in ('.manifest.json', '.sha256', '.provenance.json')
    ):
        raise ValueError('Choose a NEW output with an .mbtiles suffix')
    if args.minzoom < 0 or args.minzoom > args.maxzoom or args.maxzoom > 16:
        raise ValueError('Supported test zoom levels are 0..16')
    bounds = tuple(map(float, args.bounds.split(',')))
    if len(bounds) != 4:
        raise ValueError('Provide south,west,north,east')
    south, west, north, east = bounds
    if not (-85 < south < north < 85 and -180 < west < east < 180):
        raise ValueError('Invalid bounds')
    tiles = tile_list(bounds, args.minzoom, args.maxzoom)
    source = None
    input_sha = None
    if not args.fixture:
        if not args.input:
            raise ValueError('Real roads require a local, clipped .osm.pbf')
        local = Path(args.input)
        if not local.is_file():
            raise FileNotFoundError(local)
        input_sha = sha256(local)
        if args.source_sha256 and input_sha.lower() != args.source_sha256.lower():
            raise ValueError('OSM input does not match separately pinned SHA-256')
        source = {'fileName': local.name, 'bytes': local.stat().st_size, 'sha256': input_sha}
        roads = real_roads(local)
    else:
        roads = []
    declared_source = getattr(args, 'source_url', None)
    upstream_sha = getattr(args, 'upstream_source_sha256', None)
    if upstream_sha and (len(upstream_sha) != 64 or
                         any(c not in '0123456789abcdefABCDEF' for c in upstream_sha)):
        raise ValueError('Upstream OSM source SHA-256 must be 64 hex characters.')
    if declared_source:
        origin = urlsplit(declared_source)
        if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password:
            raise ValueError('OSM source URL must be a real HTTPS source URL.')
    if source is not None:
        source['upstreamUrl'] = declared_source
        source['upstreamSha256'] = upstream_sha.lower() if upstream_sha else None
    if args.url:
        url = urlsplit(args.url)
        if url.scheme != 'https' or not url.hostname or url.username or url.password:
            raise ValueError('Remote URL must be an actual operator-controlled HTTPS archive URL')
    archive.parent.mkdir(parents=True, exist_ok=True)
    statistics = {'road_strokes': 0, 'tiles_with_roads': 0}
    try:
        with sqlite3.connect(str(archive)) as conn:
            conn.execute('CREATE TABLE metadata(name TEXT PRIMARY KEY,value TEXT NOT NULL)')
            conn.execute('CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB)')
            conn.execute('CREATE UNIQUE INDEX tile_index ON tiles(zoom_level,tile_column,tile_row)')
            meta = {'name': 'Synthetic test pixels, NOT a map' if args.fixture else 'Melbourne OSM roads',
                    'format': 'png', 'type': 'baselayer', 'version': '1.3',
                    'minzoom': str(args.minzoom), 'maxzoom': str(args.maxzoom),
                    'bounds': ','.join(map(str, (west, south, east, north))),
                    'attribution': 'SYNTHETIC TEST PIXELS' if args.fixture else ATTRIBUTION}
            conn.executemany('INSERT INTO metadata VALUES (?,?)', sorted(meta.items()))
            for z, x, y in tiles:
                data = raster(z, x, y, roads, args.fixture, statistics)
                if len(data) > 1024 * 1024:
                    raise ValueError('Tile exceeds 1 MiB Android limit')
                conn.execute('INSERT INTO tiles VALUES (?,?,?,?)', (z, x, (1 << z) - 1 - y, data))
        inspect(archive, len(tiles), args.minzoom, args.maxzoom)
        if not args.fixture and statistics['tiles_with_roads'] < max(1, len(tiles) // 20):
            raise ValueError('Too few actual source road geometries intersect the output tile region.')
        if archive.stat().st_size > 512 * 1024 * 1024:
            raise ValueError('Generated MBTiles exceeds the Android 512 MiB local import cap.')
    except Exception:
        archive.unlink(missing_ok=True)
        raise
    digest = sha256(archive)
    manifest = {
        'schemaVersion': 1, 'id': args.id,
        'name': 'SYNTHETIC pixel fixture - NOT GEOGRAPHIC' if args.fixture else 'Melbourne CBD - real OSM roads',
        'version': args.version,
        'bounds': dict(zip(('south','west','north','east'), bounds)),
        'format': 'mbtiles', 'minZoom': args.minzoom, 'maxZoom': args.maxzoom,
        'tileSize': 256, 'expectedBytes': archive.stat().st_size, 'sha256': digest,
        'source': {'kind':'remote','url':args.url} if args.url else
                  {'kind':'import','displayName':archive.name},
        'attribution': 'SYNTHETIC TEST PIXELS - NO GEOGRAPHY' if args.fixture else ATTRIBUTION}
    Path(f'{archive}.manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    Path(f'{archive}.sha256').write_text(f'{digest}  {archive.name}\n', encoding='ascii')
    provenance = {
        'schemaVersion': 1,
        'kind': 'synthetic-fixture' if args.fixture else 'osm-roads',
        'generatedAtUtc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'generatorSha256': sha256(Path(__file__)),
        'runtime': {'python': sys.version.split()[0], 'pillow': PIL.__version__,
                    'sqlite': sqlite3.sqlite_version},
        'source': source,
        'bounds': manifest['bounds'],
        'minZoom': args.minzoom,
        'maxZoom': args.maxzoom,
        'tileCount': len(tiles),
        'roadStrokes': statistics['road_strokes'],
        'tilesWithRoads': statistics['tiles_with_roads'],
        'archiveName': archive.name,
        'archiveBytes': archive.stat().st_size,
        'archiveSha256': digest,
        'licence': 'OSM ODbL 1.0' if not args.fixture else 'NOT REAL GEOGRAPHY',
    }
    Path(f'{archive}.provenance.json').write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Road strokes: {statistics["road_strokes"]}; road-bearing tiles: {statistics["tiles_with_roads"]}')
    print(f'Wrote {len(tiles)} raster tiles, {archive.stat().st_size} bytes, SHA256 {digest}')
    print(f'Review {archive}.manifest.json and {archive}.sha256 independently before import')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', help='Local, bbox-clipped OSM PBF')
    parser.add_argument('--source-sha256', help='Optional independently pinned OSM extract fingerprint')
    parser.add_argument('--source-url', help='Operator-declared HTTPS provenance URL for raw OSM source; never fetched by this script')
    parser.add_argument('--upstream-source-sha256', help='Recorded SHA-256 of upstream city/state PBF before clipping')
    parser.add_argument('--fixture', action='store_true', help='SYNTHETIC test only: NOT REAL ROADS')
    parser.add_argument('--output', required=True)
    parser.add_argument('--id', default='melbourne-cbd-osm-roads-v1')
    parser.add_argument('--version', default='local-osm-v1')
    parser.add_argument('--bounds', default=','.join(map(str, BBOX)))
    parser.add_argument('--minzoom', type=int, default=12)
    parser.add_argument('--maxzoom', type=int, default=15)
    parser.add_argument('--url', help='Existing, operator-controlled HTTPS artifact endpoint')
    arguments = parser.parse_args()
    if not arguments.fixture and not arguments.input:
        parser.error('Supply --input for REAL OSM, or --fixture for SYNTHETIC tiles')
    build(arguments)
