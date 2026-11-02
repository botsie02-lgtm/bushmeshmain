import {RecoveryObservedMotion} from '../convoy/recoveryMotion';
import {BushMeshGeoJsonPosition} from './operationalPictureGeoJson';

export type RecoveryMotionProperties = {
  id: string;
  vehicleId: string;
  historicalOnly: true;
  quality: RecoveryObservedMotion['quality'];
  bearingDegrees: number;
  compassDirection: string;
  distanceMeters: number;
  elapsedSeconds: number;
  speedKmh: number;
  observedAtMs: number;
  ageSeconds: number;
};

export type RecoveryMotionFeature = {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'LineString';
    coordinates: [BushMeshGeoJsonPosition, BushMeshGeoJsonPosition];
  };
  properties: RecoveryMotionProperties;
};

/**
 * Converts only the actual observed movement segment into GeoJSON. The geometry
 * stops at the last received fix and is never extended forward as a predicted
 * position or search bearing.
 */
export function recoveryObservedMotionToGeoJson(
  motion: RecoveryObservedMotion | null | undefined,
): RecoveryMotionFeature | null {
  if (!motion) {
    return null;
  }

  const id = `recovery-motion:${motion.vehicleId}:${motion.observedAtMs}`;
  return {
    type: 'Feature',
    id,
    geometry: {
      type: 'LineString',
      coordinates: [
        [motion.from.longitude, motion.from.latitude],
        [motion.to.longitude, motion.to.latitude],
      ],
    },
    properties: {
      id,
      vehicleId: motion.vehicleId,
      historicalOnly: true,
      quality: motion.quality,
      bearingDegrees: motion.bearingDegrees,
      compassDirection: motion.compassDirection,
      distanceMeters: motion.distanceMeters,
      elapsedSeconds: motion.elapsedSeconds,
      speedKmh: motion.speedKmh,
      observedAtMs: motion.observedAtMs,
      ageSeconds: motion.ageSeconds,
    },
  };
}
