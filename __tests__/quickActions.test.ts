import {BushMeshQuickActionCode} from '../src/bushmesh/protocol';
import {getQuickActionTemporalDecision} from '../src/drive/quickActions';

describe('quick-action temporal decisions', () => {
  const nowMs = 1_800_000_000_000;

  test('uses the action default TTL when the packet TTL is zero', () => {
    const packetTimestampSeconds = Math.floor(nowMs / 1000) - 30;
    const decision = getQuickActionTemporalDecision({
      action: BushMeshQuickActionCode.Stop,
      packetTimestampSeconds,
      ttlSeconds: 0,
      nowMs,
    });

    expect(decision.state).toBe('active');
    expect(decision.effectiveTtlSeconds).toBe(120);
  });

  test('marks expired packets as non-actionable', () => {
    const decision = getQuickActionTemporalDecision({
      action: BushMeshQuickActionCode.Hazard,
      packetTimestampSeconds: Math.floor(nowMs / 1000) - 901,
      ttlSeconds: 900,
      nowMs,
    });

    expect(decision.state).toBe('expired');
  });

  test('accepts a small amount of future clock skew', () => {
    const decision = getQuickActionTemporalDecision({
      action: BushMeshQuickActionCode.Help,
      packetTimestampSeconds: Math.floor(nowMs / 1000) + 60,
      ttlSeconds: 300,
      nowMs,
    });

    expect(decision.state).toBe('active');
  });

  test('withholds packets that are too far in the future', () => {
    const decision = getQuickActionTemporalDecision({
      action: BushMeshQuickActionCode.Help,
      packetTimestampSeconds: Math.floor(nowMs / 1000) + 121,
      ttlSeconds: 300,
      nowMs,
    });

    expect(decision.state).toBe('future');
  });

  test('respects an explicit shorter TTL', () => {
    const decision = getQuickActionTemporalDecision({
      action: BushMeshQuickActionCode.Regroup,
      packetTimestampSeconds: Math.floor(nowMs / 1000) - 61,
      ttlSeconds: 60,
      nowMs,
    });

    expect(decision.state).toBe('expired');
    expect(decision.effectiveTtlSeconds).toBe(60);
  });
});
