import {
  BushMeshAirtimeBudget,
  BushMeshCapability,
  BushMeshCompressionProfile,
  BushMeshControlCommand,
  BushMeshDictionaryLearner,
  BushMeshDiscoverySession,
  BushMeshNodeRole,
  BushMeshPersistentDeliveryRuntime,
  BushMeshPriority,
  BushMeshSyncFrameKind,
  BushMeshSyncNamespace,
  BushMeshTrafficClass,
  BushMeshTransmissionScheduler,
  LocationPrecision,
  createInventorySummary,
  decodeBushMeshSyncFrame,
  decodeBushMeshTypedPacket,
  encodeBushMeshControlWire,
  encodeInventorySummary,
  encodeTextForBushMeshPeer,
  inspectBushMeshPacket,
  missingIdsToRanges,
  negotiateBushMeshPeerPolicy,
} from '../src/bushmesh/protocol';

describe('Bushmesh runtime, negotiation and control infrastructure', () => {
  test('scheduler prioritizes emergency, direct, ACK/retry, then background traffic', () => {
    const scheduler = new BushMeshTransmissionScheduler();
    scheduler.enqueue('file', [1], BushMeshTrafficClass.File, {now: 100});
    scheduler.enqueue('telemetry', [2], BushMeshTrafficClass.Telemetry, {now: 100});
    scheduler.enqueue('ack', [3], BushMeshTrafficClass.Acknowledgement, {now: 100});
    scheduler.enqueue('direct', [4], BushMeshTrafficClass.Direct, {now: 100});
    scheduler.enqueue('emergency', [5], BushMeshTrafficClass.Emergency, {now: 100});

    expect(scheduler.ready(100).map(item => item.id)).toEqual([
      'emergency',
      'direct',
      'ack',
      'telemetry',
      'file',
    ]);
  });

  test('scheduler reserves airtime for emergency traffic', () => {
    const budget = new BushMeshAirtimeBudget(60000, 100, 50);
    const scheduler = new BushMeshTransmissionScheduler(budget);
    scheduler.enqueue('normal', [1], BushMeshTrafficClass.Telemetry, {
      now: 0,
      airtimeMs: 110,
    });
    scheduler.enqueue('sos', [2], BushMeshTrafficClass.Emergency, {
      now: 0,
      airtimeMs: 110,
    });

    expect(scheduler.next(0)?.id).toBe('sos');
  });

  test('persistent delivery runtime survives restart and retries failed sends', async () => {
    const values = new Map<string, string>();
    const store = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        values.set(key, value);
      },
    };

    const first = new BushMeshPersistentDeliveryRuntime(store, {
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 1000,
    });
    await first.initialize(1000);
    await first.enqueue(42, [0xb5, 0x4d, 1], {
      now: 1000,
      priority: BushMeshPriority.DirectMessage,
    });

    const afterRestart = new BushMeshPersistentDeliveryRuntime(store, {
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 1000,
    });
    expect(await afterRestart.initialize(1001)).toBe(1);

    const failed = await afterRestart.flushReady(async () => {
      throw new Error('offline');
    }, {now: 1001});
    expect(failed.failedMessageIds).toEqual([42]);
    expect(afterRestart.queue.size()).toBe(1);

    expect((await afterRestart.flushReady(async () => {}, {now: 1050})).sentMessageIds).toEqual([]);
    const sent = await afterRestart.flushReady(async () => {}, {now: 1101});
    expect(sent.sentMessageIds).toEqual([42]);
    expect(afterRestart.queue.size()).toBe(0);
  });

  test('peer policy falls back to only mutually-supported compression and transport', () => {
    const local = {
      nodeId: 1,
      role: BushMeshNodeRole.Handheld,
      protocolMinVersion: 1,
      protocolMaxVersion: 1,
      dictionaryVersion: 1,
      capabilities:
        BushMeshCapability.DictionaryText |
        BushMeshCapability.SemanticMessages |
        BushMeshCapability.BinaryTransport |
        BushMeshCapability.StoreAndForward,
    };
    const remote = {
      nodeId: 2,
      role: BushMeshNodeRole.Vehicle,
      protocolMinVersion: 1,
      protocolMaxVersion: 1,
      dictionaryVersion: 1,
      capabilities:
        BushMeshCapability.DictionaryText |
        BushMeshCapability.StoreAndForward,
    };

    const policy = negotiateBushMeshPeerPolicy(local, remote, {
      allowExperimentalBinary: true,
    });
    expect(policy.compatible).toBe(true);
    expect(policy.transport).toBe('text-safe');
    expect(policy.allowSemantic).toBe(false);
    expect(policy.allowDictionary).toBe(true);

    const encoded = encodeTextForBushMeshPeer(
      'heading back to camp',
      7,
      policy,
      {storeAndForward: true, ttlHops: 4},
    );
    expect(encoded.compression).toBe(BushMeshCompressionProfile.TextDictionary);

    const mismatched = negotiateBushMeshPeerPolicy(local, {
      ...remote,
      dictionaryVersion: 2,
    });
    expect(mismatched.allowDictionary).toBe(false);
  });

  test('PING and PONG session reports round-trip latency', () => {
    const session = new BushMeshDiscoverySession(10, 1000);
    const outbound = session.createPing(5000);
    expect(outbound.ping.response).toBe(false);

    const reply = session.createPongForPayload(outbound.payload, 5050);
    expect(reply.pong.response).toBe(true);

    const result = session.acceptPongPayload(reply.payload, 5120);
    expect(result?.nonce).toBe(10);
    expect(result?.roundTripMs).toBe(120);
    expect(session.pendingCount(5120)).toBe(0);
  });

  test('multi-namespace sync summaries and missing ranges round-trip', () => {
    const summary = createInventorySummary(
      BushMeshSyncNamespace.Contacts,
      [10, 11, 12, 20],
      3,
      {bloomByteLength: 8},
    );
    const decoded = decodeBushMeshSyncFrame(encodeInventorySummary(summary));
    expect(decoded.kind).toBe(BushMeshSyncFrameKind.Summary);
    expect(decoded.namespace).toBe(BushMeshSyncNamespace.Contacts);
    expect(decoded.generation).toBe(3);

    expect(missingIdsToRanges([8, 9, 10, 14, 20, 21])).toEqual([
      {start: 8, end: 10},
      {start: 14, end: 14},
      {start: 20, end: 21},
    ]);
  });

  test('dictionary learner finds repeated local phrases without changing wire dictionary', () => {
    const learner = new BushMeshDictionaryLearner();
    learner.observeMany([
      'meet at the creek crossing tonight',
      'creek crossing is clear',
      'stop at the creek crossing',
      'creek crossing ahead',
    ]);
    const phrases = learner.candidates({minimumCount: 3}).map(item => item.phrase);
    expect(phrases).toContain('creek crossing');
  });

  test('progressive location request is a typed command packet and debug inspector can read it', () => {
    const wire = encodeBushMeshControlWire(
      {
        command: BushMeshControlCommand.RequestLocation,
        precision: LocationPrecision.Approx1M,
        maxAgeSeconds: 30,
      },
      55,
    );
    const typed = decodeBushMeshTypedPacket(wire);
    expect(typed.kind).toBe('command');
    if (typed.kind === 'command') {
      expect(typed.value.command).toBe(BushMeshControlCommand.RequestLocation);
    }

    const inspected = inspectBushMeshPacket(wire);
    expect(inspected.messageId).toBe(55);
    expect(inspected.packetTypeName).toBe('Command');
    expect(inspected.hex.startsWith('B5 4D')).toBe(true);
  });
});
