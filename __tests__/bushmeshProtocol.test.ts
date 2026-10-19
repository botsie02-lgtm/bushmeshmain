import {
  BUSHMESH_MESHCORE_DEV_DATA_TYPE,
  BUSHMESH_PROTOCOL_VERSION,
  BushMeshMessageType,
  BushMeshQuickActionCode,
  decodeBushMeshPosition,
  decodeBushMeshQuickAction,
  encodeBushMeshPosition,
  encodeBushMeshQuickAction,
} from '../src/bushmesh/protocol';

describe('BushMesh v1 protocol', () => {
  test('uses the MeshCore development application namespace', () => {
    expect(BUSHMESH_MESHCORE_DEV_DATA_TYPE).toBe(0xff00);
  });

  test('encodes a position in 30 bytes and round-trips it', () => {
    const packet = encodeBushMeshPosition({
      senderId: 'A1B2C3D4E5F6',
      sequence: 513,
      timestampSeconds: 1_800_000_000,
      latitude: -37.813629,
      longitude: 144.963058,
      altitudeMeters: 42,
      speedKmh: 73.4,
      headingDegrees: 217.25,
      accuracyMeters: 6,
      flags: 0x03,
    });

    expect(packet).toHaveLength(30);
    expect(packet[0]).toBe(BUSHMESH_PROTOCOL_VERSION);
    expect(packet[1]).toBe(BushMeshMessageType.Position);

    const decoded = decodeBushMeshPosition(packet);

    expect(decoded.senderId).toBe('A1B2C3D4E5F6');
    expect(decoded.sequence).toBe(513);
    expect(decoded.timestampSeconds).toBe(1_800_000_000);
    expect(decoded.latitude).toBeCloseTo(-37.813629, 6);
    expect(decoded.longitude).toBeCloseTo(144.963058, 6);
    expect(decoded.altitudeMeters).toBe(42);
    expect(decoded.speedKmh).toBeCloseTo(73.4, 1);
    expect(decoded.headingDegrees).toBeCloseTo(217.25, 2);
    expect(decoded.accuracyMeters).toBe(6);
    expect(decoded.flags).toBe(0x03);
  });

  test('preserves unknown optional position fields', () => {
    const packet = encodeBushMeshPosition({
      senderId: '001122334455',
      sequence: 1,
      timestampSeconds: 2,
      latitude: 0,
      longitude: 0,
    });

    const decoded = decodeBushMeshPosition(packet);

    expect(decoded.senderId).toBe('001122334455');
    expect(decoded.altitudeMeters).toBeNull();
    expect(decoded.headingDegrees).toBeNull();
    expect(decoded.accuracyMeters).toBeNull();
    expect(decoded.speedKmh).toBeNull();
  });

  test('encodes a located quick action in 26 bytes and round-trips it', () => {
    const packet = encodeBushMeshQuickAction({
      senderId: 'AABBCCDDEEFF',
      sequence: 14,
      timestampSeconds: 1_800_000_123,
      action: BushMeshQuickActionCode.Hazard,
      latitude: -37.9,
      longitude: 145.1,
      ttlSeconds: 900,
      flags: 0x02,
    });

    expect(packet).toHaveLength(26);
    expect(packet[1]).toBe(BushMeshMessageType.QuickAction);

    const decoded = decodeBushMeshQuickAction(packet);
    expect(decoded.senderId).toBe('AABBCCDDEEFF');
    expect(decoded.action).toBe(BushMeshQuickActionCode.Hazard);
    expect(decoded.latitude).toBeCloseTo(-37.9, 6);
    expect(decoded.longitude).toBeCloseTo(145.1, 6);
    expect(decoded.ttlSeconds).toBe(900);
    expect(decoded.flags).toBe(0x02);
  });

  test('quick actions may omit location without pretending coordinates are zero', () => {
    const packet = encodeBushMeshQuickAction({
      senderId: 'AABBCCDDEEFF',
      sequence: 15,
      timestampSeconds: 1_800_000_124,
      action: BushMeshQuickActionCode.Ok,
    });

    const decoded = decodeBushMeshQuickAction(packet);
    expect(decoded.latitude).toBeNull();
    expect(decoded.longitude).toBeNull();
    expect(decoded.ttlSeconds).toBe(0);
  });

  test('rejects incomplete quick-action locations', () => {
    expect(() =>
      encodeBushMeshQuickAction({
        senderId: 'AABBCCDDEEFF',
        sequence: 16,
        timestampSeconds: 1_800_000_125,
        action: BushMeshQuickActionCode.Regroup,
        latitude: -37.8,
      }),
    ).toThrow('both latitude and longitude');
  });

  test('rejects invalid coordinates', () => {
    expect(() =>
      encodeBushMeshPosition({
        senderId: '001122334455',
        sequence: 1,
        timestampSeconds: 2,
        latitude: 91,
        longitude: 0,
      }),
    ).toThrow('Latitude');
  });

  test('rejects invalid sender identities', () => {
    expect(() =>
      encodeBushMeshPosition({
        senderId: 'NOT-A-NODE',
        sequence: 1,
        timestampSeconds: 2,
        latitude: 0,
        longitude: 0,
      }),
    ).toThrow('senderId');
  });
});
