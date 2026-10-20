import {SimulatedLocationProvider} from '../src/location/LocationProvider';

describe('SimulatedLocationProvider', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('requires at least one route point', () => {
    expect(() => new SimulatedLocationProvider([])).toThrow('at least one point');
  });

  test('emits route points in order and stops when loop is disabled', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-20T00:00:00Z'));

    const fixes: Array<{latitude: number; timestampMs: number}> = [];
    const provider = new SimulatedLocationProvider(
      [
        {latitude: -37.8, longitude: 145.2, delayMs: 100},
        {latitude: -37.7, longitude: 145.3, delayMs: 100},
      ],
      {loop: false},
    );

    const stop = provider.start(fix => {
      fixes.push({latitude: fix.latitude, timestampMs: fix.timestampMs});
    });

    expect(fixes).toHaveLength(1);
    expect(fixes[0].latitude).toBe(-37.8);

    jest.advanceTimersByTime(100);
    expect(fixes).toHaveLength(2);
    expect(fixes[1].latitude).toBe(-37.7);
    expect(fixes[1].timestampMs).toBeGreaterThan(fixes[0].timestampMs);

    jest.advanceTimersByTime(1_000);
    expect(fixes).toHaveLength(2);
    stop();
  });

  test('stop prevents future simulated fixes', () => {
    jest.useFakeTimers();
    const fixes: number[] = [];
    const provider = new SimulatedLocationProvider(
      [
        {latitude: -37.8, longitude: 145.2, delayMs: 50},
        {latitude: -37.7, longitude: 145.3, delayMs: 50},
      ],
      {loop: true},
    );

    const stop = provider.start(fix => fixes.push(fix.latitude));
    expect(fixes).toEqual([-37.8]);

    stop();
    jest.advanceTimersByTime(1_000);
    expect(fixes).toEqual([-37.8]);
  });
});
