import {BuddyTail} from '../convoy/buddyTails';
import {distanceMeters} from '../convoy/convoy';
import {RecoveryTrailState, assessRecoveryTrail} from '../convoy/recoveryTrail';
import {BushMeshGeoJsonPosition} from './operationalPictureGeoJson';

export type RecoveryTrailSegmentState =
  | 'contiguous'
  | 'time-gap'
  | 'spatial-jump';

export type RecoveryTrailSegmentProperties = {
  id: string;
  vehicleId: string;
  trailState: RecoveryTrailState;
  segmentState: RecoveryTrailSegmentState;
  fromAgeSeconds: number;
  toAgeSeconds: number;
  elapsedSeconds: number;
  distanceMeters: number;
  safeAsContext: boolean;
};

export type RecoveryTrailSegmentFeature = {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'LineString';
    coordinates: [BushMeshGeoJsonPosition, BushMeshGeoJsonPosition];
  };
  properties: RecoveryTrailSegmentProperties;
};

export type RecoveryTrailFeatureCollection = {
  type: 'FeatureCollection';
  features: RecoveryTrailSegmentFeature[];
};

const TIME_GAP_SECONDS = 180;
const SPATIAL_JUMP_METERS = 1_500;

export function recoveryTrailToGeoJson(
  tail: BuddyTail | null | undefined,
  nowMs = Date.now(),
): RecoveryTrailFeatureCollection {
  const assessment = assessRecoveryTrail(tail, nowMs);
  if (!tail || !assessment || tail.points.length < 2) {
    return {type: 'FeatureCollection', features: []};
  }

  const features: RecoveryTrailSegmentFeature[] = [];

  for (let index = 1; index < tail.points.length; index += 1) {
    const from = tail.points[index - 1];
    const to = tail.points[index];
    const elapsedSeconds = Math.max(0, (to.receivedAtMs - from.receivedAtMs) / 1000);
    const segmentDistanceMeters = distanceMeters(from, to);

    const segmentState: RecoveryTrailSegmentState =
      elapsedSeconds > TIME_GAP_SECONDS
        ? 'time-gap'
        : segmentDistanceMeters > SPATIAL_JUMP_METERS
          ? 'spatial-jump'
          : 'contiguous';

    features.push({
      type: 'Feature',
      id: `recovery:${tail.vehicleId}:${index - 1}-${index}`,
      geometry: {
        type: 'LineString',
        coordinates: [
          [from.longitude, from.latitude],
          [to.longitude, to.latitude],
        ],
      },
      properties: {
        id: `recovery:${tail.vehicleId}:${index - 1}-${index}`,
        vehicleId: tail.vehicleId,
        trailState: assessment.state,
        segmentState,
        fromAgeSeconds: Math.max(
          0,
          Math.floor((nowMs - from.receivedAtMs) / 1000),
        ),
        toAgeSeconds: Math.max(
          0,
          Math.floor((nowMs - to.receivedAtMs) / 1000),
        ),
        elapsedSeconds,
        distanceMeters: segmentDistanceMeters,
        safeAsContext:
          assessment.safeAsContext && segmentState === 'contiguous',
      },
    });
  }

  return {type: 'FeatureCollection', features};
}
