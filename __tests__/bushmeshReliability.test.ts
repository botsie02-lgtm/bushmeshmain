import {
  BushMeshControlledFloodForwarder,
  BushMeshMessageIdGenerator,
  BushMeshRecentMessageCache,
  BushMeshRetransmissionEngine,
  encodeFragmentAck,
  decodeFragmentAck,
} from '../src/bushmesh/protocol';

describe('Bushmesh reliability primitives', () => {
  test('generates monotonic non-zero uint32 message IDs across wraparound', () => {
    const generator = new BushMeshMessageIdGenerator(0xffffffff);

    expect(generator.next()).toBe(0xffffffff);
    expect(generator.next()).toBe(1);
    expect(generator.next()).toBe(2);
  });

  test('deduplicates source/message pairs and expires them after TTL', () => {
    const cache = new BushMeshRecentMessageCache(1000, 10);
    const identity = {sourceNodeId: 7, messageId: 99};

    expect(cache.checkAndRemember(identity, 1000)).toBe(false);
    expect(cache.checkAndRemember(identity, 1500)).toBe(true);
    expect(cache.hasSeen(identity, 2001)).toBe(false);
  });

  test('controlled flooding forwards a new broadcast once and decrements TTL', () => {
    const forwarder = new BushMeshControlledFloodForwarder(
      new BushMeshRecentMessageCache(),
      100,
      200,
    );

    const first = forwarder.evaluate(
      {
        sourceNodeId: 1,
        messageId: 123,
        localNodeId: 2,
        ttlHops: 3,
      },
      1000,
    );

    expect(first.forward).toBe(true);
    expect(first.deliverLocally).toBe(true);
    expect(first.nextTtlHops).toBe(2);
    expect(first.jitterMs).toBeGreaterThanOrEqual(100);
    expect(first.jitterMs).toBeLessThanOrEqual(200);

    const duplicate = forwarder.evaluate(
      {
        sourceNodeId: 1,
        messageId: 123,
        localNodeId: 2,
        ttlHops: 2,
      },
      1100,
    );

    expect(duplicate.forward).toBe(false);
    expect(duplicate.reason).toBe('duplicate');
  });

  test('directed forwarding stops when the destination is reached', () => {
    const forwarder = new BushMeshControlledFloodForwarder();
    const result = forwarder.evaluate({
      sourceNodeId: 1,
      messageId: 124,
      localNodeId: 4,
      destinationNodeId: 4,
      ttlHops: 5,
    });

    expect(result.forward).toBe(false);
    expect(result.deliverLocally).toBe(true);
    expect(result.reason).toBe('destination-reached');
  });

  test('selective ACKs suppress received fragments and retry only missing ones', () => {
    const engine = new BushMeshRetransmissionEngine();
    engine.registerMessage(
      82,
      [[0x10], [0x11], [0x12], [0x13]],
      {now: 1000, baseRetryDelayMs: 500, maxAttempts: 3},
    );

    for (let index = 0; index < 4; index += 1) {
      engine.markSent(82, index, 1000);
    }

    const ack = decodeFragmentAck(encodeFragmentAck(82, 4, [0, 2, 3]));
    expect(engine.applyAck(ack)).toEqual([0, 2, 3]);

    expect(engine.due(1499)).toEqual([]);
    expect(engine.due(1500).map(item => item.fragmentIndex)).toEqual([1]);

    engine.markSent(82, 1, 1500);
    expect(engine.due(2499)).toEqual([]);
    expect(engine.due(2500).map(item => item.fragmentIndex)).toEqual([1]);
  });

  test('removes a pending retransmission once every fragment is acknowledged', () => {
    const engine = new BushMeshRetransmissionEngine();
    engine.registerMessage(90, [[1], [2]], {now: 0});

    engine.applyAck(decodeFragmentAck(encodeFragmentAck(90, 2, [0, 1])));
    expect(engine.isComplete(90)).toBe(true);
    expect(engine.snapshot(90)).toBeNull();
  });
});
