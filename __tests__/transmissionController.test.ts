import {
  BushMeshQuickActionCode,
  decodeBushMeshQuickAction,
} from '../src/bushmesh/protocol';
import {BushMeshTransmissionController} from '../src/radio/BushMeshTransmissionController';

describe('BushMeshTransmissionController', () => {
  test('encodes quick actions and reports radio acceptance truthfully', async () => {
    const controller = new BushMeshTransmissionController();
    const sends: Array<{
      channelIndex: number;
      dataType: number;
      payload: Uint8Array;
    }> = [];

    controller.setSender(async (channelIndex, dataType, payload) => {
      sends.push({channelIndex, dataType, payload: Uint8Array.from(payload)});
    });

    controller.enqueueQuickAction(
      2,
      {
        senderId: 'AABBCCDDEEFF',
        sequence: 7,
        timestampSeconds: 1_800_000_000,
        action: BushMeshQuickActionCode.Hazard,
        latitude: -37.8,
        longitude: 145.2,
        ttlSeconds: 900,
      },
      10_000,
    );

    const result = await controller.drainOnce(10_000);

    expect(result.outcome).toBe('accepted');
    expect(result.entry?.state).toBe('accepted');
    expect(sends).toHaveLength(1);
    expect(sends[0].channelIndex).toBe(2);
    expect(sends[0].dataType).toBe(0xff00);

    const decoded = decodeBushMeshQuickAction(sends[0].payload);
    expect(decoded.action).toBe(BushMeshQuickActionCode.Hazard);
    expect(decoded.senderId).toBe('AABBCCDDEEFF');
  });

  test('safety actions jump ahead of queued positions', async () => {
    const controller = new BushMeshTransmissionController();
    const sentTypes: number[] = [];

    controller.setSender(async (_channelIndex, _dataType, payload) => {
      sentTypes.push(payload[1]);
    });

    controller.enqueuePosition(
      0,
      {
        senderId: '001122334455',
        sequence: 1,
        timestampSeconds: 100,
        latitude: -37.8,
        longitude: 145.2,
      },
      1_000,
    );

    controller.enqueueQuickAction(
      0,
      {
        senderId: '001122334455',
        sequence: 2,
        timestampSeconds: 101,
        action: BushMeshQuickActionCode.Stop,
      },
      1_001,
    );

    await controller.drainOnce(2_000);
    expect(sentTypes).toEqual([2]);
  });

  test('transport failures retain the packet for retry', async () => {
    const controller = new BushMeshTransmissionController();
    controller.setSender(async () => {
      throw new Error('radio offline');
    });

    const queued = controller.enqueueQuickAction(
      1,
      {
        senderId: '112233445566',
        sequence: 5,
        timestampSeconds: 100,
        action: BushMeshQuickActionCode.Regroup,
      },
      5_000,
    );

    const first = await controller.drainOnce(5_000);
    expect(first.outcome).toBe('retrying');
    expect(first.entry?.state).toBe('queued');
    expect(first.entry?.lastError).toBe('radio offline');
    expect(first.entry?.attempts).toBe(1);

    expect(await controller.drainOnce(6_999)).toEqual({
      entry: null,
      outcome: 'idle',
    });

    expect(controller.list().find(entry => entry.id === queued.id)?.state).toBe(
      'queued',
    );
  });

  test('queued work remains queued while no transport is registered', async () => {
    const controller = new BushMeshTransmissionController();
    const entry = controller.enqueuePosition(
      0,
      {
        senderId: '001122334455',
        sequence: 1,
        timestampSeconds: 100,
        latitude: 0,
        longitude: 0,
      },
      1_000,
    );

    const result = await controller.drainOnce(1_000);
    expect(result.outcome).toBe('retrying');
    expect(result.entry?.id).toBe(entry.id);
    expect(controller.list()[0].attempts).toBe(0);
    expect(controller.list()[0].state).toBe('queued');
  });
});
