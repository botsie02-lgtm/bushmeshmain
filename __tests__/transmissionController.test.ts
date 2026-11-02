import {BushMeshTransmissionController} from '../src/radio/BushMeshTransmissionController';
import type {OutboundDatagramEnvelope} from '../src/radio/OutboundDatagram';

function envelope(
  overrides?: Partial<OutboundDatagramEnvelope>,
): OutboundDatagramEnvelope {
  return {
    channelIndex: 0,
    dataType: 0xff00,
    payload: Uint8Array.from([1, 9, 2, 3]),
    priority: 'message',
    expiresAtMs: null,
    retryPolicy: {maxAttempts: 5},
    identityRef: '001122334455',
    description: 'pre-encoded runtime datagram',
    createdAtMs: 1_000,
    ...overrides,
  };
}

describe('BushMeshTransmissionController', () => {
  test('queues and transmits already-encoded runtime output unchanged', async () => {
    const controller = new BushMeshTransmissionController();
    const sends: Array<{
      channelIndex: number;
      dataType: number;
      payload: Uint8Array;
    }> = [];

    controller.setSender(async (channelIndex, dataType, payload) => {
      sends.push({channelIndex, dataType, payload: Uint8Array.from(payload)});
    });

    controller.enqueueOutbound(
      envelope({
        channelIndex: 2,
        dataType: 77,
        payload: Uint8Array.from([8, 7, 6, 5]),
      }),
    );

    const result = await controller.drainOnce(1_000);

    expect(result.outcome).toBe('accepted');
    expect(sends).toEqual([
      {
        channelIndex: 2,
        dataType: 77,
        payload: Uint8Array.from([8, 7, 6, 5]),
      },
    ]);
  });

  test('priority ordering is unchanged for neutral envelopes', async () => {
    const controller = new BushMeshTransmissionController();
    const sentDescriptions: string[] = [];

    controller.setSender(async () => {
      const inflight = controller
        .list()
        .find(entry => entry.state === 'inflight');
      if (inflight) {
        sentDescriptions.push(inflight.description);
      }
    });

    controller.enqueueOutbound(
      envelope({priority: 'position', description: 'position', createdAtMs: 1_000}),
    );
    controller.enqueueOutbound(
      envelope({priority: 'safety', description: 'safety', createdAtMs: 1_001}),
    );

    await controller.drainOnce(2_000);
    expect(sentDescriptions).toEqual(['safety']);
  });

  test('expired traffic is cancelled before radio transmission', async () => {
    const controller = new BushMeshTransmissionController();
    let sendCount = 0;
    controller.setSender(async () => {
      sendCount += 1;
    });

    controller.enqueueOutbound(envelope({expiresAtMs: 3_000}));

    expect(await controller.drainOnce(3_000)).toEqual({
      entry: null,
      outcome: 'idle',
    });
    expect(sendCount).toBe(0);
    expect(controller.list()[0].state).toBe('cancelled');
    expect(controller.list()[0].lastError).toContain('Expired');
  });

  test('transport failures retain the packet for the same retry schedule', async () => {
    const controller = new BushMeshTransmissionController();
    controller.setSender(async () => {
      throw new Error('radio offline');
    });

    const queued = controller.enqueueOutbound(envelope());
    const first = await controller.drainOnce(1_000);

    expect(first.outcome).toBe('retrying');
    expect(first.entry?.state).toBe('queued');
    expect(first.entry?.lastError).toBe('radio offline');
    expect(first.entry?.attempts).toBe(1);
    expect(first.entry?.nextAttemptAtMs).toBe(3_000);
    expect(await controller.drainOnce(2_999)).toEqual({
      entry: null,
      outcome: 'idle',
    });
    expect(controller.list().find(entry => entry.id === queued.id)?.state).toBe(
      'queued',
    );
  });

  test('max-attempt policy is supplied by the runtime envelope', async () => {
    const controller = new BushMeshTransmissionController();
    controller.setSender(async () => {
      throw new Error('still offline');
    });
    controller.enqueueOutbound(envelope({retryPolicy: {maxAttempts: 2}}));

    expect((await controller.drainOnce(1_000)).outcome).toBe('retrying');
    const second = await controller.drainOnce(3_000);

    expect(second.outcome).toBe('failed');
    expect(second.entry?.state).toBe('failed');
    expect(second.entry?.attempts).toBe(2);
  });

  test('queued work remains queued while no transport is registered', async () => {
    const controller = new BushMeshTransmissionController();
    const entry = controller.enqueueOutbound(envelope());

    const result = await controller.drainOnce(1_000);
    expect(result.outcome).toBe('retrying');
    expect(result.entry?.id).toBe(entry.id);
    expect(controller.list()[0].attempts).toBe(0);
    expect(controller.list()[0].state).toBe('queued');
  });
});
