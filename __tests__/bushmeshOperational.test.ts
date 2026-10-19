import {
  BushMeshDeliveryQueue,
  BushMeshDistressType,
  BushMeshPriority,
  LocationPrecision,
  decodeDistressPayload,
  decodeTelemetryPayload,
  encodeDistressPayload,
  encodeTelemetryPayload,
  restoreDeliveryQueue,
  saveDeliveryQueue,
} from '../src/bushmesh/protocol';

describe('Bushmesh operational payloads and persistence', () => {
  test('encodes distress type, precise location and battery compactly', () => {
    const encoded = encodeDistressPayload({
      type: BushMeshDistressType.Medical,
      location: {
        latitude: -37.784873,
        longitude: 145.30086,
        precision: LocationPrecision.Approx1M,
      },
      batteryPercent: 47,
    });

    expect(encoded).toHaveLength(9);
    const decoded = decodeDistressPayload(encoded);
    expect(decoded.type).toBe(BushMeshDistressType.Medical);
    expect(decoded.batteryPercent).toBe(47);
    expect(Math.abs(decoded.location!.latitude - -37.784873)).toBeLessThan(0.00002);
  });

  test('round-trips sparse telemetry using only flagged fields', () => {
    const encoded = encodeTelemetryPayload({
      batteryPercent: 76,
      temperatureC: 18.4,
      altitudeMetres: 315,
      headingDegrees: 271,
    });
    const decoded = decodeTelemetryPayload(encoded);

    expect(decoded).toEqual({
      batteryPercent: 76,
      temperatureC: 18.4,
      altitudeMetres: 315,
      headingDegrees: 271,
    });
    expect(encoded.length).toBeLessThan(12);
  });

  test('saves and restores store-and-forward state through a generic local store', async () => {
    const values = new Map<string, string>();
    const store = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    };

    const source = new BushMeshDeliveryQueue();
    source.enqueue(55, [0xb5, 0x4d], {
      priority: BushMeshPriority.DirectMessage,
      now: 1000,
      ttlMs: 10000,
      maxAttempts: 5,
    });
    source.markAttempt(55, {now: 1200, retryDelayMs: 500});

    await saveDeliveryQueue(source, store);

    const restored = new BushMeshDeliveryQueue();
    expect(await restoreDeliveryQueue(restored, store, {now: 1500})).toBe(1);
    expect(restored.snapshot()[0]).toMatchObject({
      messageId: 55,
      attempts: 1,
      nextAttemptAt: 1700,
    });
  });

  test('does not restore expired queued traffic', async () => {
    const source = new BushMeshDeliveryQueue();
    source.enqueue(56, [1, 2, 3], {now: 1000, ttlMs: 100});
    const stored = JSON.stringify({version: 1, messages: source.snapshot()});
    const store = {
      getItem: async () => stored,
      setItem: async () => undefined,
    };
    const restored = new BushMeshDeliveryQueue();

    expect(await restoreDeliveryQueue(restored, store, {now: 2000})).toBe(0);
    expect(restored.size()).toBe(0);
  });
});
