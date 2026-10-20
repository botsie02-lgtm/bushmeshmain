import {
  OfflineMapPack,
  coordinateInBounds,
  getMapPackDownloadProgress,
  getTripMapCoverage,
  isOfflineMapPackReady,
  validateMapBounds,
} from '../src/maps/offlineMapPacks';

function readyPack(overrides?: Partial<OfflineMapPack>): OfflineMapPack {
  return {
    id: 'victoria-high-country',
    name: 'Victoria High Country',
    version: '2026.10',
    bounds: {
      south: -38.2,
      west: 145.0,
      north: -36.0,
      east: 148.0,
    },
    state: 'ready',
    downloadedBytes: 1_000,
    totalBytes: 1_000,
    checksumVerified: true,
    ...overrides,
  };
}

describe('offline map packs', () => {
  test('validates bounds and coordinates', () => {
    expect(
      validateMapBounds({south: -38, west: 145, north: -36, east: 148}),
    ).toBeNull();
    expect(
      validateMapBounds({south: -35, west: 145, north: -38, east: 148}),
    ).toContain('south');

    expect(
      coordinateInBounds(
        {latitude: -37.5, longitude: 146.2},
        readyPack().bounds,
      ),
    ).toBe(true);
    expect(
      coordinateInBounds(
        {latitude: -34.0, longitude: 146.2},
        readyPack().bounds,
      ),
    ).toBe(false);
  });

  test('supports packs that cross the antimeridian', () => {
    const bounds = {south: -20, west: 170, north: 20, east: -170};

    expect(coordinateInBounds({latitude: 0, longitude: 179}, bounds)).toBe(true);
    expect(coordinateInBounds({latitude: 0, longitude: -179}, bounds)).toBe(true);
    expect(coordinateInBounds({latitude: 0, longitude: 0}, bounds)).toBe(false);
  });

  test('requires ready state, complete bytes and checksum verification', () => {
    expect(isOfflineMapPackReady(readyPack())).toBe(true);
    expect(
      isOfflineMapPackReady(readyPack({checksumVerified: false})),
    ).toBe(false);
    expect(
      isOfflineMapPackReady(
        readyPack({state: 'downloading', downloadedBytes: 500}),
      ),
    ).toBe(false);
    expect(
      isOfflineMapPackReady(readyPack({downloadedBytes: 999})),
    ).toBe(false);
  });

  test('simulated metadata never satisfies real offline readiness', () => {
    const simulated = readyPack({simulated: true});

    expect(isOfflineMapPackReady(simulated)).toBe(false);
    expect(
      getTripMapCoverage([simulated], [
        {latitude: -37.56, longitude: 146.25},
      ]).complete,
    ).toBe(false);
  });

  test('trip coverage only counts verified ready packs', () => {
    const packs = [
      readyPack(),
      readyPack({
        id: 'incomplete-pack',
        bounds: {south: -40, west: 148, north: -35, east: 150},
        state: 'downloading',
        downloadedBytes: 500,
      }),
    ];

    const coverage = getTripMapCoverage(packs, [
      {latitude: -37.5, longitude: 146.2},
      {latitude: -37.2, longitude: 149.1},
    ]);

    expect(coverage.complete).toBe(false);
    expect(coverage.coveredPointCount).toBe(1);
    expect(coverage.missingPointIndexes).toEqual([1]);
    expect(coverage.readyPackIds).toEqual(['victoria-high-country']);
  });

  test('reports complete coverage when every route point is locally covered', () => {
    const coverage = getTripMapCoverage([readyPack()], [
      {latitude: -37.56, longitude: 146.25},
      {latitude: -37.1, longitude: 147.3},
    ]);

    expect(coverage.complete).toBe(true);
    expect(coverage.coveredPointCount).toBe(2);
    expect(coverage.missingPointIndexes).toEqual([]);
  });

  test('download progress is clamped and unknown totals remain unknown', () => {
    expect(getMapPackDownloadProgress(readyPack({downloadedBytes: 250}))).toBe(0.25);
    expect(getMapPackDownloadProgress(readyPack({downloadedBytes: 2_000}))).toBe(1);
    expect(getMapPackDownloadProgress(readyPack({totalBytes: null}))).toBeNull();
  });
});
