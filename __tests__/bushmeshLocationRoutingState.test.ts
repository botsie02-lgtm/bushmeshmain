import {
  BushMeshLocationDeltaDecoder,
  BushMeshLocationDeltaEncoder,
  BushMeshRouteAdvertisementTracker,
  LocationPrecision,
  decodeLocationPayload,
  isNewerUint32Sequence,
} from '../src/bushmesh/protocol';

describe('Bushmesh GPS state and route freshness', () => {
  test('uses an absolute GPS anchor followed by compact deltas', () => {
    const encoder = new BushMeshLocationDeltaEncoder(4, 2000);
    const decoder = new BushMeshLocationDeltaDecoder();

    const first = encoder.encode({
      latitude: -37.8,
      longitude: 145.3,
      precision: LocationPrecision.Approx1M,
    });
    expect(first.mode).toBe('absolute');

    const absolute = decodeLocationPayload(first.payload);
    decoder.acceptAbsolute(absolute);

    const second = encoder.encode({
      latitude: -37.7999,
      longitude: 145.3001,
      precision: LocationPrecision.Approx1M,
    });
    expect(second.mode).toBe('delta');
    expect(second.payload.length).toBeLessThan(7);

    const reconstructed = decoder.acceptDelta(second.payload);
    expect(Math.abs(reconstructed.latitude - -37.7999)).toBeLessThan(0.00003);
    expect(Math.abs(reconstructed.longitude - 145.3001)).toBeLessThan(0.00003);
  });

  test('periodically re-anchors and forces absolute positions after large jumps', () => {
    const encoder = new BushMeshLocationDeltaEncoder(2, 100);

    expect(encoder.encode({latitude: -37.8, longitude: 145.3}).mode).toBe(
      'absolute',
    );
    expect(
      encoder.encode({latitude: -37.79999, longitude: 145.30001}).mode,
    ).toBe('delta');
    expect(
      encoder.encode({latitude: -37.79998, longitude: 145.30002}).mode,
    ).toBe('absolute');
    expect(encoder.encode({latitude: -37.7, longitude: 145.4}).mode).toBe(
      'absolute',
    );
  });

  test('handles uint32 route sequence wraparound', () => {
    expect(isNewerUint32Sequence(11, 10)).toBe(true);
    expect(isNewerUint32Sequence(10, 10)).toBe(false);
    expect(isNewerUint32Sequence(9, 10)).toBe(false);
    expect(isNewerUint32Sequence(1, 0xffffffff)).toBe(true);
  });

  test('accepts newer route adverts per previous hop and rejects stale repeats', () => {
    const tracker = new BushMeshRouteAdvertisementTracker(1000);
    const advert = {
      destinationNodeId: 20,
      sequence: 5,
      hopCount: 1,
      pathQuality: 90,
    };

    expect(tracker.accept(advert, 2, 1000)).toBe(true);
    expect(tracker.accept(advert, 2, 1100)).toBe(false);
    expect(tracker.accept({...advert, sequence: 6}, 2, 1200)).toBe(true);
    expect(tracker.accept(advert, 3, 1200)).toBe(true);
    expect(tracker.accept(advert, 2, 2300)).toBe(true);
  });
});
