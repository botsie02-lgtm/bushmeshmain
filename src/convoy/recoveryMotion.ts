import {BuddyTail} from './buddyTails';
import {
  bearingDegrees,
  compassDirection,
  distanceMeters,
} from './convoy';
import {recoveryTrailSegmentIsContinuous} from './recoveryTrail';

export type RecoveryObservedMotion = {
  vehicleId: string;
  bearingDegrees: number;
  compassDirection: string;
  distanceMeters: number;
  elapsedSeconds: number;
  speedKmh: number;
  observedAtMs: number;
  ageSeconds: number;
  quality: 'usable' | 'weak';
};

const MIN_USEFUL_MOTION_METERS = 20;
const MIN_MOTION_METERS = 5;
const MIN_USEFUL_ELAPSED_SECONDS = 5;

/**
 * Returns the last observed movement vector from the newest contiguous section
 * of a buddy trail. This is historical evidence only: callers must not project
 * it forward and present the result as a predicted vehicle position.
 */
export function getRecoveryObservedMotion(
  tail: BuddyTail | null | undefined,
  nowMs = Date.now(),
): RecoveryObservedMotion | null {
  if (!tail || tail.points.length < 2) {
    return null;
  }

  const endIndex = tail.points.length - 1;
  const end = tail.points[endIndex];
  let startIndex = endIndex - 1;

  if (!recoveryTrailSegmentIsContinuous(tail.points[startIndex], end)) {
    return null;
  }

  while (startIndex > 0) {
    const previous = tail.points[startIndex - 1];
    const current = tail.points[startIndex];
    if (!recoveryTrailSegmentIsContinuous(previous, current)) {
      break;
    }

    startIndex -= 1;
    const candidateDistance = distanceMeters(tail.points[startIndex], end);
    if (candidateDistance >= MIN_USEFUL_MOTION_METERS) {
      break;
    }
  }

  const start = tail.points[startIndex];
  const elapsedSeconds = Math.max(
    0,
    (end.receivedAtMs - start.receivedAtMs) / 1000,
  );
  const travelledMeters = distanceMeters(start, end);
  if (elapsedSeconds <= 0 || travelledMeters < MIN_MOTION_METERS) {
    return null;
  }

  const bearing = bearingDegrees(start, end);
  const quality =
    travelledMeters >= MIN_USEFUL_MOTION_METERS &&
    elapsedSeconds >= MIN_USEFUL_ELAPSED_SECONDS
      ? 'usable'
      : 'weak';

  return {
    vehicleId: tail.vehicleId,
    bearingDegrees: bearing,
    compassDirection: compassDirection(bearing),
    distanceMeters: travelledMeters,
    elapsedSeconds,
    speedKmh: (travelledMeters / elapsedSeconds) * 3.6,
    observedAtMs: end.receivedAtMs,
    ageSeconds: Math.max(0, Math.floor((nowMs - end.receivedAtMs) / 1000)),
    quality,
  };
}
