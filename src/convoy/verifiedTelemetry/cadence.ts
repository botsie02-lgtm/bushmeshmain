import {
  BushMeshConvoyStatus,
} from '../../bushmesh/protocol/convoy';
import {LocationPrecision} from '../../bushmesh/protocol/location';
import type {BushMeshLocationFix} from '../../location/positionPlanner';
import type {VerifiedTelemetryMember} from './contracts';

const EARTH_RADIUS_M = 6_371_000;
export const TELEMETRY_MIN_INTERVAL_MS = 30_000;
export const TELEMETRY_HEARTBEAT_MS = 180_000;
export const TELEMETRY_MAX_FIX_AGE_MS = 30_000;
export const TELEMETRY_MAX_FUTURE_SKEW_MS = 5_000;
export const TELEMETRY_MAX_ACCURACY_M = 100;
export const TELEMETRY_MAX_BURSTS_PER_TEN_MIN = 6;

export type PositionDecision =
  | {kind: 'suppressed'; reason: string}
  | {kind: 'ready'; location: BushMeshConvoyStatus['location']; unavailable: boolean;
      fix: BushMeshLocationFix | null};

function geographicDistance(a: BushMeshLocationFix, b: BushMeshLocationFix): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const hav = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(hav)));
}

function headingDifference(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null || b == null) return 0;
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

export function isFreshAndroidFix(fix: BushMeshLocationFix, nowMs: number): boolean {
  return (
    Number.isFinite(fix.latitude) && fix.latitude >= -90 && fix.latitude <= 90 &&
    Number.isFinite(fix.longitude) && fix.longitude >= -180 && fix.longitude <= 180 &&
    Number.isSafeInteger(fix.timestampMs) &&
    fix.timestampMs <= nowMs + TELEMETRY_MAX_FUTURE_SKEW_MS &&
    fix.timestampMs >= nowMs - TELEMETRY_MAX_FIX_AGE_MS &&
    typeof fix.accuracyMeters === 'number' &&
    Number.isFinite(fix.accuracyMeters) &&
    fix.accuracyMeters >= 0 && fix.accuracyMeters <= TELEMETRY_MAX_ACCURACY_M &&
    (fix.speedKmh == null || (Number.isFinite(fix.speedKmh) &&
      fix.speedKmh >= 0 && fix.speedKmh <= 300)) &&
    (fix.headingDegrees == null || (Number.isFinite(fix.headingDegrees) &&
      fix.headingDegrees >= 0 && fix.headingDegrees <= 360))
  );
}

/**
 * Suppression only; never owns GPS, native radio or encryption. Receipts are
 * local queue acknowledgements, NOT remote peer-delivery acknowledgements.
 */
export class ConservativePositionCadence {
  private previous: BushMeshLocationFix | null = null;
  private queuedKind: 'none' | 'position' | 'unavailable' = 'none';
  private lastQueuedAt: number | null = null;
  private readonly burstTimes: number[] = [];

  reset(): void {
    this.previous = null;
    this.queuedKind = 'none';
    this.lastQueuedAt = null;
    this.burstTimes.length = 0;
  }

  decide(fix: BushMeshLocationFix | null, nowMs: number): PositionDecision {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      return {kind: 'suppressed', reason: 'invalid-clock'};
    }
    const fresh = fix !== null && isFreshAndroidFix(fix, nowMs);
    const candidate = fresh ? fix : null;

    if (!candidate && this.queuedKind !== 'position') {
      return {kind: 'suppressed', reason: 'no-fresh-android-gps'};
    }
    if (this.lastQueuedAt !== null && nowMs - this.lastQueuedAt < TELEMETRY_MIN_INTERVAL_MS) {
      return {kind: 'suppressed', reason: 'minimum-interval'};
    }
    this.burstTimes.splice(0, this.burstTimes.findIndex(t => t > nowMs - 600_000) < 0
      ? this.burstTimes.length
      : this.burstTimes.findIndex(t => t > nowMs - 600_000));
    if (this.burstTimes.length >= TELEMETRY_MAX_BURSTS_PER_TEN_MIN) {
      return {kind: 'suppressed', reason: 'airtime-rate-cap'};
    }
    if (!candidate) {
      return {kind: 'ready', location: undefined, unavailable: true, fix: null};
    }
    if (this.queuedKind === 'position' && this.previous &&
        this.lastQueuedAt !== null && nowMs - this.lastQueuedAt < TELEMETRY_HEARTBEAT_MS) {
      const moved = geographicDistance(this.previous, candidate) >= 50;
      const turned = candidate.speedKmh != null && candidate.speedKmh >= 5 &&
        headingDifference(this.previous.headingDegrees, candidate.headingDegrees) >= 30;
      if (!moved && !turned) {
        return {kind: 'suppressed', reason: 'stationary-or-no-significant-change'};
      }
    }
    return {
      kind: 'ready',
      location: {
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        precision: candidate.accuracyMeters! <= 15
          ? LocationPrecision.Approx10M
          : LocationPrecision.Approx100M,
      },
      unavailable: false,
      fix: candidate,
    };
  }

  markQueued(decision: Extract<PositionDecision, {kind: 'ready'}>, nowMs: number): void {
    this.lastQueuedAt = nowMs;
    this.queuedKind = decision.unavailable ? 'unavailable' : 'position';
    this.previous = decision.fix ? {...decision.fix} : null;
    this.burstTimes.push(nowMs);
  }
}

export function encodeGpsConvoyStatus(
  local: VerifiedTelemetryMember,
  protocolConvoyId: number,
  sequence: number,
  decision: Extract<PositionDecision, {kind: 'ready'}>,
): BushMeshConvoyStatus {
  const fix = decision.fix;
  return {
    convoyId: protocolConvoyId,
    nodeId: local.nodeId,
    sequence,
    orderIndex: local.orderIndex,
    role: local.role,
    ...(decision.unavailable
      ? {locationUnavailable: true}
      : {location: decision.location}),
    ...(fix && fix.speedKmh != null ? {speedKph: fix.speedKmh} : {}),
    ...(fix && fix.headingDegrees != null
      ? {headingDegrees: Math.floor(fix.headingDegrees % 360)} : {}),
  };
}
