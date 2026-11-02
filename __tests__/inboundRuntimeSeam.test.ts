import {
  encodeBushMeshFormationShare,
} from '../src/bushmesh/formationProtocol';
import {
  encodeBushMeshPositionRequest,
} from '../src/bushmesh/positionRequestProtocol';
import {
  BUSHMESH_MESHCORE_DEV_DATA_TYPE,
  BushMeshMessageType,
  BushMeshQuickActionCode,
  encodeBushMeshPosition,
  encodeBushMeshQuickAction,
} from '../src/bushmesh/legacyProtocol';
import {subscribeBushMeshInboundMessages} from '../src/bushmesh/inboundBus';
import {meshCoreFrameToReceivedDatagram} from '../src/meshcore/MeshCoreReceivedDatagramAdapter';
import {
  legacyBushMeshInboundAdapter,
} from '../src/radio/LegacyBushMeshInboundAdapter';
import {
  publishReceivedDatagram,
  subscribeReceivedDatagrams,
} from '../src/radio/ReceivedDatagram';

describe('inbound runtime protocol seam', () => {
  test('neutral pre-decoded transport data can be consumed without BushMesh parsing', () => {
    const received: number[][] = [];
    const unsubscribe = subscribeReceivedDatagrams(datagram => {
      received.push(Array.from(datagram.payload));
    });

    publishReceivedDatagram({
      channelIndex: 3,
      dataType: 0x1234,
      payload: Uint8Array.from([9, 8, 7]),
      receivedAtMs: 42,
      transport: 'meshcore',
      source: 'live',
      link: {snrDb: 4.5, pathLength: 2},
      radioIdentityRef: 'AABBCCDDEEFF',
      diagnosticLabel: 'test-neutral',
    });
    unsubscribe();

    expect(received).toEqual([[9, 8, 7]]);
  });

  test('MeshCore adaptation preserves only transport metadata and payload bytes', () => {
    const datagram = meshCoreFrameToReceivedDatagram(
      {
        channelIndex: 2,
        dataType: 0xbeef,
        payload: Uint8Array.from([1, 2, 3]),
        snrDb: -2.25,
        pathLength: 4,
      },
      {
        receivedAtMs: 1_234,
        source: 'background-replay',
        radioIdentityRef: '001122334455',
      },
    );

    expect(datagram).toMatchObject({
      channelIndex: 2,
      dataType: 0xbeef,
      receivedAtMs: 1_234,
      transport: 'meshcore',
      source: 'background-replay',
      radioIdentityRef: '001122334455',
      link: {snrDb: -2.25, pathLength: 4},
    });
    expect(Array.from(datagram.payload)).toEqual([1, 2, 3]);
  });

  test('legacy compatibility adapter preserves position and quick-action behaviour', () => {
    const position = legacyBushMeshInboundAdapter.consume({
      channelIndex: 1,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload: encodeBushMeshPosition({
        senderId: 'A1B2C3D4E5F6',
        sequence: 7,
        timestampSeconds: 100,
        latitude: -37.8,
        longitude: 145.2,
      }),
      receivedAtMs: 5_000,
      transport: 'meshcore',
      source: 'live',
      link: {snrDb: 6.5, pathLength: 1},
    });

    expect(position?.type).toBe(BushMeshMessageType.Position);
    if (position?.type !== BushMeshMessageType.Position) {
      throw new Error('Expected legacy position.');
    }
    expect(position.position.senderId).toBe('A1B2C3D4E5F6');
    expect(position.snrDb).toBe(6.5);

    const action = legacyBushMeshInboundAdapter.consume({
      channelIndex: 1,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload: encodeBushMeshQuickAction({
        senderId: '112233445566',
        sequence: 8,
        timestampSeconds: 101,
        action: BushMeshQuickActionCode.Regroup,
      }),
      receivedAtMs: 5_001,
      transport: 'meshcore',
      source: 'live',
    });

    expect(action?.type).toBe(BushMeshMessageType.QuickAction);
  });

  test('legacy compatibility adapter preserves formation and position requests', () => {
    const formation = legacyBushMeshInboundAdapter.consume({
      channelIndex: 0,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload: encodeBushMeshFormationShare({
        senderId: '001122334455',
        sequence: 9,
        timestampSeconds: 200,
        revision: 3,
        cautionGapMeters: 200,
        criticalGapMeters: 500,
        memberIds: ['001122334455', 'AABBCCDDEEFF'],
      }),
      receivedAtMs: 6_000,
      transport: 'meshcore',
      source: 'live',
    });
    expect(formation?.type).toBe(3);

    const request = legacyBushMeshInboundAdapter.consume({
      channelIndex: 0,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload: encodeBushMeshPositionRequest({
        senderId: '001122334455',
        targetId: 'AABBCCDDEEFF',
        sequence: 10,
        timestampSeconds: 201,
      }),
      receivedAtMs: 6_001,
      transport: 'meshcore',
      source: 'background-replay',
    });
    expect(request?.type).toBe(4);
  });

  test('legacy domain subscribers retain original receive time and replay source', () => {
    const metadata: Array<{receivedAtMs: number; source: string}> = [];
    const unsubscribe = subscribeBushMeshInboundMessages((_message, item) => {
      metadata.push(item);
    });

    legacyBushMeshInboundAdapter.consume({
      channelIndex: 0,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload: encodeBushMeshPosition({
        senderId: '001122334455',
        sequence: 11,
        timestampSeconds: 202,
        latitude: -37.7,
        longitude: 145.1,
      }),
      receivedAtMs: 77_777,
      transport: 'meshcore',
      source: 'background-replay',
    });
    unsubscribe();

    expect(metadata).toEqual([
      {receivedAtMs: 77_777, source: 'background-replay'},
    ]);
  });
});
