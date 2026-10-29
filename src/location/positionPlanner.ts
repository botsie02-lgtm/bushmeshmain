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

function validateChannelIndex(channelIndex: number): string | null {
  return Number.isInteger(channelIndex) && channelIndex >= 0 && channelIndex <= 7
    ? null
    : 'Convoy channel index must be between 0 and 7.';
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

    const channelError = validateChannelIndex(context.channelIndex);
    if (channelError) {
      return {
        fixAccepted: false,
        rejectionReason: channelError,
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

    return {
      fixAccepted: true,
      rejectionReason: null,
      decision,
      headingChangeDegrees,
      shouldTransmit: true,
      position: this.buildPosition(fix, context.channelIndex, 0, true),
    };
  }

  /**
   * Builds an immediate transmission from a fix that the location session has
   * already accepted. This is used for explicit peer position requests and
   * shares the same sequence counter as adaptive broadcasts.
   *
   * The GPS timestamp is preserved: requesting a fix never makes an old fix
   * look newer than it really is.
   */
  buildImmediateTransmission(
    fix: BushMeshLocationFix,
    channelIndex: number,
    flags = 0,
  ): PlannedBushMeshPosition {
    const validationError = validateLocationFix(fix);
    if (validationError) {
      throw new Error(validationError);
    }

    const channelError = validateChannelIndex(channelIndex);
    if (channelError) {
      throw new Error(channelError);
    }

    return this.buildPosition(fix, channelIndex, flags, true);
  }

  reset(): void {
    this.lastFixTimestampMs = null;
    this.lastHeadingDegrees = null;
    this.lastTransmittedAtMs = null;
    this.nextSequence = 1;
  }

  private buildPosition(
    fix: BushMeshLocationFix,
    channelIndex: number,
    flags: number,
    markTransmitted: boolean,
  ): PlannedBushMeshPosition {
    const sequence = this.nextSequence;
    this.nextSequence = sequence >= 0xffff ? 1 : sequence + 1;
    if (markTransmitted) {
      this.lastTransmittedAtMs = Math.max(
        this.lastTransmittedAtMs ?? 0,
        fix.timestampMs,
      );
    }

    return {
      channelIndex,
      sequence,
      timestampSeconds: Math.floor(fix.timestampMs / 1000),
      latitude: fix.latitude,
      longitude: fix.longitude,
      altitudeMeters: fix.altitudeMeters ?? null,
      speedKmh: fix.speedKmh ?? null,
      headingDegrees:
        fix.headingDegrees == null
          ? null
          : normalizeHeadingDegrees(fix.headingDegrees),
      accuracyMeters: fix.accuracyMeters ?? null,
      flags,
    };
  }
}
