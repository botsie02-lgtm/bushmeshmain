import {revalidateRestoredMapCatalog} from '../src/maps/mapPackRecovery';
import {BushMeshMapPackCatalogEntry} from '../src/maps/mapPackCatalog';

const sha = 'f'.repeat(64);
function ready(): BushMeshMapPackCatalogEntry {
  return {
    manifest: {
      schemaVersion: 1,
      id: 'regional-pack',
      name: 'Region',
      version: 'v1',
      bounds: {south: -38, west: 145, north: -37, east: 147},
      format: 'pmtiles',
      minZoom: 4,
      maxZoom: 14,
      tileSize: 256,
      expectedBytes: 100,
      sha256: sha,
      source: {kind: 'remote', url: 'https://example.test/region.pmtiles'},
    },
    artifact: {
      packId: 'regional-pack',
      manifestVersion: 'v1',
      format: 'pmtiles',
      localUri: 'file:///data/region.pmtiles',
      bytes: 100,
      sha256: sha,
      verifiedAtMs: 100,
    },
    installState: 'ready',
    lastError: null,
  };
}

describe('offline map restoration integrity', () => {
  test('checks a ready local artifact before restoring it', async () => {
    const old = ready();
    const verify = jest.fn(async () => ({...old.artifact!, verifiedAtMs: 120}));
    const restored = await revalidateRestoredMapCatalog([old], verify);
    expect(verify).toHaveBeenCalledWith(old.manifest);
    expect(restored[0].installState).toBe('ready');
    expect(restored[0].artifact?.verifiedAtMs).toBe(120);
    expect(old.artifact?.verifiedAtMs).toBe(100);
  });

  test('missing files are not marked offline ready on app restart', async () => {
    const restored = await revalidateRestoredMapCatalog([ready()], async () => null);
    expect(restored[0].installState).toBe('not-installed');
    expect(restored[0].artifact).toBeNull();
  });

  test('verification failures do not leave stale ready artifacts', async () => {
    const restored = await revalidateRestoredMapCatalog([ready()], async () => {
      throw new Error('Disk read failed');
    });
    expect(restored[0].installState).toBe('invalid');
    expect(restored[0].artifact).toBeNull();
    expect(restored[0].lastError).toContain('Disk read failed');
  });

  test('does not attempt native verification for metadata-only packs', async () => {
    const entry: BushMeshMapPackCatalogEntry = {...ready(), artifact: null, installState: 'not-installed'};
    const verify = jest.fn();
    const restored = await revalidateRestoredMapCatalog([entry], verify);
    expect(verify).not.toHaveBeenCalled();
    expect(restored[0].installState).toBe('not-installed');
  });
});
