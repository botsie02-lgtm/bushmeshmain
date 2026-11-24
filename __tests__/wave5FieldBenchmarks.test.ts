import {mkdirSync, writeFileSync} from 'fs';
import {performance} from 'perf_hooks';
import {ConvoyMobilityHarness} from '../src/bushmesh/testing/networkSimulator/ConvoyMobilityHarness';
import {
  buildConvoyMapScene,
  planConvoyMapTiles,
  type ConvoyMapMember,
} from '../src/maps/convoyMapModel';
import type {BushMeshMapPackCatalogEntry} from '../src/maps/mapPackCatalog';
import {InMemoryBushMeshOutbox} from '../src/bushmesh/outbox';

const NOW_MS = 1_800_000_000_000;
const SEED = 0x51b300;
const pack: BushMeshMapPackCatalogEntry = {
  manifest: {
    schemaVersion: 1, id: 'synthetic-benchmark-melbourne',
    name: 'Synthetic-only benchmark fixture', version: 'v1',
    bounds: {south: -38.0, west: 144.7, north: -37.6, east: 145.3},
    format: 'mbtiles', minZoom: 3, maxZoom: 16, tileSize: 256,
    expectedBytes: 42, sha256: 'a'.repeat(64),
    source: {kind: 'import', displayName: 'NOT_A_REAL_MBtiles_FILE'},
  },
  artifact: {
    packId: 'synthetic-benchmark-melbourne', manifestVersion: 'v1',
    format: 'mbtiles', localUri: 'file:///benchmark-only/fake.mbtiles',
    bytes: 42, sha256: 'a'.repeat(64), verifiedAtMs: NOW_MS,
  },
  installState: 'ready',
  lastError: null,
};

type BenchmarkSample = {
  case: string;
  seed: number;
  iterations: number;
  elapsedMs: number;
  perOperationMs: number;
  heapDeltaBytes: number;
  rssDeltaBytes: number;
  resultCount: number;
  category: 'node-jest-synthetic-only';
};
const recorded: BenchmarkSample[] = [];

async function sample(
  name: string,
  iterations: number,
  run: () => Promise<number> | number,
): Promise<BenchmarkSample> {
  // Warmup is independent of the numbered measurements.
  await run();
  const before = process.memoryUsage();
  const start = performance.now();
  let resultCount = 0;
  for (let i = 0; i < iterations; i++) resultCount = await run();
  const elapsedMs = performance.now() - start;
  const after = process.memoryUsage();
  const item: BenchmarkSample = {
    case: name,
    seed: SEED,
    iterations,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    perOperationMs: Number((elapsedMs / iterations).toFixed(6)),
    heapDeltaBytes: after.heapUsed - before.heapUsed,
    rssDeltaBytes: after.rss - before.rss,
    resultCount,
    category: 'node-jest-synthetic-only',
  };
  recorded.push(item);
  // CI logs are a durable easy-to-compare human-readable benchmark result.
  console.log('WAVE5_BENCHMARK_RESULT ' + JSON.stringify(item));
  return item;
}

describe('Wave 5 repeatable Node/Jest microbenchmarks (not hardware or native tiles)', () => {
  jest.setTimeout(120_000);

  afterAll(() => {
    const dir = 'artifacts/wave5-field-reliability';
    mkdirSync(dir, {recursive: true});
    writeFileSync(dir + '/node-benchmarks.json', JSON.stringify({
      schema: 'bushmesh-wave5-node-measurements-v1',
      referenceSeed: SEED,
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      evidence: 'Jest/Node CPU and process memory measurements only',
      limitations: [
        'Host-dependent elapsed time and heap delta are not deterministic',
        'Startup is a virtual runtime startup, not Android or BLE initialization',
        'Tile access benchmark calls the pure tile planner, NOT SQLite/native tile IO or raster decoding',
        'Synthetic manifest is not a real installed map',
        'No device power, LoRa airtime, actual physical GPS or Keystore measured',
      ],
      samples: recorded,
    }, null, 2) + '\n');
  });

  it('measures cold synthetic 10-node startup + link graph creation', async () => {
    const m = await sample('virtual-10-node-startup', 4, async () => {
      const fleet = new ConvoyMobilityHarness(SEED, {radioRangeMetres: 300});
      await fleet.addFleet(10, 18);
      expect(fleet.ids()).toHaveLength(10);
      return fleet.network.trace.filter(event => event.kind === 'node-added').length;
    });
    expect(m.resultCount).toBe(10);
    expect(m.elapsedMs).toBeGreaterThan(0);
  });

  it('measures 250-member authorized convoy map scene projection and memory delta', async () => {
    const members: ConvoyMapMember[] = Array.from({length: 250}, (_, i) => ({
      id: 'member-' + i,
      label: 'Vehicle ' + i,
      position: i % 9 === 0 ? null : {
        latitude: -37.8 + i * 0.00001, longitude: 144.95 + i * 0.00001,
        receivedAtMs: NOW_MS - (i % 4) * 75_000,
        headingDegrees: 45,
      },
    }));
    const m = await sample('authorized-250-member-map-projection', 350, () => {
      const scene = buildConvoyMapScene({
        latitude: -37.8, longitude: 144.95,
        receivedAtMs: NOW_MS, headingDegrees: 0,
      }, members, NOW_MS);
      expect(scene.memberCount).toBe(250);
      expect(scene.points.length + scene.missingMembers.length).toBe(251);
      return scene.points.length;
    });
    expect(m.resultCount).toBeGreaterThan(210);
  });

  it('measures bounded, purely in-memory map tile planning (not native tile read)', async () => {
    const m = await sample('offline-tile-plan-viewport-360x640', 1400, () => {
      const tiles = planConvoyMapTiles(pack, {
        latitude: -37.81, longitude: 144.96,
      }, 13, {width: 360, height: 640});
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.length).toBeLessThanOrEqual(100);
      return tiles.length;
    });
    expect(m.resultCount).toBeGreaterThan(0);
  });

  it('measures bounded in-memory outbox enqueue, suppression and cancellation pressure', async () => {
    const m = await sample('outbox-500-entries-cancel', 8, () => {
      const outbox = new InMemoryBushMeshOutbox();
      for (let i = 0; i < 500; i++) {
        outbox.enqueue({
          channelIndex: 4, dataType: 0xff00,
          priority: i % 50 === 0 ? 'safety' : 'position',
          payload: Uint8Array.from([i & 0xff, (i >>> 8) & 0xff]),
          identityRef: 'field-test-only', description: 'synthetic message',
          createdAtMs: NOW_MS + i,
        });
      }
      const cancelled = outbox.cancelQueuedPositions('field-test-only', 4);
      expect(cancelled).toHaveLength(490);
      const surviving = outbox.list().filter(e => e.state === 'queued');
      expect(surviving).toHaveLength(10);
      return cancelled.length;
    });
    expect(m.resultCount).toBe(490);
  });
});
