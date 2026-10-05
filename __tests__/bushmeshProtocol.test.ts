import {
  BUSHMESH_MESHCORE_DEV_DATA_TYPE,
  BUSHMESH_PROTOCOL_VERSION,
  BushMeshMessageType,
  decodeBushMeshPosition,
  encodeBushMeshPosition,
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
    expect(decoded.speedKmh).toBe(0);
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
