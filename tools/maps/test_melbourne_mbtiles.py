"""Fixture checks for the REPOSITORY generator; no network or OSM input needed."""
from pathlib import Path
from tempfile import TemporaryDirectory
import io
import json
import sqlite3
import unittest

from PIL import Image
from build_melbourne_mbtiles import build, sha256, tile_list
from argparse import Namespace


class MelbourneMapFixtureTest(unittest.TestCase):
    def test_bounded_cbd_tile_coverage(self):
        tiles = tile_list((-37.84, 144.94, -37.78, 145.02), 12, 13)
        self.assertEqual(13, len(tiles))
        with self.assertRaises(ValueError):
            tile_list((-37.84, 144.94, -37.78, 145.02), 12, 17)

    def test_fixture_is_valid_raster_and_manifest_is_exact(self):
        with TemporaryDirectory() as temp:
            output = Path(temp) / 'synthetic.mbtiles'
            build(Namespace(
                output=str(output), fixture=True, input=None, source_sha256=None,
                id='test-synthetic-not-real', version='fixture-v1',
                bounds='-37.84,144.94,-37.78,145.02',
                minzoom=12, maxzoom=13, url=None,
            ))
            manifest = json.loads(Path(str(output) + '.manifest.json').read_text())
            self.assertEqual('import', manifest['source']['kind'])
            self.assertEqual('mbtiles', manifest['format'])
            self.assertIn('SYNTHETIC', manifest['attribution'])
            self.assertEqual(output.stat().st_size, manifest['expectedBytes'])
            self.assertEqual(sha256(output), manifest['sha256'])
            with sqlite3.connect(str(output)) as conn:
                tile = conn.execute('SELECT zoom_level,tile_row,tile_data FROM tiles LIMIT 1').fetchone()
                self.assertGreaterEqual(tile[1], 0)
                image = Image.open(io.BytesIO(tile[2]))
                self.assertEqual(image.size, (256, 256))
                self.assertEqual(image.format, 'PNG')
            with output.open('ab') as stream:
                stream.write(b'corruption')
            self.assertNotEqual(sha256(output), manifest['sha256'])


if __name__ == '__main__':
    unittest.main()
