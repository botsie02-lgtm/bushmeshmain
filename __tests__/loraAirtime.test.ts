import {
  RollingAirtimeBudget,
  estimateLoRaAirtimeMs,
} from '../src/radio/loraAirtime';

describe('LoRa airtime estimation', () => {
  test('estimates a normal SF7 125 kHz packet', () => {
    const estimate = estimateLoRaAirtimeMs(20, {
      spreadingFactor: 7,
      bandwidthKhz: 125,
      codingRate: 5,
    });

    expect(estimate.symbolDurationMs).toBeCloseTo(1.024, 3);
    expect(estimate.payloadSymbolCount).toBe(43);
    expect(estimate.totalDurationMs).toBeCloseTo(56.576, 3);
    expect(estimate.lowDataRateOptimize).toBe(false);
  });

  test('automatically enables low-data-rate optimisation for slow symbols', () => {
    const estimate = estimateLoRaAirtimeMs(30, {
      spreadingFactor: 12,
      bandwidthKhz: 125,
      codingRate: 5,
    });

    expect(estimate.lowDataRateOptimize).toBe(true);
    expect(estimate.totalDurationMs).toBeCloseTo(1646.592, 3);
  });

  test('larger packets cost more airtime with the same radio settings', () => {
    const small = estimateLoRaAirtimeMs(30, {
      spreadingFactor: 7,
      bandwidthKhz: 125,
      codingRate: 5,
    });
    const large = estimateLoRaAirtimeMs(163, {
      spreadingFactor: 7,
      bandwidthKhz: 125,
      codingRate: 5,
    });

    expect(large.totalDurationMs).toBeGreaterThan(small.totalDurationMs);
  });

  test('rejects impossible modem parameters', () => {
    expect(() =>
      estimateLoRaAirtimeMs(20, {
        spreadingFactor: 13,
        bandwidthKhz: 125,
        codingRate: 5,
      }),
    ).toThrow('spreading factor');
  });
});

describe('RollingAirtimeBudget', () => {
  test('tracks remaining airtime inside a configurable rolling window', () => {
    const budget = new RollingAirtimeBudget({
      windowMs: 60_000,
      maxAirtimeMs: 6_000,
    });

    budget.record(2_000, 10_000);
    budget.record(1_500, 20_000);

    expect(budget.getUsedAirtimeMs(20_000)).toBe(3_500);
    expect(budget.getRemainingAirtimeMs(20_000)).toBe(2_500);
    expect(budget.canSpend(2_500, 20_000)).toBe(true);
    expect(budget.canSpend(2_501, 20_000)).toBe(false);
  });

  test('prunes spends once they leave the rolling window', () => {
    const budget = new RollingAirtimeBudget({
      windowMs: 60_000,
      maxAirtimeMs: 6_000,
    });

    budget.record(2_000, 10_000);
    budget.record(1_500, 20_000);

    expect(budget.getUsedAirtimeMs(70_000)).toBe(1_500);
    expect(budget.getUsedAirtimeMs(80_001)).toBe(0);
  });

  test('does not encode a legal duty-cycle assumption into the policy', () => {
    const budget = new RollingAirtimeBudget({
      windowMs: 10_000,
      maxAirtimeMs: 10_000,
    });

    expect(budget.getPolicy()).toEqual({
      windowMs: 10_000,
      maxAirtimeMs: 10_000,
    });
  });
});
