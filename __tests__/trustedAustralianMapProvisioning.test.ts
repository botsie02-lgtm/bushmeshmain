import {
  decodeOperatorReviewedMapManifest,
} from '../src/maps/trustedMapPackProvisioning';
import {BushMeshMapPackManifestV1} from '../src/maps/mapPackManifest';

const hash = '7e'.repeat(32);
const manifest: BushMeshMapPackManifestV1 = {
  schemaVersion: 1,
  id: 'melbourne-osm-roads-test',
  name: 'Melbourne OSM roads',
  version: 'reviewed-2026',
  bounds: {south: -37.84, west: 144.94, north: -37.78, east: 145.02},
  format: 'mbtiles',
  minZoom: 12,
  maxZoom: 15,
  tileSize: 256,
  expectedBytes: 100_000,
  sha256: hash,
  source: {kind: 'import', displayName: 'melbourne.mbtiles'},
  attribution: '© OpenStreetMap contributors · ODbL 1.0',
};

describe('operator-reviewed Australian offline map manifests', () => {
  test('accepts an independent exact SHA-256 review for local raster imports', () => {
    expect(decodeOperatorReviewedMapManifest(JSON.stringify(manifest), hash.toUpperCase(), true))
      .toEqual(manifest);
  });

  test('rejects a mismatched fingerprint', () => {
    expect(() => decodeOperatorReviewedMapManifest(
      JSON.stringify(manifest), '1'.repeat(64), true,
    )).toThrow(/fingerprint/i);
  });

  test('requires an explicit acknowledgement even with the correct digest', () => {
    expect(() => decodeOperatorReviewedMapManifest(
      JSON.stringify(manifest), hash, false,
    )).toThrow(/confirm/i);
  });

  test('requires attribution and rejects oversize local archives', () => {
    expect(() => decodeOperatorReviewedMapManifest(
      JSON.stringify({...manifest, attribution: ''}), hash, true,
    )).toThrow(/attribution/i);
    expect(() => decodeOperatorReviewedMapManifest(
      JSON.stringify({...manifest, expectedBytes: 513 * 1024 * 1024}), hash, true,
    )).toThrow(/512 MiB/i);
  });

  test('never turns a hash-only manifest into an installed artifact', () => {
    const reviewed = decodeOperatorReviewedMapManifest(
      JSON.stringify(manifest), hash, true,
    );
    expect('artifact' in reviewed).toBe(false);
    expect('installState' in reviewed).toBe(false);
  });

  test('rejects malformed unsupported packs', () => {
    expect(() => decodeOperatorReviewedMapManifest(
      JSON.stringify({...manifest, format: 'pbf'}), hash, true,
    )).toThrow(/format/i);
    expect(() => decodeOperatorReviewedMapManifest('A'.repeat(12_001), hash, true))
      .toThrow(/12,000/i);
  });
});
