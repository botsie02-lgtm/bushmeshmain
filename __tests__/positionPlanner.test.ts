import {
  BushMeshPositionPlanner,
  headingDifferenceDegrees,
  normalizeHeadingDegrees,
  validateLocationFix,
} from '../src/location/positionPlanner';

describe('BushMeshPositionPlanner', () => {
  test('normalizes headings and handles north wrap-around', () => {
    expect(normalizeHeadingDegrees(370)).toBe(10);
    expect(normalizeHeadingDegrees(-10)).toBe(350);
    expect(headingDifferenceDegrees(350, 10)).toBe(20);
    expect(headingDifferenceDegrees(10, 350)).toBe(20);
  });

  test('first valid fix is transmitted with sequence 1', () => {
    const planner = new BushMeshPositionPlanner();
    const result = planner.ingest(
      {
        latitude: -37.8,
        longitude: 145.2,
        timestampMs: 1_000_000,
        speedKmh: 30,
        headingDegrees: 90,
        accuracyMeters: 5,
      },
      {channelIndex: 2},
    );

    expect(result.fixAccepted).toBe(true);
    expect(result.shouldTransmit).toBe(true);
    expect(result.position).toMatchObject({
      channelIndex: 2,
      sequence: 1,
      timestampSeconds: 1_000,
      latitude: -37.8,
      longitude: 145.2,
      speedKmh: 30,
      headingDegrees: 90,
    });
  });

  test('moving fixes inside the 15 second interval do not transmit', () => {
    const planner = new BushMeshPositionPlanner();
    planner.ingest(
      {
        latitude: -37.8,
        longitude: 145.2,
        timestampMs: 1_000_000,
        speedKmh: 30,
        headingDegrees: 90,
      },
      {channelIndex: 0},
    );

    const result = planner.ingest(
      {
        latitude: -37.8001,
        longitude: 145.2001,
        timestampMs: 1_014_999,
        speedKmh: 30,
        headingDegrees: 92,
      },
      {channelIndex: 0},
    );

    expect(result.fixAccepted).toBe(true);
    expect(result.decision).toEqual({intervalMs: 15_000, reason: 'moving'});
    expect(result.shouldTransmit).toBe(false);
    expect(result.position).toBeNull();
  });

  test('moving fix transmits after its selected interval', () => {
    const planner = new BushMeshPositionPlanner();
    planner.ingest(
      {
        latitude: -37.8,
        longitude: 145.2,
        timestampMs: 1_000_000,
        speedKmh: 30,
        headingDegrees: 90,
      },
      {channelIndex: 0},
    );

    const result = planner.ingest(
      {
        latitude: -37.8002,
        longitude: 145.2002,
        timestampMs: 1_015_000,
        speedKmh: 30,
        headingDegrees: 92,
      },
      {channelIndex: 0},
    );

    expect(result.shouldTransmit).toBe(true);
    expect(result.position?.sequence).toBe(2);
  });

  test('a sharp turn selects the faster 8 second cadence', () => {
    const planner = new BushMeshPositionPlanner();
    planner.ingest(
      {
        latitude: -37.8,
        longitude: 145.2,
        timestampMs: 1_000_000,
        speedKmh: 20,
        headingDegrees: 350,
      },
      {channelIndex: 0},
    );

    const result = planner.ingest(
      {
        latitude: -37.8001,
        longitude: 145.2001,
        timestampMs: 1_008_000,
        speedKmh: 20,
        headingDegrees: 40,
      },
      {channelIndex: 0},
    );

    expect(result.headingChangeDegrees).toBe(50);
    expect(result.decision).toEqual({intervalMs: 8_000, reason: 'turning'});
    expect(result.shouldTransmit).toBe(true);
  });

  test('large convoy gaps accelerate the position cadence to 5 seconds', () => {
    const planner = new BushMeshPositionPlanner();
    planner.ingest(
      {
        latitude: -37.8,
        longitude: 145.2,
        timestampMs: 1_000_000,
        speedKmh: 10,
      },
      {channelIndex: 0},
    );

    const result = planner.ingest(
      {
        latitude: -37.8001,
        longitude: 145.2001,
        timestampMs: 1_005_000,
        speedKmh: 10,
      },
      {channelIndex: 0, convoyGapMeters: 1_500},
    );

    expect(result.decision).toEqual({intervalMs: 5_000, reason: 'large-gap'});
    expect(result.shouldTransmit).toBe(true);
  });

  test('urgent state also uses the 5 second cadence', () => {
    const planner = new BushMeshPositionPlanner();
    planner.ingest(
      {
        latitude: -37.8,
        longitude: 145.2,
        timestampMs: 1_000_000,
        speedKmh: 0,
      },
      {channelIndex: 0},
    );

    const result = planner.ingest(
      {
        latitude: -37.8,
        longitude: 145.2,
        timestampMs: 1_005_000,
        speedKmh: 0,
      },
      {channelIndex: 0, urgent: true},
    );

    expect(result.decision).toEqual({intervalMs: 5_000, reason: 'urgent'});
    expect(result.shouldTransmit).toBe(true);
  });

  test('out-of-order fixes are rejected without changing the transmit sequence', () => {
    const planner = new BushMeshPositionPlanner();
    planner.ingest(
      {latitude: -37.8, longitude: 145.2, timestampMs: 10_000, speedKmh: 0},
      {channelIndex: 0},
    );

    const stale = planner.ingest(
      {latitude: -37.9, longitude: 145.3, timestampMs: 9_999, speedKmh: 0},
      {channelIndex: 0},
    );
    expect(stale.fixAccepted).toBe(false);
    expect(stale.rejectionReason).toContain('older');

    const next = planner.ingest(
      {latitude: -37.8, longitude: 145.2, timestampMs: 100_000, speedKmh: 0},
      {channelIndex: 0},
    );
    expect(next.position?.sequence).toBe(2);
  });

  test('invalid coordinates, poor accuracy and bad channels are rejected', () => {
    expect(
      validateLocationFix({latitude: 91, longitude: 0, timestampMs: 1}),
    ).toContain('Latitude');
    expect(
      validateLocationFix({
        latitude: 0,
        longitude: 0,
        timestampMs: 1,
        accuracyMeters: 1_001,
      }),
    ).toContain('accuracy');

    const planner = new BushMeshPositionPlanner();
    const result = planner.ingest(
      {latitude: 0, longitude: 0, timestampMs: 1},
      {channelIndex: 8},
    );
    expect(result.fixAccepted).toBe(false);
    expect(result.rejectionReason).toContain('channel');
  });
});
