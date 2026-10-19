import {decodeBushMeshMeshCoreFrame} from '../src/bushmesh/meshcoreBridge';
import {
  BUSHMESH_MESHCORE_DEV_DATA_TYPE,
  BushMeshMessageType,
  BushMeshQuickActionCode,
  encodeBushMeshPosition,
  encodeBushMeshQuickAction,
} from '../src/bushmesh/protocol';

describe('BushMesh MeshCore bridge', () => {
  test('decodes a BushMesh position carried by MeshCore channel data', () => {
    const payload = encodeBushMeshPosition({
      senderId: 'A1B2C3D4E5F6',
      sequence: 10,
      timestampSeconds: 1_800_000_010,
      latitude: -37.5,
      longitude: 145.25,
      speedKmh: 44.2,
      headingDegrees: 90,
    });

    const decoded = decodeBushMeshMeshCoreFrame({
      channelIndex: 1,
      snrDb: 7.25,
      pathLength: 2,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload,
    });

    expect(decoded?.type).toBe(BushMeshMessageType.Position);
    if (decoded?.type !== BushMeshMessageType.Position) {
      throw new Error('Expected a Bushmesh position message.');
    }

    expect(decoded.channelIndex).toBe(1);
    expect(decoded.snrDb).toBe(7.25);
    expect(decoded.position.senderId).toBe('A1B2C3D4E5F6');
    expect(decoded.position.sequence).toBe(10);
    expect(decoded.position.latitude).toBeCloseTo(-37.5, 6);
    expect(decoded.position.longitude).toBeCloseTo(145.25, 6);
  });

  test('decodes a BushMesh driver quick action', () => {
    const payload = encodeBushMeshQuickAction({
      senderId: '112233445566',
      sequence: 11,
      timestampSeconds: 1_800_000_020,
      action: BushMeshQuickActionCode.Regroup,
      latitude: -37.6,
      longitude: 145.3,
      ttlSeconds: 1800,
    });

    const decoded = decodeBushMeshMeshCoreFrame({
      channelIndex: 2,
      snrDb: 3.5,
      pathLength: 1,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload,
    });

    expect(decoded?.type).toBe(BushMeshMessageType.QuickAction);
    if (decoded?.type !== BushMeshMessageType.QuickAction) {
      throw new Error('Expected a Bushmesh quick-action message.');
    }

    expect(decoded.action.senderId).toBe('112233445566');
    expect(decoded.action.action).toBe(BushMeshQuickActionCode.Regroup);
    expect(decoded.action.latitude).toBeCloseTo(-37.6, 6);
    expect(decoded.action.longitude).toBeCloseTo(145.3, 6);
    expect(decoded.action.ttlSeconds).toBe(1800);
  });

  test('ignores datagrams owned by other applications', () => {
    const decoded = decodeBushMeshMeshCoreFrame({
      channelIndex: 0,
      snrDb: 0,
      pathLength: 0xff,
      dataType: 0x1234,
      payload: Uint8Array.from([1, 1]),
    });

    expect(decoded).toBeNull();
  });
});
