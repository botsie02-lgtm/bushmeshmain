import {
  LocationPrecision,
  decodeConfigBundle,
  decodeContactCard,
  decodeRoutePoints,
  encodeConfigBundle,
  encodeContactCard,
  encodeRoutePoints,
} from '../src/bushmesh/protocol';

describe('Bushmesh compact contact, route and config payloads', () => {
  test('contact card round-trips with a compact location', () => {
    const encoded = encodeContactCard({
      nodeId: 1234,
      name: 'Lead Vehicle',
      role: 2,
      location: {
        latitude: -37.8136,
        longitude: 144.9631,
        precision: LocationPrecision.Approx100M,
      },
    });
    const decoded = decodeContactCard(encoded);
    expect(decoded.nodeId).toBe(1234);
    expect(decoded.name).toBe('Lead Vehicle');
    expect(decoded.role).toBe(2);
    expect(decoded.location).toBeDefined();
    expect(Math.abs(decoded.location!.latitude - -37.8136)).toBeLessThan(0.002);
    expect(Math.abs(decoded.location!.longitude - 144.9631)).toBeLessThan(0.002);
  });

  test('route points use one absolute anchor followed by metre deltas', () => {
    const points = [
      {latitude: -37.8, longitude: 145.3},
      {latitude: -37.7999, longitude: 145.3001},
      {latitude: -37.7998, longitude: 145.3002},
      {latitude: -37.7997, longitude: 145.3003},
    ];
    const encoded = encodeRoutePoints(points, LocationPrecision.Approx10M);
    const decoded = decodeRoutePoints(encoded);
    expect(decoded).toHaveLength(points.length);
    for (let index = 0; index < points.length; index += 1) {
      expect(Math.abs(decoded[index].latitude - points[index].latitude)).toBeLessThan(0.0002);
      expect(Math.abs(decoded[index].longitude - points[index].longitude)).toBeLessThan(0.0002);
    }
  });

  test('config bundle round-trips compact numeric keys and byte values', () => {
    const entries = [
      {key: 1, value: [10, 20, 30]},
      {key: 300, value: [1]},
      {key: 7, value: []},
    ];
    expect(decodeConfigBundle(encodeConfigBundle(entries))).toEqual(entries);
  });
});
