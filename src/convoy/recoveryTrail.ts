import {BuddyTail, BuddyTailPoint, buddyTailDistanceMeters} from './buddyTails';
import {distanceMeters} from './convoy';

export type RecoveryTrailState = 'usable' | 'aging' | 'stale' | 'broken';

export type RecoveryTrailAssessment = {
  vehicleId: string;
  state: RecoveryTrailState;
  safeAsContext: boolean;
  pointCount: number;
  retainedDistanceMeters: number;
  lastPointAgeSeconds: number;
  largestTimeGapSeconds: number;
  largestSpatialJumpMeters: number;
  reason: string;
};

const USABLE_LAST_POINT_AGE_SECONDS = 120;
const AGING_LAST_POINT_AGE_SECONDS = 600;
const MAX_CONTIGUOUS_TIME_GAP_SECONDS = 180;
const MAX_CONTIGUOUS_SPATIAL_JUMP_METERS = 1_500;

function gapSeconds(left: BuddyTailPoint, right: BuddyTailPoint): number {
  return Math.max(0, (right.receivedAtMs - left.receivedAtMs) / 1000);
}

export function assessRecoveryTrail(
  tail: BuddyTail | null | undefined,
  nowMs = Date.now(),
): RecoveryTrailAssessment | null {
  if (!tail || tail.points.length === 0) {
    return null;
  }

  const lastPoint = tail.points[tail.points.length - 1];
  const lastPointAgeSeconds = Math.max(
    0,
    Math.floor((nowMs - lastPoint.receivedAtMs) / 1000),
  );

  let largestTimeGapSeconds = 0;
  let largestSpatialJumpMeters = 0;
  let broken = false;

  for (let index = 1; index < tail.points.length; index += 1) {
    const previous = tail.points[index - 1];
    const current = tail.points[index];
    const timeGap = gapSeconds(previous, current);
    const spatialJump = distanceMeters(previous, current);

    largestTimeGapSeconds = Math.max(largestTimeGapSeconds, timeGap);
    largestSpatialJumpMeters = Math.max(largestSpatialJumpMeters, spatialJump);

    if (
      timeGap > MAX_CONTIGUOUS_TIME_GAP_SECONDS ||
      spatialJump > MAX_CONTIGUOUS_SPATIAL_JUMP_METERS
    ) {
      broken = true;
    }
  }

  if (broken) {
    return {
      vehicleId: tail.vehicleId,
      state: 'broken',
      safeAsContext: false,
      pointCount: tail.points.length,
      retainedDistanceMeters: buddyTailDistanceMeters(tail),
      lastPointAgeSeconds,
      largestTimeGapSeconds,
      largestSpatialJumpMeters,
      reason:
        'The retained trail contains a large time or distance jump and should not be treated as continuous travel.',
    };
  }

  if (lastPointAgeSeconds <= USABLE_LAST_POINT_AGE_SECONDS) {
    return {
      vehicleId: tail.vehicleId,
      state: 'usable',
      safeAsContext: tail.points.length >= 2,
      pointCount: tail.points.length,
      retainedDistanceMeters: buddyTailDistanceMeters(tail),
      lastPointAgeSeconds,
      largestTimeGapSeconds,
      largestSpatialJumpMeters,
      reason:
        tail.points.length >= 2
          ? 'Recent, contiguous fixes are available as recovery context.'
          : 'Only one recent fix is available; there is no retained path yet.',
    };
  }

  if (lastPointAgeSeconds <= AGING_LAST_POINT_AGE_SECONDS) {
    return {
      vehicleId: tail.vehicleId,
      state: 'aging',
      safeAsContext: tail.points.length >= 2,
      pointCount: tail.points.length,
      retainedDistanceMeters: buddyTailDistanceMeters(tail),
      lastPointAgeSeconds,
      largestTimeGapSeconds,
      largestSpatialJumpMeters,
      reason:
        'The trail is contiguous but the newest fix is aging; use it only as last-known movement context.',
    };
  }

  return {
    vehicleId: tail.vehicleId,
    state: 'stale',
    safeAsContext: false,
    pointCount: tail.points.length,
    retainedDistanceMeters: buddyTailDistanceMeters(tail),
    lastPointAgeSeconds,
    largestTimeGapSeconds,
    largestSpatialJumpMeters,
    reason:
      'The newest retained fix is too old to present the trail as current recovery guidance.',
  };
}
