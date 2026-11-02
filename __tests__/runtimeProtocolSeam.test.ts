import {
  BushMeshQuickActionCode,
  decodeBushMeshPosition,
  decodeBushMeshQuickAction,
} from '../src/bushmesh/protocol';
import {decodeBushMeshFormationShare} from '../src/bushmesh/formationProtocol';
import {decodeBushMeshPositionRequest} from '../src/bushmesh/positionRequestProtocol';
import {createOutboxSnapshot, restoreOutboxSnapshot} from '../src/persistence/outboxSnapshot';
import {BushMeshRadioSession} from '../src/radio/BushMeshRadioSession';
import {BushMeshTransmissionController} from '../src/radio/BushMeshTransmissionController';
import {LegacyBushMeshOutboundAdapter} from '../src/radio/LegacyBushMeshOutboundAdapter';

describe('runtime/protocol decoupling seam', () => {
  test('legacy quick actions still encode and transmit through the compatibility adapter', async () => {
    const controller = new BushMeshTransmissionController();
    const adapter = new LegacyBushMeshOutboundAdapter(controller);
    let payload = new Uint8Array();
    controller.setSender(async (_channelIndex, dataType, value) => {
      expect(dataType).toBe(0xff00);
      payload = Uint8Array.from(value);
    });

    adapter.enqueueQuickAction(
      2,
      {
        senderId: 'AABBCCDDEEFF',
        sequence: 7,
        timestampSeconds: 100,
        action: BushMeshQuickActionCode.Hazard,
        ttlSeconds: 900,
      },
      10_000,
    );
    expect((await controller.drainOnce(10_000)).outcome).toBe('accepted');

    const decoded = decodeBushMeshQuickAction(payload);
    expect(decoded.senderId).toBe('AABBCCDDEEFF');
    expect(decoded.action).toBe(BushMeshQuickActionCode.Hazard);
  });

  test('legacy position traffic still supersedes stale queued positions and transmits', async () => {
    const controller = new BushMeshTransmissionController();
    const adapter = new LegacyBushMeshOutboundAdapter(controller);
    const sequences: number[] = [];
    controller.setSender(async (_channelIndex, _dataType, payload) => {
      sequences.push(decodeBushMeshPosition(payload).sequence);
    });

    adapter.enqueuePosition(
      0,
      {
        senderId: '001122334455',
        sequence: 10,
        timestampSeconds: 100,
        latitude: -37.8,
        longitude: 145.2,
      },
      1_000,
    );
    adapter.enqueuePosition(
      0,
      {
        senderId: '001122334455',
        sequence: 11,
        timestampSeconds: 110,
        latitude: -37.79,
        longitude: 145.21,
      },
      1_100,
    );

    expect(controller.list().filter(entry => entry.state === 'cancelled')).toHaveLength(1);
    await controller.drainOnce(2_000);
    expect(sequences).toEqual([11]);
  });

  test('legacy formation traffic still works and newer revisions supersede queued shares', async () => {
    const controller = new BushMeshTransmissionController();
    const adapter = new LegacyBushMeshOutboundAdapter(controller);
    let sentRevision = 0;
    controller.setSender(async (_channelIndex, _dataType, payload) => {
      sentRevision = decodeBushMeshFormationShare(payload).revision;
    });

    const base = {
      senderId: '001122334455',
      sequence: 1,
      timestampSeconds: 100,
      cautionGapMeters: 250,
      criticalGapMeters: 500,
      memberIds: ['001122334455', 'AABBCCDDEEFF'],
    };
    adapter.enqueueFormationShare(0, {...base, revision: 3}, 1_000);
    adapter.enqueueFormationShare(0, {...base, sequence: 2, revision: 4}, 1_100);

    expect(controller.list().filter(entry => entry.state === 'cancelled')).toHaveLength(1);
    await controller.drainOnce(2_000);
    expect(sentRevision).toBe(4);
  });

  test('legacy position requests still encode and transmit', async () => {
    const controller = new BushMeshTransmissionController();
    const adapter = new LegacyBushMeshOutboundAdapter(controller);
    let targetId = '';
    controller.setSender(async (_channelIndex, _dataType, payload) => {
      targetId = decodeBushMeshPositionRequest(payload).targetId;
    });

    adapter.enqueuePositionRequest(
      1,
      {
        senderId: '001122334455',
        targetId: 'AABBCCDDEEFF',
        sequence: 9,
        timestampSeconds: 100,
      },
      10_000,
    );
    expect((await controller.drainOnce(10_000)).outcome).toBe('accepted');
    expect(targetId).toBe('AABBCCDDEEFF');
  });

  test('neutral runtime datagrams survive outbox snapshot recovery unchanged', async () => {
    const before = new BushMeshTransmissionController();
    before.enqueueOutbound({
      channelIndex: 3,
      dataType: 42,
      payload: Uint8Array.from([9, 8, 7]),
      priority: 'control',
      expiresAtMs: 50_000,
      retryPolicy: {maxAttempts: 4},
      identityRef: '001122334455',
      description: 'canonical-runtime-output',
      createdAtMs: 1_000,
    });

    const restored = restoreOutboxSnapshot(
      createOutboxSnapshot(before.list(), 2_000),
      3_000,
    );
    const after = new BushMeshTransmissionController();
    const sends: number[][] = [];
    after.restoreEntries(restored);
    after.setSender(async (channelIndex, dataType, payload) => {
      expect(channelIndex).toBe(3);
      expect(dataType).toBe(42);
      sends.push(Array.from(payload));
    });

    expect((await after.drainOnce(3_000)).outcome).toBe('accepted');
    expect(sends).toEqual([[9, 8, 7]]);
    expect(after.list()[0].maxAttempts).toBe(4);
    expect(after.list()[0].expiresAtMs).toBe(50_000);
  });

  test('radio session accepts neutral pre-encoded output without using legacy helpers', async () => {
    const session = new BushMeshRadioSession();
    const owner = {};
    const sends: number[][] = [];
    session.claimTransport(owner, async (_channelIndex, dataType, payload) => {
      expect(dataType).toBe(99);
      sends.push(Array.from(payload));
    });
    session.setIdentityForOwner(owner, '001122334455');

    const entry = session.queueOutboundDatagram({
      channelIndex: 0,
      dataType: 99,
      payload: Uint8Array.from([4, 3, 2, 1]),
      priority: 'message',
      expiresAtMs: null,
      retryPolicy: {maxAttempts: 3},
      description: 'runtime-owned encoding',
      createdAtMs: 1_000,
    });

    expect(entry.identityRef).toBe('001122334455');
    expect((await session.drainOnce(1_000)).outcome).toBe('accepted');
    expect(sends).toEqual([[4, 3, 2, 1]]);
  });

  test('transport ownership and reconnect suspension semantics are unchanged', async () => {
    const session = new BushMeshRadioSession();
    const owner = {};
    const staleOwner = {};
    let sends = 0;

    session.claimTransport(owner, async () => {
      sends += 1;
    });
    session.setIdentityForOwner(owner, '001122334455');
    session.queueOutboundDatagram({
      channelIndex: 0,
      dataType: 77,
      payload: Uint8Array.from([1]),
      priority: 'control',
      expiresAtMs: null,
      retryPolicy: {maxAttempts: 3},
      description: 'reconnect-test',
      createdAtMs: 1_000,
    });

    expect(session.suspendTransportForOwner(staleOwner)).toBe(false);
    expect(session.suspendTransportForOwner(owner)).toBe(true);
    expect(session.getSnapshot().runtimeRequested).toBe(true);
    expect(session.getSnapshot().transportReady).toBe(false);
    expect(await session.drainOnce(1_000)).toEqual({entry: null, outcome: 'idle'});

    expect(session.resumeTransportForOwner(staleOwner, async () => {})).toBe(false);
    expect(
      session.resumeTransportForOwner(owner, async () => {
        sends += 1;
      }),
    ).toBe(true);
    session.setIdentityForOwner(owner, '001122334455');
    expect((await session.drainOnce(1_000)).outcome).toBe('accepted');
    expect(sends).toBe(1);
  });
});
