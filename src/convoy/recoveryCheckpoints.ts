import {BuddyTail, BuddyTailPoint} from './buddyTails';
import {distanceMeters} from './convoy';
import {
  recoveryTrailGapSeconds,
  recoveryTrailSegmentIsContinuous,
} from './recoveryTrail';

export type RecoveryTrailBreak = {
  before: BuddyTailPoint;
  after: BuddyTailPoint;
  beforeIndex: number;
  afterIndex: number;
  timeGapSeconds: number;
  distanceJumpMeters: number;
};

export type RecoveryCheckpointSet = {
  vehicleId: string;
  latestFix: BuddyTailPoint;
  latestBreak: RecoveryTrailBreak | null;
  lastContinuousBeforeBreak: BuddyTailPoint | null;
  firstFixAfterBreak: BuddyTailPoint | null;
  gapDistanceMeters: number | null;
};

export function deriveRecoveryCheckpoints(
  tail: BuddyTail | null | undefined,
): RecoveryCheckpointSet | null {
  if (!tail || tail.points.length === 0) {
    return null;
  }

  let latestBreak: RecoveryTrailBreak | null = null;

  for (let index = 1; index < tail.points.length; index += 1) {
    const before = tail.points[index - 1];
    const after = tail.points[index];
    if (recoveryTrailSegmentIsContinuous(before, after)) {
      continue;
    }

    latestBreak = {
      before,
      after,
      beforeIndex: index - 1,
      afterIndex: index,
      timeGapSeconds: recoveryTrailGapSeconds(before, after),
      distanceJumpMeters: distanceMeters(before, after),
    };
  }

  return {
    vehicleId: tail.vehicleId,
    latestFix: tail.points[tail.points.length - 1],
    latestBreak,
    lastContinuousBeforeBreak: latestBreak?.before ?? null,
    firstFixAfterBreak: latestBreak?.after ?? null,
    gapDistanceMeters: latestBreak?.distanceJumpMeters ?? null,
  };
}
