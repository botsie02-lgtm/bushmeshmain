import {Coordinate, distanceMeters} from '../convoy/convoy';
import {BushMeshRouteManeuver, BushMeshRoutePlan} from './offlineRouting';

export type BushMeshRouteProgressStatus =
  | 'on-route'
  | 'off-route'
  | 'arrived';

export type BushMeshRouteProgress = {
  status: BushMeshRouteProgressStatus;
  nearestSegmentIndex: number;
  segmentFraction: number;
  crossTrackDistanceMeters: number;
  distanceAlongRouteMeters: number;
  remainingDistanceMeters: number;
  distanceToDestinationMeters: number;
  offRouteThresholdMeters: number;
  nextManeuver: BushMeshRouteManeuver | null;
  distanceToNextManeuverMeters: number | null;
};

export type RouteProgressOptions = {
  horizontalAccuracyMeters?: number | null;
  minimumOffRouteMeters?: number;
  arrivalRadiusMeters?: number;
};

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function normalizedLongitudeDeltaDegrees(delta: number): number {
  return ((delta + 540) % 360) - 180;
}

function localVectorMeters(origin: Coordinate, point: Coordinate): [number, number] {
  const refLatitude = toRadians((origin.latitude + point.latitude) / 2);
  const deltaLongitude = toRadians(
    normalizedLongitudeDeltaDegrees(point.longitude - origin.longitude),
  );
  const deltaLatitude = toRadians(point.latitude - origin.latitude);
  return [
    EARTH_RADIUS_METERS * deltaLongitude * Math.cos(refLatitude),
    EARTH_RADIUS_METERS * deltaLatitude,
  ];
}

function closestPointOnSegment(
  position: Coordinate,
  start: Coordinate,
  end: Coordinate,
): {fraction: number; distanceMeters: number} {
  const [px, py] = localVectorMeters(start, position);
  const [bx, by] = localVectorMeters(start, end);
  const segmentLengthSquared = bx * bx + by * by;

  if (segmentLengthSquared <= 0.0001) {
    return {fraction: 0, distanceMeters: Math.hypot(px, py)};
  }

  const rawFraction = (px * bx + py * by) / segmentLengthSquared;
  const fraction = Math.max(0, Math.min(1, rawFraction));
  const closestX = bx * fraction;
  const closestY = by * fraction;
  return {
    fraction,
    distanceMeters: Math.hypot(px - closestX, py - closestY),
  };
}

function nextManeuverForProgress(
  maneuvers: BushMeshRouteManeuver[],
  distanceAlongRouteMeters: number,
): BushMeshRouteManeuver | null {
  return (
    maneuvers.find(
      maneuver =>
        maneuver.distanceFromRouteStartMeters + 1 >= distanceAlongRouteMeters,
    ) ?? null
  );
}

export function calculateRouteProgress(
  plan: BushMeshRoutePlan,
  position: Coordinate,
  options: RouteProgressOptions = {},
): BushMeshRouteProgress {
  if (plan.geometry.length < 2) {
    throw new Error('Bushmesh route progress requires at least two geometry points.');
  }

  const minimumOffRouteMeters = options.minimumOffRouteMeters ?? 40;
  const arrivalRadiusMeters = options.arrivalRadiusMeters ?? 40;
  if (
    !Number.isFinite(minimumOffRouteMeters) ||
    minimumOffRouteMeters <= 0 ||
    !Number.isFinite(arrivalRadiusMeters) ||
    arrivalRadiusMeters <= 0
  ) {
    throw new Error('Bushmesh route progress thresholds must be positive.');
  }

  const accuracy =
    options.horizontalAccuracyMeters != null &&
    Number.isFinite(options.horizontalAccuracyMeters) &&
    options.horizontalAccuracyMeters >= 0
      ? options.horizontalAccuracyMeters
      : 0;
  const offRouteThresholdMeters = Math.max(
    minimumOffRouteMeters,
    accuracy * 2.5,
  );

  let bestSegmentIndex = 0;
  let bestFraction = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestDistanceAlong = 0;
  let cumulativeDistance = 0;

  for (let index = 0; index < plan.geometry.length - 1; index += 1) {
    const start = plan.geometry[index];
    const end = plan.geometry[index + 1];
    const segmentLength = distanceMeters(start, end);
    const closest = closestPointOnSegment(position, start, end);

    if (closest.distanceMeters < bestDistance) {
      bestDistance = closest.distanceMeters;
      bestSegmentIndex = index;
      bestFraction = closest.fraction;
      bestDistanceAlong = cumulativeDistance + segmentLength * closest.fraction;
    }

    cumulativeDistance += segmentLength;
  }

  const destination = plan.geometry[plan.geometry.length - 1];
  const distanceToDestinationMeters = distanceMeters(position, destination);
  const arrived = distanceToDestinationMeters <= arrivalRadiusMeters;
  const status: BushMeshRouteProgressStatus = arrived
    ? 'arrived'
    : bestDistance > offRouteThresholdMeters
      ? 'off-route'
      : 'on-route';

  const planDistance = Math.max(plan.distanceMeters, cumulativeDistance);
  const remainingDistanceMeters = arrived
    ? 0
    : Math.max(0, planDistance - bestDistanceAlong);
  const nextManeuver = arrived
    ? null
    : nextManeuverForProgress(plan.maneuvers, bestDistanceAlong);

  return {
    status,
    nearestSegmentIndex: bestSegmentIndex,
    segmentFraction: bestFraction,
    crossTrackDistanceMeters: bestDistance,
    distanceAlongRouteMeters: bestDistanceAlong,
    remainingDistanceMeters,
    distanceToDestinationMeters,
    offRouteThresholdMeters,
    nextManeuver,
    distanceToNextManeuverMeters:
      nextManeuver === null
        ? null
        : Math.max(
            0,
            nextManeuver.distanceFromRouteStartMeters - bestDistanceAlong,
          ),
  };
}
