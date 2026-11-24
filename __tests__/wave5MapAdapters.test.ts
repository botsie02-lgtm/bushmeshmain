import {projectOfflineTrack} from '../src/maps/offlineTrackProjection';
import {projectFieldChannelPositions} from '../src/maps/fieldChannelPositionAdapter';

describe('Wave 5 read-only trail projection', () => {
  it('preserves endpoints while rendering at most the visual budget', () => {
    const source = Array.from({length: 2000}, (_, index) => ({
      latitude: -37.8 + index / 100000,
      longitude: 144.9 + index / 100000,
      recordedAtMs: 1000 + index * 1000,
    }));
    const projected = projectOfflineTrack(source);
    expect(projected.originalCount).toBe(2000);
    expect(projected.displayCount).toBe(128);
    expect(projected.vertices[0].latitude).toBe(source[0].latitude);
    expect(projected.vertices[127].longitude).toBe(source[1999].longitude);
    expect(source).toHaveLength(2000); // Export history is untouched.
  });

  it('filters malformed samples without inventing mileage', () => {
    const projected = projectOfflineTrack([
      {latitude: -37.8, longitude: 145, recordedAtMs: 10},
      {latitude: -37.9, longitude: 145, recordedAtMs: 9},
      {latitude: 100, longitude: 145, recordedAtMs: 20},
      {latitude: -37.7, longitude: 145, recordedAtMs: 30},
    ]);
    expect(projected.originalCount).toBe(2);
    expect(projected.vertices).toHaveLength(2);
    expect(projected.startedAtMs).toBe(10);
    expect(projected.endedAtMs).toBe(30);
  });
});

describe('Wave 5 field channel diagnostic isolation', () => {
  const heard = {
    id: 'unverified-a', name: 'Unknown radio', latitude: -37.8,
    longitude: 144.98, receivedAtMs: 100_000,
    accuracyMeters: 20, simulated: false,
  };
  it('marks every heard position unverified rather than an authorised member', () => {
    const projected = projectFieldChannelPositions([heard], 101_000);
    expect(projected).toHaveLength(1);
    expect(projected[0].trust).toBe('unverified-channel');
    expect(projected[0].coordinate.longitude).toBe(144.98);
    expect(projected[0]).not.toHaveProperty('position');
  });

  it('excludes future, expired, duplicate, and malformed radio samples', () => {
    const projected = projectFieldChannelPositions([
      heard,
      {...heard, name: 'duplicate'},
      {...heard, id: 'future', receivedAtMs: 300_000},
      {...heard, id: 'invalid', latitude: 200},
      {...heard, id: 'old', receivedAtMs: -50_000_000},
    ], 101_000);
    expect(projected.map(p => p.id)).toEqual(['unverified-a']);
  });
});
