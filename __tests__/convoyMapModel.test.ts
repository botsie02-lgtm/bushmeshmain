import {
  buildConvoyMapScene,
  coordinateFromScreenOffset,
  fitConvoyZoom,
  isOfflineTileUri,
  planConvoyMapTiles,
  resolveConvoyMapCamera,
  screenPixel,
  selectRenderableMapPack,
} from '../src/maps/convoyMapModel';
import {BushMeshMapPackCatalogEntry} from '../src/maps/mapPackCatalog';

const now = 1_800_000_000_000;
const self = {
  latitude: -37.5,
  longitude: 146.1,
  headingDegrees: 85,
  receivedAtMs: now - 2_000,
};

function pack(): BushMeshMapPackCatalogEntry {
  return {
    manifest: {
      schemaVersion: 1,
      id: 'high-country',
      name: 'High Country',
      version: 'v1',
      bounds: {south: -40, west: 145, north: -35, east: 149},
      format: 'mbtiles',
      minZoom: 3,
      maxZoom: 16,
      tileSize: 256,
      expectedBytes: 42,
      sha256: 'a'.repeat(64),
      source: {kind: 'remote', url: 'https://maps.example.test/map.mbtiles'},
    },
    artifact: {
      packId: 'high-country',
      manifestVersion: 'v1',
      format: 'mbtiles',
      localUri: 'file:///data/user/0/bushmesh/pack.mbtiles',
      bytes: 42,
      sha256: 'a'.repeat(64),
      verifiedAtMs: now,
    },
    installState: 'ready',
    lastError: null,
  };
}

describe('authorised offline convoy map scene', () => {
  it('only plots explicitly passed members, not arbitrary discovered vehicles', () => {
    const scene = buildConvoyMapScene(self, [
      {id: 'allowed', label: 'Lead', position: {...self, longitude: 146.2}},
      {id: 'missing', label: 'Tail', position: null},
      {id: 'allowed', label: 'Duplicate', position: {...self}},
    ], now);
    expect(scene.points.map(point => point.id)).toEqual(['self', 'allowed']);
    expect(scene.missingMembers).toEqual([{id: 'missing', label: 'Tail'}]);
    expect(scene.memberCount).toBe(2);
  });

  it('retains stale/lost positions as last-known, but does not plot absent fixes', () => {
    const scene = buildConvoyMapScene(null, [
      {id: 'recent', label: 'R', position: {...self, receivedAtMs: now - 50_000}},
      {id: 'stale', label: 'S', position: {...self, receivedAtMs: now - 180_000}},
      {id: 'lost', label: 'L', position: {...self, receivedAtMs: now - 900_000}},
      {id: 'invalid', label: 'I', position: {...self, latitude: 120}},
    ], now);
    expect(scene.points.map(point => [point.freshness, point.lastKnown])).toEqual([
      ['recent', false], ['stale', true], ['lost', true],
    ]);
    expect(scene.missingMembers).toEqual([{id: 'invalid', label: 'I'}]);
  });

  it('keeps a last-known self fix but prevents stale heading-up camera rotation', () => {
    const scene = buildConvoyMapScene({...self, receivedAtMs: now - 700_000}, [], now);
    expect(scene.self?.lastKnown).toBe(true);
    expect(resolveConvoyMapCamera(scene, 'follow-self', 'heading-up', null)).toEqual({
      mode: 'follow-self',
      center: {latitude: self.latitude, longitude: self.longitude},
      rotationDegrees: 0,
    });
  });

  it('handles missing GPS and preserves the last camera center', () => {
    const scene = buildConvoyMapScene(null, [], now);
    expect(resolveConvoyMapCamera(scene, 'follow-self', 'north-up', {latitude: -36, longitude: 147}).center)
      .toEqual({latitude: -36, longitude: 147});
    expect(resolveConvoyMapCamera(scene, 'follow-self', 'north-up', null).center).toBeNull();
  });

  it('rotates only with a fresh self heading', () => {
    const scene = buildConvoyMapScene(self, [], now);
    expect(resolveConvoyMapCamera(scene, 'follow-self', 'heading-up', null).rotationDegrees).toBe(-85);
    expect(resolveConvoyMapCamera(scene, 'follow-self', 'north-up', null).rotationDegrees).toBe(0);
  });
});

describe('verified offline tile planning', () => {
  it('refuses metadata-only, mismatched, and simulated map states', () => {
    const ready = pack();
    expect(selectRenderableMapPack([ready], null)?.manifest.id).toBe('high-country');
    expect(selectRenderableMapPack([{...ready, artifact: null}], null)).toBeNull();
    expect(selectRenderableMapPack([{...ready, artifact: {...ready.artifact!, sha256: 'b'.repeat(64)}}], null)).toBeNull();
    expect(selectRenderableMapPack([ready], 'other')).toBeNull();
  });

  it('plans bounded in-range tiles with stable offline keys', () => {
    const tiles = planConvoyMapTiles(pack(), self, 12, {width: 320, height: 300});
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(100);
    expect(tiles.every(tile => tile.z === 12 && tile.x >= 0 && tile.y >= 0)).toBe(true);
    expect(tiles[0].key).toContain('high-country@v1/12/');
    expect(planConvoyMapTiles({...pack(), installState: 'invalid'}, self, 12, {width: 320, height: 300})).toEqual([]);
  });

  it('wraps tiles and markers across the antimeridian', () => {
    const center = {latitude: 0, longitude: 179.9};
    const right = screenPixel({latitude: 0, longitude: -179.9}, center, 5, {width: 300, height: 300});
    expect(right.left).toBeGreaterThan(150);
    expect(right.left).toBeLessThan(200);
    const tiles = planConvoyMapTiles(pack(), center, 5, {width: 300, height: 300});
    expect(tiles.some(tile => tile.x === 0)).toBe(true);
  });

  it('fits a convoy, pans using geographic coordinates and rejects huge viewports', () => {
    const viewport = {width: 400, height: 400};
    const points = [self, {...self, latitude: -37.6, longitude: 146.2}];
    const zoom = fitConvoyZoom(points, self, viewport, 3, 16);
    expect(zoom).toBeGreaterThanOrEqual(3);
    expect(zoom).toBeLessThan(16);
    const panned = coordinateFromScreenOffset(self, 12, 100, 0);
    expect(panned.longitude).toBeGreaterThan(self.longitude);
    expect(planConvoyMapTiles(pack(), self, 12, {width: 9999, height: 9999})).toEqual([]);
  });

  it('never allows online tile URLs', () => {
    expect(isOfflineTileUri('https://maps.example.test/1/2/3.png')).toBe(false);
    expect(isOfflineTileUri('http://example.test/a')).toBe(false);
    expect(isOfflineTileUri('file:///data/user/0/tiles/1.png')).toBe(true);
    expect(isOfflineTileUri('data:image/png;base64,AAAA')).toBe(true);
    expect(isOfflineTileUri('javascript:alert(1)')).toBe(false);
  });
});
