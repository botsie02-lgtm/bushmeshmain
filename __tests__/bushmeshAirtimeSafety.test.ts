import {
  BushMeshAirtimeBudget,
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
  encodeBushMeshWire,
  estimateLoRaAirtimeMs,
  inspectBushMeshWireFrame,
} from '../src/bushmesh/protocol';

describe('Bushmesh airtime planning and frame safety', () => {
  test('estimates higher LoRa airtime for slower spreading factors', () => {
    const sf7 = estimateLoRaAirtimeMs(40, {
      spreadingFactor: 7,
      bandwidthHz: 125000,
    });
    const sf12 = estimateLoRaAirtimeMs(40, {
      spreadingFactor: 12,
      bandwidthHz: 125000,
    });

    expect(sf7).toBeGreaterThan(0);
    expect(sf12).toBeGreaterThan(sf7);
  });

  test('reserves configurable airtime for emergency traffic', () => {
    const budget = new BushMeshAirtimeBudget(60000, 1000, 300);

    budget.record(900, BushMeshPriority.DirectMessage, 1000);
    expect(budget.canTransmit(150, BushMeshPriority.DirectMessage, 1000)).toBe(
      false,
    );
    expect(budget.canTransmit(150, BushMeshPriority.Emergency, 1000)).toBe(true);
    budget.record(150, BushMeshPriority.Emergency, 1000);
    expect(budget.remainingAirtimeMs(BushMeshPriority.DirectMessage, 1000)).toBe(
      0,
    );
  });

  test('allows airtime budget to recover after the rolling window', () => {
    const budget = new BushMeshAirtimeBudget(1000, 500);
    budget.record(500, BushMeshPriority.Telemetry, 1000);
    expect(budget.canTransmit(1, BushMeshPriority.Telemetry, 1999)).toBe(false);
    expect(budget.canTransmit(500, BushMeshPriority.Telemetry, 2000)).toBe(true);
  });

  test('accepts valid wire frames and rejects excessive TTL or payload size', () => {
    const normal = encodeBushMeshWire({
      type: BushMeshPacketType.Message,
      priority: BushMeshPriority.DirectMessage,
      compression: BushMeshCompressionProfile.Raw,
      messageId: 1,
      storeAndForward: true,
      ttlHops: 3,
      payload: [1, 2, 3],
    });

    expect(inspectBushMeshWireFrame(normal).ok).toBe(true);

    const excessiveTtl = encodeBushMeshWire({
      type: BushMeshPacketType.Message,
      messageId: 2,
      storeAndForward: true,
      ttlHops: 30,
      payload: [1],
    });
    expect(inspectBushMeshWireFrame(excessiveTtl)).toEqual({
      ok: false,
      reason: 'ttl-too-large',
    });

    expect(
      inspectBushMeshWireFrame(normal, {maxPayloadBytes: 2}),
    ).toEqual({ok: false, reason: 'payload-too-large'});
  });

  test('rejects malformed or oversized input without throwing', () => {
    expect(inspectBushMeshWireFrame([0x00, 0x01])).toEqual({
      ok: false,
      reason: 'invalid-magic-or-short-frame',
    });

    const huge = new Array(600).fill(0);
    expect(inspectBushMeshWireFrame(huge)).toEqual({
      ok: false,
      reason: 'wire-frame-too-large',
    });
  });
});
