"""Offline-only tests: every tile, digest, TMS and synthetic/real separation."""
from argparse import Namespace
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest

from build_melbourne_mbtiles import build
from validate_melbourne_mbtiles import inspect


class BushMeshArchiveVerificationTest(unittest.TestCase):
    def setUp(self):
        self.workspace = TemporaryDirectory()
        self.path = Path(self.workspace.name) / 'fixture.mbtiles'
        build(Namespace(
            output=str(self.path), fixture=True, input=None,
            source_sha256=None, source_url=None, upstream_source_sha256=None,
            id='small-test-fixture', version='fixture-1',
            bounds='-37.84,144.94,-37.78,145.02', minzoom=12, maxzoom=13,
            url=None,
        ))

    def tearDown(self):
        self.workspace.cleanup()

    def test_all_synthetic_raster_tiles_validate_without_geographic_claim(self):
        result = inspect(self.path)
        self.assertEqual(result['kind'], 'synthetic-fixture')
        self.assertEqual(result['tileCount'], 13)
        self.assertEqual(result['roadColourTiles'], 0)

    def test_require_real_rejects_synthetic_map(self):
        with self.assertRaisesRegex(ValueError, 'SYNTHETIC'):
            inspect(self.path, require_real=True)

    def test_manifest_checksum_cannot_be_fabricated(self):
        manifest_path = Path(str(self.path) + '.manifest.json')
        manifest = json.loads(manifest_path.read_text())
        manifest['sha256'] = 'a' * 64
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'Manifest/checksum'):
            inspect(self.path)

    def test_reject_corrupt_tile_even_if_sqlite_archive_still_opens(self):
        with sqlite3.connect(self.path) as connection:
            connection.execute('UPDATE tiles SET tile_data = ? WHERE rowid = 1',
                               (b'not a png',))
        with self.assertRaisesRegex(ValueError, 'Manifest/checksum'):
            inspect(self.path)

    def test_reject_forged_geographic_provenance(self):
        provenance_path = Path(str(self.path) + '.provenance.json')
        provenance = json.loads(provenance_path.read_text())
        provenance['kind'] = 'osm-roads'
        provenance_path.write_text(json.dumps(provenance))
        with self.assertRaisesRegex(ValueError, 'missing source PBF'):
            inspect(self.path, require_real=True)


if __name__ == '__main__':
    unittest.main()
