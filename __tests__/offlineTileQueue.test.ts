import {
  BoundedOfflineTileQueue, OFFLINE_TILE_MAX_ACTIVE, OFFLINE_TILE_MAX_CACHED,
  tileRequestsNearestCentre,
} from '../src/maps/offlineTileQueue';

const tile = (n: number) => ({
  key: 'pack/' + n, z: 13, x: n, y: 0, left: n * 256, top: 0,
});
async function flush() {
  await Promise.resolve(); await Promise.resolve();
  await Promise.resolve(); await Promise.resolve();
}

describe('bounded offline raster tile queue', () => {
  it('requests nearer visible tiles first', () => {
    const ranked = tileRequestsNearestCentre([tile(0), tile(2), tile(1)], 900, 256);
    expect(ranked.map(t => t.x)).toEqual([1, 2, 0]);
  });

  it('limits native reads and cached base64 references', async () => {
    const pending: Array<(v: string | null) => void> = [];
    let outstanding = 0; let peak = 0;
    const queue = new BoundedOfflineTileQueue(
      () => new Promise<string | null>(resolve => {
        outstanding++; peak = Math.max(peak, outstanding);
        pending.push(value => { outstanding--; resolve(value); });
      }),
      () => undefined,
      uri => uri.startsWith('data:image/png;base64,'),
    );
    queue.update('archive-a', Array.from({length: 50}, (_, n) => tile(n)));
    await flush();
    expect(peak).toBe(OFFLINE_TILE_MAX_ACTIVE);
    expect(OFFLINE_TILE_MAX_CACHED).toBeLessThan(50);
    for (let i = 0; i < OFFLINE_TILE_MAX_CACHED; i++) {
      pending[i]('data:image/png;base64,AAAA');
      await flush();
    }
    expect(peak).toBe(OFFLINE_TILE_MAX_ACTIVE);
    queue.dispose();
  });

  it('drops stale archive results and rejects HTTPS images', async () => {
    const pending: Array<{key: string; resolve: (value: string | null) => void}> = [];
    const snapshots: Array<Record<string,string>> = [];
    const queue = new BoundedOfflineTileQueue(
      request => new Promise<string | null>(resolve => {
        pending.push({key: request.key, resolve});
      }),
      snapshot => snapshots.push(snapshot.uris),
      uri => /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(uri),
    );
    queue.update('archive-v1', [tile(1)]);
    await flush();
    queue.update('archive-v2', [tile(1)]);
    pending[0].resolve('data:image/png;base64,AAAA');
    await flush();
    expect(snapshots[snapshots.length - 1]).toEqual({});
    const latest = pending[pending.length - 1];
    latest.resolve('https://tiles.example/13/1/0.png');
    await flush();
    expect(snapshots[snapshots.length - 1]).toEqual({});
    queue.dispose();
  });

  it('releases cached results when panning away', async () => {
    const snapshots: Array<{uris: Record<string,string>; missingKeys:string[]}> = [];
    const queue = new BoundedOfflineTileQueue(
      async () => 'data:image/png;base64,AAAA',
      snapshot => snapshots.push(snapshot),
      uri => uri.startsWith('data:image/png;base64,'),
    );
    queue.update('same-pack', [tile(1)]);
    await flush();
    expect(snapshots[snapshots.length-1].uris).toHaveProperty('pack/1');
    queue.update('same-pack', [tile(2)]);
    await flush();
    expect(snapshots[snapshots.length-1].uris).not.toHaveProperty('pack/1');
    queue.dispose();
  });
});

it('retries missing raster tiles only on explicit operator request', async () => {
  let reads = 0;
  const views: Array<{uris: Record<string,string>; missingKeys: string[]}> = [];
  const queue = new BoundedOfflineTileQueue(
    async () => { reads++; return reads === 1 ? null : 'data:image/png;base64,AAAA'; },
    view => views.push(view),
    uri => uri.startsWith('data:image/png;base64,'),
  );
  queue.update('stable-pack', [tile(1)]);
  await flush();
  expect(reads).toBe(1);
  expect(views[views.length - 1].missingKeys).toEqual(['pack/1']);
  queue.update('stable-pack', [tile(1)]);
  await flush();
  expect(reads).toBe(1);
  queue.retryVisible();
  await flush();
  expect(reads).toBe(2);
  expect(views[views.length - 1].uris).toHaveProperty('pack/1');
  queue.dispose();
});

it('rejects unbounded data URI allocations even from injected local readers', async () => {
  const images: Array<Record<string,string>> = [];
  const queue = new BoundedOfflineTileQueue(
    async () => 'data:image/png;base64,' + 'A'.repeat(1_500_000),
    result => images.push(result.uris),
    () => true,
  );
  queue.update('verified-local', [tile(2)]);
  await flush();
  expect(images[images.length - 1]).toEqual({});
  queue.dispose();
});
