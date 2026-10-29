import {BuddyTail, BuddyTailPoint} from '../convoy/buddyTails';
import {deriveRecoveryCheckpoints} from '../convoy/recoveryCheckpoints';
import {BushMeshGeoJsonPosition} from './operationalPictureGeoJson';

export type RecoveryCheckpointKind =
  | 'latest-fix'
  | 'before-gap'
  | 'after-gap';

export type RecoveryCheckpointProperties = {
  id: string;
  vehicleId: string;
  kind: RecoveryCheckpointKind;
  receivedAtMs: number;
  ageSeconds: number;
  sequence: number;
};

export type RecoveryCheckpointFeature = {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'Point';
    coordinates: BushMeshGeoJsonPosition;
  };
  properties: RecoveryCheckpointProperties;
};

export type RecoveryCheckpointFeatureCollection = {
  type: 'FeatureCollection';
  features: RecoveryCheckpointFeature[];
};

function samePoint(left: BuddyTailPoint, right: BuddyTailPoint): boolean {
  return (
    left.receivedAtMs === right.receivedAtMs &&
    left.sequence === right.sequence &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude
  );
}

function checkpointFeature(
  vehicleId: string,
  kind: RecoveryCheckpointKind,
  point: BuddyTailPoint,
  nowMs: number,
): RecoveryCheckpointFeature {
  const id = `recovery-checkpoint:${vehicleId}:${kind}:${point.sequence}`;
  return {
    type: 'Feature',
    id,
    geometry: {
      type: 'Point',
      coordinates: [point.longitude, point.latitude],
    },
    properties: {
      id,
      vehicleId,
      kind,
      receivedAtMs: point.receivedAtMs,
      ageSeconds: Math.max(0, Math.floor((nowMs - point.receivedAtMs) / 1000)),
      sequence: point.sequence,
    },
  };
}

export function recoveryCheckpointsToGeoJson(
  tail: BuddyTail | null | undefined,
  nowMs = Date.now(),
): RecoveryCheckpointFeatureCollection {
  const checkpoints = deriveRecoveryCheckpoints(tail);
  if (!checkpoints) {
    return {type: 'FeatureCollection', features: []};
  }

  const features: RecoveryCheckpointFeature[] = [
    checkpointFeature(
      checkpoints.vehicleId,
      'latest-fix',
      checkpoints.latestFix,
      nowMs,
    ),
  ];

  if (checkpoints.lastContinuousBeforeBreak) {
    features.push(
      checkpointFeature(
        checkpoints.vehicleId,
        'before-gap',
        checkpoints.lastContinuousBeforeBreak,
        nowMs,
      ),
    );
  }

  if (
    checkpoints.firstFixAfterBreak &&
    !samePoint(checkpoints.firstFixAfterBreak, checkpoints.latestFix)
  ) {
    features.push(
      checkpointFeature(
        checkpoints.vehicleId,
        'after-gap',
        checkpoints.firstFixAfterBreak,
        nowMs,
      ),
    );
  }

  return {type: 'FeatureCollection', features};
}
