import {
  bearingDegrees,
  compassDirection,
  distanceMeters,
  formatDistance,
  getConvoyFreshness,
  shouldReplaceVehiclePosition,
  ConvoyVehicle,
} from '../src/convoy/convoy';

const baseVehicle: ConvoyVehicle = {
  id: 'A1B2C3D4E5F6',
  name: 'Mick',
  latitude: -37.8136,
  longitude: 144.9631,
  altitudeMeters: 25,
  speedKmh: 45,
  headingDegrees: 90,
  accuracyMeters: 5,
  sequence: 10,
  packetTimestampSeconds: 1000,
  receivedAtMs: 1_000_000,
  snrDb: 7,
  pathLength: 1,
};

describe('convoy helpers', () => {
  test('classifies position freshness', () => {
    const now = 1_000_000;
    expect(getConvoyFreshness(now - 5_000, now)).toBe('live');
    expect(getConvoyFreshness(now - 60_000, now)).toBe('recent');
    expect(getConvoyFreshness(now - 300_000, now)).toBe('stale');
    expect(getConvoyFreshness(now - 700_000, now)).toBe('lost');
  });

  test('calculates useful distance and bearing', () => {
    const distance = distanceMeters(
      {latitude: -37.8136, longitude: 144.9631},
      {latitude: -37.8136, longitude: 144.9731},
    );

    expect(distance).toBeGreaterThan(800);
    expect(distance).toBeLessThan(1000);
    expect(compassDirection(bearingDegrees(
      {latitude: -37.8136, longitude: 144.9631},
      {latitude: -37.8136, longitude: 144.9731},
    ))).toBe('E');
    expect(formatDistance(distance)).toMatch(/m$/);
  });

  test('rejects older vehicle updates', () => {
    expect(
      shouldReplaceVehiclePosition(baseVehicle, {
        ...baseVehicle,
        sequence: 99,
        packetTimestampSeconds: 999,
      }),
    ).toBe(false);

    expect(
      shouldReplaceVehiclePosition(baseVehicle, {
        ...baseVehicle,
        sequence: 11,
      }),
    ).toBe(true);
  });
});
