import {
  BushMeshBloomFilter,
  BushMeshDeliveryQueue,
  BushMeshPriority,
  createSyncSummary,
  idsProbablyMissingFromRemote,
  newestContiguousMessageId,
} from '../src/bushmesh/protocol';

describe('Bushmesh store-and-forward queue and sync summaries', () => {
  test('prioritises emergency traffic while keeping FIFO order within a priority', () => {
    const queue = new BushMeshDeliveryQueue();

    queue.enqueue(10, [0x10], {
      priority: BushMeshPriority.DirectMessage,
      now: 1000,
    });
    queue.enqueue(11, [0x11], {
      priority: BushMeshPriority.Emergency,
      now: 1100,
    });
    queue.enqueue(12, [0x12], {
      priority: BushMeshPriority.DirectMessage,
      now: 1200,
    });

    expect(queue.ready(1200).map(item => item.messageId)).toEqual([
      11,
      10,
      12,
    ]);
  });

  test('deduplicates queued messages, backs off retries, and removes ACKed messages', () => {
    const queue = new BushMeshDeliveryQueue();

    queue.enqueue(20, [0x20], {now: 1000, maxAttempts: 3});
    queue.enqueue(20, [0xff], {now: 1100, maxAttempts: 3});

    expect(queue.size()).toBe(1);
    expect(queue.snapshot()[0].wireBytes).toEqual([0x20]);

    queue.markAttempt(20, {now: 1000, retryDelayMs: 5000});
    expect(queue.next(2000)).toBeNull();
    expect(queue.next(6000)?.messageId).toBe(20);

    expect(queue.acknowledge(20)).toBe(true);
    expect(queue.size()).toBe(0);
  });

  test('expires stale store-and-forward messages and stops exhausted retries', () => {
    const queue = new BushMeshDeliveryQueue();

    queue.enqueue(30, [0x30], {now: 1000, ttlMs: 1000});
    queue.enqueue(31, [0x31], {now: 1000, maxAttempts: 1});
    queue.markAttempt(31, {now: 1000, retryDelayMs: 0});

    expect(queue.pruneExpired(2000).sort((a, b) => a - b)).toEqual([30, 31]);
    expect(queue.size()).toBe(0);
  });

  test('Bloom filter round-trips a compact set summary', () => {
    const filter = new BushMeshBloomFilter(16, 3);
    filter.addMany([144, 145, 147, 151, 155]);

    const restored = BushMeshBloomFilter.fromBytes(filter.toBytes(), 3);

    expect(restored.mightContain(144)).toBe(true);
    expect(restored.mightContain(151)).toBe(true);
    expect(restored.toBytes()).toHaveLength(16);
  });

  test('sync summary combines contiguous watermark with probabilistic Bloom membership', () => {
    expect(newestContiguousMessageId([574, 575, 576, 578])).toBe(576);

    const remoteSummary = createSyncSummary([575, 576, 577, 579], {
      bloomByteLength: 32,
      bloomHashCount: 3,
    });

    const missing = idsProbablyMissingFromRemote(
      [575, 576, 577, 578, 579, 580],
      remoteSummary,
    );

    // Bloom filters may hide a missing ID through a false positive, but IDs
    // definitely present remotely must never be reported as missing.
    expect(missing).toContain(580);
    expect(missing).not.toContain(575);
    expect(missing).not.toContain(576);
    expect(missing).not.toContain(577);
    expect(missing).not.toContain(579);
  });
});
