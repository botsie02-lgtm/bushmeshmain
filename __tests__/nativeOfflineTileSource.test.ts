jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
  NativeModules: {
    BushMeshOfflineTiles: {readTileBase64: jest.fn()},
  },
}));

import {NativeModules} from 'react-native';
import {nativeOfflineTileSource} from '../src/maps/nativeOfflineTileSource';
import {BushMeshMapPackCatalogEntry} from '../src/maps/mapPackCatalog';

const readTileBase64 = NativeModules.BushMeshOfflineTiles.readTileBase64 as jest.Mock;

const pack: BushMeshMapPackCatalogEntry = {
  manifest: {
    schemaVersion: 1,
    id: 'local-region',
    name: 'Local region',
    version: 'v2',
    bounds: {south: -39, west: 145, north: -36, east: 149},
    format: 'mbtiles',
    minZoom: 2,
    maxZoom: 14,
    tileSize: 256,
    expectedBytes: 128,
    sha256: 'a'.repeat(64),
    source: {kind: 'remote', url: 'https://example.test/raster.mbtiles'},
  },
  artifact: {
    packId: 'local-region',
    manifestVersion: 'v2',
    format: 'mbtiles',
    localUri: 'file:///app/private/archive.mbtiles',
    bytes: 128,
    sha256: 'a'.repeat(64),
    verifiedAtMs: 100,
  },
  installState: 'ready',
  lastError: null,
};

describe('Android offline tile-source adapter', () => {
  beforeEach(() => readTileBase64.mockReset());

  test('calls only the native identity/coordinate contract, not a filesystem path', async () => {
    expect(nativeOfflineTileSource.isAvailable()).toBe(true);
    readTileBase64.mockResolvedValue({mimeType: 'image/png', base64: 'AAAA'});
    const result = await nativeOfflineTileSource.readTile({pack, z: 10, x: 721, y: 405});
    expect(result).toBe('data:image/png;base64,AAAA');
    expect(readTileBase64).toHaveBeenCalledWith('local-region', 'v2', 'mbtiles', 10, 721, 405);
    expect(readTileBase64.mock.calls[0]).toHaveLength(6);
  });

  test('missing artifact cannot reach the native reader', async () => {
    expect(await nativeOfflineTileSource.readTile({
      pack: {...pack, artifact: null}, z: 2, x: 0, y: 0,
    })).toBeNull();
    expect(readTileBase64).not.toHaveBeenCalled();
  });

  test('unsupported, malformed and excessively large tile payloads are rejected', async () => {
    for (const response of [
      null,
      {mimeType: 'application/x-protobuf', base64: 'AAAA'},
      {mimeType: 'image/jpeg', base64: 'not valid base64!'},
      {mimeType: 'image/png', base64: 'A'.repeat(1_400_001)},
    ]) {
      readTileBase64.mockResolvedValue(response);
      expect(await nativeOfflineTileSource.readTile({pack, z: 2, x: 0, y: 0})).toBeNull();
    }
  });
});
