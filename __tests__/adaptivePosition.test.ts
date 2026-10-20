import {
  getAdaptivePositionDecision,
  shouldTransmitPosition,
} from '../src/location/adaptivePosition';

describe('adaptive convoy position policy', () => {
  test('backs stationary vehicles off to 90 seconds', () => {
    expect(getAdaptivePositionDecision({speedKmh: 0})).toEqual({
      intervalMs: 90_000,
      reason: 'stationary',
    });
  });

  test('uses faster updates while moving', () => {
    expect(getAdaptivePositionDecision({speedKmh: 35})).toEqual({
      intervalMs: 15_000,
      reason: 'moving',
    });
  });

  test('turns increase update frequency', () => {
    expect(
      getAdaptivePositionDecision({
        speedKmh: 20,
        headingChangeDegrees: 45,
      }),
    ).toEqual({intervalMs: 8_000, reason: 'turning'});
  });

  test('large convoy gaps get high-priority position updates', () => {
    expect(
      getAdaptivePositionDecision({
        speedKmh: 10,
        convoyGapMeters: 1_500,
      }),
    ).toEqual({intervalMs: 5_000, reason: 'large-gap'});
  });

  test('urgent state overrides normal movement', () => {
    expect(
      getAdaptivePositionDecision({
        speedKmh: 0,
        urgent: true,
      }),
    ).toEqual({intervalMs: 5_000, reason: 'urgent'});
  });

  test('first position is always eligible for transmission', () => {
    expect(
      shouldTransmitPosition(null, 1_000_000, {
        speedKmh: 0,
      }),
    ).toBe(true);
  });

  test('subsequent positions obey the selected interval', () => {
    const lastSent = 1_000_000;
    expect(
      shouldTransmitPosition(lastSent, lastSent + 14_999, {
        speedKmh: 30,
      }),
    ).toBe(false);
    expect(
      shouldTransmitPosition(lastSent, lastSent + 15_000, {
        speedKmh: 30,
      }),
    ).toBe(true);
  });
});
