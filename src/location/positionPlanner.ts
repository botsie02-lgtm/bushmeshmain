import {BushMeshPosition} from '../bushmesh/protocol';
import {
  AdaptivePositionDecision,
  getAdaptivePositionDecision,
} from './adaptivePosition';

export type BushMeshLocationFix = {
  latitude: number;
  longitude: number;
  timestampMs: number;
  altitudeMeters?: number | null;
  speedKmh?: number | null;
  headingDegrees?: number | null;
  accuracyMeters?: number | null;
};

export type PositionPlannerContext = {
  channelIndex: number;
  convoyGapMeters?: number | null;
  urgent?: boolean;
};

export type PlannedBushMeshPosition = Omit<BushMeshPosition, 'senderId'> & {
  channelIndex: number;
};

export type PositionPlanResult = {
  fixAccepted: boolean;
  rejectionReason: string | null;
  decision: AdaptivePositionDecision | null;
  headingChangeDegrees: number | null;
  shouldTransmit: boolean;
  position: PlannedBushMeshPosition | null;
};

const MAX_REASONABLE_ACCURACY_METERS = 1_000;

function isFiniteOrNull(value: number | null | undefined): boolean {
  return value == null || Number.isFinite(value);
}

export function normalizeHeadingDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function headingDifferenceDegrees(
  previous: number,
  next: number,
): number {
  const a = normalizeHeadingDegrees(previous);
  const b = normalizeHeadingDegrees(next);
  const difference = Math.abs(a - b);
  return Math.min(difference, 360 - difference);
}

export function validateLocationFix(fix: BushMeshLocationFix): string | null {
  if (!Number.isFinite(fix.latitude) || fix.latitude < -90 || fix.latitude > 90) {
    return 'Latitude is outside the valid range.';
  }

  if (
    !Number.isFinite(fix.longitude) ||
    fix.longitude < -180 ||
    fix.longitude > 180
  ) {
    return 'Longitude is outside the valid range.';
  }

  if (!Number.isFinite(fix.timestampMs) || fix.timestampMs < 0) {
    return 'Location timestamp is invalid.';
  }

  if (!isFiniteOrNull(fix.altitudeMeters)) {
    return 'Altitude is invalid.';
  }

  if (!isFiniteOrNull(fix.speedKmh) || (fix.speedKmh ?? 0) < 0) {
    return 'Speed is invalid.';
  }

  if (!isFiniteOrNull(fix.headingDegrees)) {
    return 'Heading is invalid.';
  }

  if (
    !isFiniteOrNull(fix.accuracyMeters) ||
    (fix.accuracyMeters ?? 0) < 0 ||
    (fix.accuracyMeters ?? 0) > MAX_REASONABLE_ACCURACY_METERS
  ) {
    return 'Location accuracy is invalid or too poor to broadcast.';
  }

  return null;
}

/**
 * Stateful, transport-neutral position planner.
 *
 * Every accepted GPS fix can update local UI state, but only fixes selected by
 * this planner should consume LoRa airtime. The radio session injects the
 * sender identity later, keeping GPS and radio ownership separate.
 */
export class BushMeshPositionPlanner {
  private lastFixTimestampMs: number | null = null;
  private lastHeadingDegrees: number | null = null;
  private lastTransmittedAtMs: number | null = null;
  private nextSequence = 1;

  ingest(
    fix: BushMeshLocationFix,
    context: PositionPlannerContext,
  ): PositionPlanResult {
    const rejectionReason = validateLocationFix(fix);
    if (rejectionReason) {
      return {
        fixAccepted: false,
        rejectionReason,
        decision: null,
        headingChangeDegrees: null,
        shouldTransmit: false,
        position: null,
      };
    }

    if (
      this.lastFixTimestampMs !== null &&
      fix.timestampMs <= this.lastFixTimestampMs
    ) {
      return {
        fixAccepted: false,
        rejectionReason: 'Location fix is older than the latest accepted fix.',
        decision: null,
        headingChangeDegrees: null,
        shouldTransmit: false,
        position: null,
      };
    }

    if (
      !Number.isInteger(context.channelIndex) ||
      context.channelIndex < 0 ||
      context.channelIndex > 7
    ) {
      return {
        fixAccepted: false,
        rejectionReason: 'Convoy channel index must be between 0 and 7.',
        decision: null,
        headingChangeDegrees: null,
        shouldTransmit: false,
        position: null,
      };
    }

    const normalizedHeading =
      fix.headingDegrees == null
        ? null
        : normalizeHeadingDegrees(fix.headingDegrees);
    const headingChangeDegrees =
      normalizedHeading !== null && this.lastHeadingDegrees !== null
        ? headingDifferenceDegrees(this.lastHeadingDegrees, normalizedHeading)
        : null;

    const decision = getAdaptivePositionDecision({
      speedKmh: fix.speedKmh ?? null,
      headingChangeDegrees,
      convoyGapMeters: context.convoyGapMeters ?? null,
      urgent: context.urgent,
    });

    const shouldTransmit =
      this.lastTransmittedAtMs === null ||
      fix.timestampMs - this.lastTransmittedAtMs >= decision.intervalMs;

    this.lastFixTimestampMs = fix.timestampMs;
    if (normalizedHeading !== null) {
      this.lastHeadingDegrees = normalizedHeading;
    }

    if (!shouldTransmit) {
      return {
        fixAccepted: true,
        rejectionReason: null,
        decision,
        headingChangeDegrees,
        shouldTransmit: false,
        position: null,
      };
    }

    const sequence = this.nextSequence;
    this.nextSequence = sequence >= 0xffff ? 1 : sequence + 1;
    this.lastTransmittedAtMs = fix.timestampMs;

    return {
      fixAccepted: true,
      rejectionReason: null,
      decision,
      headingChangeDegrees,
      shouldTransmit: true,
      position: {
        channelIndex: context.channelIndex,
        sequence,
        timestampSeconds: Math.floor(fix.timestampMs / 1000),
        latitude: fix.latitude,
        longitude: fix.longitude,
        altitudeMeters: fix.altitudeMeters ?? null,
        speedKmh: fix.speedKmh ?? null,
        headingDegrees: normalizedHeading,
        accuracyMeters: fix.accuracyMeters ?? null,
      },
    };
  }

  reset(): void {
    this.lastFixTimestampMs = null;
    this.lastHeadingDegrees = null;
    this.lastTransmittedAtMs = null;
    this.nextSequence = 1;
  }
}
