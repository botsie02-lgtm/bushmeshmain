import {getConvoyGapDecision} from '../src/convoy/gapMonitor';

describe('convoy gap monitor', () => {
  test('healthy live gaps do not alert', () => {
    expect(
      getConvoyGapDecision({
        distanceMeters: 250,
        freshness: 'live',
      }),
    ).toMatchObject({
      state: 'good',
      shouldAcceleratePositionUpdates: false,
      shouldAlertDriver: false,
    });
  });

  test('widening gaps accelerate position updates before becoming critical', () => {
    expect(
      getConvoyGapDecision({
        distanceMeters: 700,
        freshness: 'recent',
      }),
    ).toMatchObject({
      state: 'caution',
      shouldAcceleratePositionUpdates: true,
      shouldAlertDriver: false,
    });
  });

  test('critical gaps alert the driver', () => {
    expect(
      getConvoyGapDecision({
        distanceMeters: 1_250,
        freshness: 'live',
      }),
    ).toMatchObject({
      state: 'critical',
      shouldAcceleratePositionUpdates: true,
      shouldAlertDriver: true,
    });
  });

  test('stale coordinates never masquerade as a healthy current gap', () => {
    expect(
      getConvoyGapDecision({
        distanceMeters: 100,
        freshness: 'stale',
      }),
    ).toMatchObject({
      state: 'unknown',
      shouldAcceleratePositionUpdates: true,
      shouldAlertDriver: true,
    });
  });

  test('lost vehicles alert even if the last coordinate was nearby', () => {
    expect(
      getConvoyGapDecision({
        distanceMeters: 50,
        freshness: 'lost',
      }),
    ).toMatchObject({
      state: 'lost',
      shouldAcceleratePositionUpdates: true,
      shouldAlertDriver: true,
    });
  });

  test('rejects inverted thresholds', () => {
    expect(() =>
      getConvoyGapDecision({
        distanceMeters: 500,
        freshness: 'live',
        cautionMeters: 1_000,
        criticalMeters: 500,
      }),
    ).toThrow('Critical convoy gap');
  });
});
