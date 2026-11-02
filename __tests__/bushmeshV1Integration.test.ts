import {
  BushMeshDatagramRuntime,
  BushMeshPacketType,
  BushMeshPriority,
} from '../src/bushmesh';
import {
  BushMeshDistressType,
  encodeBushMeshDistressWire,
  encodeBushMeshWire,
} from '../src/bushmesh/protocol/public';
import {BUSHMESH_MESHCORE_DEV_DATA_TYPE} from '../src/bushmesh/protocol';
import {
  BushMeshV1RuntimeService,
} from '../src/integration/BushMeshV1RuntimeService';
import {bushMeshOutboundToRadioEnvelope} from '../src/integration/BushMeshRadioCoreAdapter';
import {BushMeshRadioSession} from '../src/radio/BushMeshRadioSession';
import {LegacyBushMeshInboundAdapter} from '../src/radio/LegacyBushMeshInboundAdapter';
import type {ReceivedDatagram} from '../src/radio/ReceivedDatagram';

function messageWire(messageId: number, ackRequested = true): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Message,
    priority: BushMeshPriority.DirectMessage,
    messageId,
    ackRequested,
    payload: [0x68, 0x69],
  });
}

function received(payload: number[]): ReceivedDatagram {
  return {
    channelIndex: 2,
    dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
    payload: Uint8Array.from(payload),
    receivedAtMs: 1000,
    transport: 'meshcore',
    source: 'live',
    link: {rssiDbm: -91, snrDb: 7.5, pathLength: 1},
    radioIdentityRef: 'radio-a',
    transportDeviceId: 'heltec-test',
    diagnosticLabel: 'integration-test',
  };
}

describe('BushMesh v1 radio-core integration', () => {
  test('radio-core inbound datagrams reach the canonical application-lifetime runtime', async () => {
    let inboundListener: ((datagram: ReceivedDatagram) => void) | null = null;
    const runtime = new BushMeshDatagramRuntime();
    const session = new BushMeshRadioSession();
    const service = new BushMeshV1RuntimeService({
      runtime,
      radioSession: session,
      subscribeInbound: listener => {
        inboundListener = listener;
        return () => {
          inboundListener = null;
        };
      },
    });
    const resultPromise = new Promise(resolve => {
      const unsubscribe = service.subscribeInboundResults(result => {
        unsubscribe();
        resolve(result);
      });
    });

    await service.start();
    expect(inboundListener).not.toBeNull();
    inboundListener?.(received(messageWire(10)));

    await expect(resultPromise).resolves.toMatchObject({
      status: 'accepted',
      kind: 'protocol',
      protected: false,
    });
    await service.dispose();
  });

  test('canonical outbound maps to the radio queue without duplicating protocol retries', async () => {
    const sent: Array<{channelIndex: number; dataType: number; payload: Uint8Array}> = [];
    const session = new BushMeshRadioSession();
    session.setTransport(async (channelIndex, dataType, payload) => {
      sent.push({channelIndex, dataType, payload: Uint8Array.from(payload)});
    });
    session.setIdentity('radio-a');

    const runtime = new BushMeshDatagramRuntime();
    const service = new BushMeshV1RuntimeService({runtime, radioSession: session});
    const prepared = await runtime.prepareOutbound(messageWire(11), {
      channelIndex: 2,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: 'meshcore',
    });

    expect(prepared.retryIntent).toEqual({
      mode: 'protocol-managed',
      maxTransportAttempts: 1,
    });
    service.queuePreparedOutbound(prepared);
    expect(session.listOutbox()[0]).toMatchObject({
      maxAttempts: 1,
      priority: 'message',
      identityRef: 'radio-a',
    });

    await expect(session.drainOnce(1100)).resolves.toMatchObject({outcome: 'accepted'});
    expect(sent).toHaveLength(1);
    expect(Array.from(sent[0].payload)).toEqual(Array.from(prepared.payload));
  });

  test('only canonical transport-retry intent expands radio-core carrier attempts', async () => {
    const runtime = new BushMeshDatagramRuntime();
    const prepared = await runtime.prepareOutbound(messageWire(12, false), {
      channelIndex: 1,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: 'meshcore',
      retryIntent: {mode: 'transport-retry', maxTransportAttempts: 3},
    });
    const envelope = bushMeshOutboundToRadioEnvelope(prepared, 'radio-a');
    expect(envelope.retryPolicy.maxAttempts).toBe(3);
  });

  test('queued canonical traffic survives carrier disconnect and sends after reconnect', async () => {
    const sent: Uint8Array[] = [];
    const session = new BushMeshRadioSession();
    session.setTransport(async (_channelIndex, _dataType, payload) => {
      sent.push(Uint8Array.from(payload));
    });
    session.setIdentity('radio-a');
    session.setTransport(null);

    const runtime = new BushMeshDatagramRuntime();
    const prepared = await runtime.prepareOutbound(messageWire(13, false), {
      channelIndex: 1,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: 'meshcore',
    });
    session.queueOutboundDatagram(
      bushMeshOutboundToRadioEnvelope(prepared, null),
    );

    await expect(session.drainOnce(1200)).resolves.toMatchObject({outcome: 'idle'});
    session.setTransport(async (_channelIndex, _dataType, payload) => {
      sent.push(Uint8Array.from(payload));
    });
    session.setIdentity('radio-a');
    await expect(session.drainOnce(1300)).resolves.toMatchObject({outcome: 'accepted'});
    expect(sent).toHaveLength(1);
  });

  test('emergency priority is preserved into the radio-core queue contract', async () => {
    const runtime = new BushMeshDatagramRuntime({
      emergencySecurityPolicy: 'allow-unauthenticated-fallback',
    });
    const prepared = await runtime.prepareOutbound(
      encodeBushMeshDistressWire({type: BushMeshDistressType.General}, 14),
      {
        channelIndex: 1,
        dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
        transport: 'meshcore',
      },
    );
    expect(prepared.priority).toBe('safety');
    expect(bushMeshOutboundToRadioEnvelope(prepared, 'radio-a').priority).toBe(
      'safety',
    );
  });

  test('canonical packets are not also delivered by the legacy packet adapter', async () => {
    const datagram = received(messageWire(15));
    const canonical = new BushMeshDatagramRuntime();
    const legacy = new LegacyBushMeshInboundAdapter();

    await expect(
      canonical.acceptInbound({
        ...datagram,
        transport: datagram.transport,
      }),
    ).resolves.toMatchObject({status: 'accepted', kind: 'protocol'});
    expect(legacy.consume(datagram)).toBeNull();
  });
});
