import {
  ConvoyFreshness,
  ConvoyVehicle,
  Coordinate,
  bearingDegrees,
  compassDirection,
  distanceMeters,
  getConvoyFreshness,
  positionAgeSeconds,
} from './convoy';

export type MovingTargetGuidance = {
  vehicleId: string;
  vehicleName: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  bearingDegrees: number;
  compassDirection: string;
  freshness: ConvoyFreshness;
  ageSeconds: number;
  safeToFollow: boolean;
};

/**
 * Straight-line guidance to a moving convoy member. This intentionally does not
 * claim road/trail routing; it is a continuously updated bearing and distance
 * to the most recent trustworthy vehicle position.
 */
export function getMovingTargetGuidance(
  localPosition: Coordinate | null,
  vehicle: ConvoyVehicle | null | undefined,
  nowMs = Date.now(),
): MovingTargetGuidance | null {
  if (!localPosition || !vehicle) {
    return null;
  }

  const freshness = getConvoyFreshness(vehicle.receivedAtMs, nowMs);
  const bearing = bearingDegrees(localPosition, vehicle);

  return {
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    latitude: vehicle.latitude,
    longitude: vehicle.longitude,
    distanceMeters: distanceMeters(localPosition, vehicle),
    bearingDegrees: bearing,
    compassDirection: compassDirection(bearing),
    freshness,
    ageSeconds: positionAgeSeconds(vehicle.receivedAtMs, nowMs),
    safeToFollow: freshness === 'live' || freshness === 'recent',
  };
}
