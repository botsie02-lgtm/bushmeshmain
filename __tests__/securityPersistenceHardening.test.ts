import {toBase64Url} from '../src/security/bytes';
import {NonceManager, ReplayProtector} from '../src/security/nonceReplay';
import {InMemorySecurityMetadataStore} from '../src/security/testing/InMemorySecurityStores';

describe('security metadata atomicity and recovery contract', () => {
  test('concurrent nonce reservation never returns a duplicate', async () => {
    const metadata = new InMemorySecurityMetadataStore();
    const manager = new NonceManager(metadata);
    const prefix = toBase64Url(new Uint8Array(4));
    const reservations = await Promise.all(
      Array.from({length: 128}, () => manager.next('scope/concurrent', prefix)),
    );
    const counters = reservations.map(result => result.counter.toString());
    expect(new Set(counters).size).toBe(128);
    expect(await metadata.getNonceHighWatermark('scope/concurrent')).toBe(128n);
  });

  test('stale persisted counter below protected high-watermark fails closed after restart', async () => {
    const metadata = new InMemorySecurityMetadataStore();
    const prefix = toBase64Url(new Uint8Array(4));
    const beforeCrash = new NonceManager(metadata);
    await beforeCrash.next('scope/restart', prefix);
    await beforeCrash.next('scope/restart', prefix);
    expect(await metadata.getNonceHighWatermark('scope/restart')).toBe(2n);

    metadata.unsafeSetNonceCounter('scope/restart', 1n);
    const recovered = new NonceManager(metadata);
    await expect(recovered.next('scope/restart', prefix)).rejects.toMatchObject({
      code: 'COUNTER_ROLLBACK',
    });
  });

  test('missing ordinary counter state below a surviving high-watermark fails closed', async () => {
    const metadata = new InMemorySecurityMetadataStore();
    const prefix = toBase64Url(new Uint8Array(4));
    await metadata.advanceNonceHighWatermark('scope/missing-counter', 9n);
    metadata.unsafeSetNonceCounter('scope/missing-counter', 0n);
    await expect(new NonceManager(metadata).next('scope/missing-counter', prefix)).rejects.toMatchObject({
      code: 'COUNTER_ROLLBACK',
    });
  });

  test('a failed high-watermark commit burns the reserved counter and recovery advances safely', async () => {
    const metadata = new InMemorySecurityMetadataStore();
    const prefix = toBase64Url(new Uint8Array(4));
    const originalAdvance = metadata.advanceNonceHighWatermark.bind(metadata);
    let failOnce = true;
    metadata.advanceNonceHighWatermark = async (scope, counter) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('simulated protected-store write failure');
      }
      await originalAdvance(scope, counter);
    };

    const manager = new NonceManager(metadata);
    await expect(manager.next('scope/high-watermark-write', prefix)).rejects.toThrow(
      'simulated protected-store write failure',
    );
    expect(await metadata.getNonceHighWatermark('scope/high-watermark-write')).toBe(0n);

    const recovered = new NonceManager(metadata);
    const next = await recovered.next('scope/high-watermark-write', prefix);
    expect(next.counter).toBe(2n);
    expect(await metadata.getNonceHighWatermark('scope/high-watermark-write')).toBe(2n);
  });

  test('a duplicate reservation result is rejected even if a broken store returns it', async () => {
    const metadata = new InMemorySecurityMetadataStore();
    const prefix = toBase64Url(new Uint8Array(4));
    await metadata.advanceNonceHighWatermark('scope/duplicate', 7n);
    metadata.unsafeSetNonceCounter('scope/duplicate', 7n);
    const original = metadata.reserveNonceCounter.bind(metadata);
    metadata.reserveNonceCounter = async () => 7n;
    const manager = new NonceManager(metadata);
    await expect(manager.next('scope/duplicate', prefix)).rejects.toMatchObject({
      code: 'COUNTER_ROLLBACK',
    });
    metadata.reserveNonceCounter = original;
  });

  test('replay window persists across protector recreation and rejects stale state', async () => {
    const metadata = new InMemorySecurityMetadataStore();
    const first = new ReplayProtector(metadata, 8);
    await first.assertFresh('scope/replay', 10n);
    await first.assertFresh('scope/replay', 12n);

    const recovered = new ReplayProtector(metadata, 8);
    await expect(recovered.assertFresh('scope/replay', 10n)).rejects.toMatchObject({
      code: 'REPLAY_DETECTED',
    });
    await expect(recovered.assertFresh('scope/replay', 3n)).rejects.toMatchObject({
      code: 'REPLAY_DETECTED',
    });
    await expect(recovered.assertFresh('scope/replay', 11n)).resolves.toBeUndefined();
  });

  test('replay acceptance is atomically unique under concurrency', async () => {
    const metadata = new InMemorySecurityMetadataStore();
    const results = await Promise.all(
      Array.from({length: 20}, () => metadata.acceptReplayCounter('scope/atomic-replay', 44n, 128)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
