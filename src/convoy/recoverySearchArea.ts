import {ConvoyVehicle, Coordinate, getConvoyFreshness} from './convoy';

export type RecoverySearchAreaState = 'recent' | 'stale' | 'lost';

export type RecoverySearchArea = {
  vehicleId: string;
  center: Coordinate;
  radiusMeters: number;
  ageSeconds: number;
  state: RecoverySearchAreaState;
  confidenceLabel: 'last-known' | 'broad' | 'very-broad';
  reason: string;
};

const MIN_RADIUS_METERS = 75;
const MAX_RADIUS_METERS = 25_000;
const UNKNOWN_SPEED_METERS_PER_SECOND = 8.33; // 30 km/h conservative fallback.
const SPEED_UNCERTAINTY_FACTOR = 0.55;

export function buildRecoverySearchArea(
  vehicle: ConvoyVehicle | null | undefined,
  nowMs = Date.now(),
): RecoverySearchArea | null {
  if (!vehicle) {
    return null;
  }

  const freshness = getConvoyFreshness(vehicle.receivedAtMs, nowMs);
  if (freshness === 'live') {
    return null;
  }

  const ageSeconds = Math.max(
    0,
    Math.floor((nowMs - vehicle.receivedAtMs) / 1000),
  );
  const speedMetersPerSecond =
    vehicle.speedKmh > 0
      ? Math.min(vehicle.speedKmh / 3.6, 35)
      : UNKNOWN_SPEED_METERS_PER_SECOND;
  const accuracyMeters = Math.max(vehicle.accuracyMeters ?? 25, 10);

  // This is deliberately an uncertainty envelope, not dead reckoning. We do
  // not project a heading because turns, stops and track geometry are unknown.
  const movementUncertainty =
    speedMetersPerSecond * ageSeconds * SPEED_UNCERTAINTY_FACTOR;
  const radiusMeters = Math.min(
    MAX_RADIUS_METERS,
    Math.max(MIN_RADIUS_METERS, accuracyMeters * 2 + movementUncertainty),
  );

  if (freshness === 'recent') {
    return {
      vehicleId: vehicle.id,
      center: {latitude: vehicle.latitude, longitude: vehicle.longitude},
      radiusMeters,
      ageSeconds,
      state: 'recent',
      confidenceLabel: 'last-known',
      reason:
        'Recent last-known fix; radius represents movement and GPS uncertainty only.',
    };
  }

  if (freshness === 'stale') {
    return {
      vehicleId: vehicle.id,
      center: {latitude: vehicle.latitude, longitude: vehicle.longitude},
      radiusMeters,
      ageSeconds,
      state: 'stale',
      confidenceLabel: 'broad',
      reason:
        'Stale last-known fix; use this broad area only as recovery context, not a current position.',
    };
  }

  return {
    vehicleId: vehicle.id,
    center: {latitude: vehicle.latitude, longitude: vehicle.longitude},
    radiusMeters,
    ageSeconds,
    state: 'lost',
    confidenceLabel: 'very-broad',
    reason:
      'Lost vehicle; the expanding envelope is intentionally conservative and must not be displayed as a probable exact location.',
  };
}
