import {ConvoyFreshness} from './convoy';

export type ConvoyGapState = 'unknown' | 'good' | 'caution' | 'critical' | 'lost';

export type ConvoyGapInput = {
  distanceMeters: number | null;
  freshness: ConvoyFreshness;
  cautionMeters?: number;
  criticalMeters?: number;
};

export type ConvoyGapDecision = {
  state: ConvoyGapState;
  distanceMeters: number | null;
  shouldAcceleratePositionUpdates: boolean;
  shouldAlertDriver: boolean;
  detail: string;
};

/**
 * Classifies convoy separation independently from map rendering. A stale/lost
 * position is never treated as a trustworthy current gap, even if its last
 * coordinate happens to be close.
 */
export function getConvoyGapDecision(
  input: ConvoyGapInput,
): ConvoyGapDecision {
  const cautionMeters = input.cautionMeters ?? 600;
  const criticalMeters = input.criticalMeters ?? 1_000;

  if (criticalMeters <= cautionMeters) {
    throw new Error('Critical convoy gap must be greater than caution gap.');
  }

  if (input.freshness === 'lost') {
    return {
      state: 'lost',
      distanceMeters: input.distanceMeters,
      shouldAcceleratePositionUpdates: true,
      shouldAlertDriver: true,
      detail: 'Vehicle position is lost; last known gap is not current.',
    };
  }

  if (input.freshness === 'stale' || input.distanceMeters === null) {
    return {
      state: 'unknown',
      distanceMeters: input.distanceMeters,
      shouldAcceleratePositionUpdates: true,
      shouldAlertDriver: input.freshness === 'stale',
      detail:
        input.freshness === 'stale'
          ? 'Vehicle position is stale; current convoy gap is unknown.'
          : 'Convoy gap is unavailable.',
    };
  }

  if (input.distanceMeters >= criticalMeters) {
    return {
      state: 'critical',
      distanceMeters: input.distanceMeters,
      shouldAcceleratePositionUpdates: true,
      shouldAlertDriver: true,
      detail: `Convoy gap is ${Math.round(input.distanceMeters)} m.`,
    };
  }

  if (input.distanceMeters >= cautionMeters) {
    return {
      state: 'caution',
      distanceMeters: input.distanceMeters,
      shouldAcceleratePositionUpdates: true,
      shouldAlertDriver: false,
      detail: `Convoy gap is widening (${Math.round(input.distanceMeters)} m).`,
    };
  }

  return {
    state: 'good',
    distanceMeters: input.distanceMeters,
    shouldAcceleratePositionUpdates: false,
    shouldAlertDriver: false,
    detail: `Convoy gap is ${Math.round(input.distanceMeters)} m.`,
  };
}
