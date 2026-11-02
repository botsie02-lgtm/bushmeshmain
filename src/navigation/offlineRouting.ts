import {Coordinate, distanceMeters} from '../convoy/convoy';
import {MapCoordinate} from '../maps/offlineMapPacks';

export type BushMeshRouteProfile =
  | '4wd-standard'
  | '4wd-conservative'
  | 'car'
  | 'walking';

export type BushMeshRouteAvoidance =
  | 'ferry'
  | 'toll'
  | 'unsealed'
  | 'seasonal-track'
  | 'private-road';

export type BushMeshRouteWaypoint = Coordinate & {
  id: string;
  label: string | null;
};

export type BushMeshRouteRequest = {
  start: Coordinate;
  destination: Coordinate;
  via: BushMeshRouteWaypoint[];
  profile: BushMeshRouteProfile;
  avoid: BushMeshRouteAvoidance[];
};

export type BushMeshManeuverType =
  | 'depart'
  | 'continue'
  | 'turn-left'
  | 'turn-right'
  | 'keep-left'
  | 'keep-right'
  | 'u-turn'
  | 'roundabout'
  | 'arrive';

export type BushMeshRouteManeuver = {
  id: string;
  type: BushMeshManeuverType;
  instruction: string;
  coordinate: Coordinate;
  distanceFromRouteStartMeters: number;
  distanceToNextMeters: number | null;
  roadName: string | null;
};

export type BushMeshRoutePlan = {
  id: string;
  engineId: string;
  engineVersion: string;
  createdAtMs: number;
  profile: BushMeshRouteProfile;
  geometry: Coordinate[];
  maneuvers: BushMeshRouteManeuver[];
  distanceMeters: number;
  estimatedDurationSeconds: number | null;
  sourceDataVersion: string | null;
};

export type BushMeshRouteEngineCapabilities = {
  profiles: BushMeshRouteProfile[];
  supportedAvoidances: BushMeshRouteAvoidance[];
  worksOffline: boolean;
};

export interface BushMeshOfflineRouteEngine {
  readonly id: string;
  readonly version: string;
  readonly capabilities: BushMeshRouteEngineCapabilities;
  isReady(): Promise<boolean>;
  route(request: BushMeshRouteRequest): Promise<BushMeshRoutePlan>;
  cancelActiveRoute(): Promise<void>;
}

function validCoordinate(point: Coordinate): boolean {
  return (
    Number.isFinite(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    Number.isFinite(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

export function validateRouteRequest(request: BushMeshRouteRequest): void {
  if (!validCoordinate(request.start) || !validCoordinate(request.destination)) {
    throw new Error('Bushmesh route start/destination coordinates are invalid.');
  }
  if (request.via.length > 64 || request.via.some(point => !validCoordinate(point))) {
    throw new Error('Bushmesh route via points are invalid.');
  }
  if (
    request.via.some(
      point =>
        typeof point.id !== 'string' ||
        point.id.trim() === '' ||
        point.id.length > 128 ||
        (point.label !== null && point.label.length > 240),
    )
  ) {
    throw new Error('Bushmesh route waypoint metadata is invalid.');
  }
  if (
    !['4wd-standard', '4wd-conservative', 'car', 'walking'].includes(
      request.profile,
    )
  ) {
    throw new Error('Unsupported Bushmesh route profile.');
  }

  const avoid = new Set(request.avoid);
  if (avoid.size !== request.avoid.length) {
    throw new Error('Bushmesh route avoidances contain duplicates.');
  }
}

export function validateRoutePlan(plan: BushMeshRoutePlan): void {
  if (
    typeof plan.id !== 'string' ||
    plan.id.trim() === '' ||
    typeof plan.engineId !== 'string' ||
    plan.engineId.trim() === '' ||
    typeof plan.engineVersion !== 'string' ||
    plan.engineVersion.trim() === '' ||
    !Number.isFinite(plan.createdAtMs) ||
    plan.createdAtMs < 0 ||
    plan.geometry.length < 2 ||
    plan.geometry.length > 200_000 ||
    plan.geometry.some(point => !validCoordinate(point)) ||
    !Number.isFinite(plan.distanceMeters) ||
    plan.distanceMeters < 0 ||
    (plan.estimatedDurationSeconds !== null &&
      (!Number.isFinite(plan.estimatedDurationSeconds) ||
        plan.estimatedDurationSeconds < 0))
  ) {
    throw new Error('Bushmesh route plan is invalid.');
  }

  let previousDistance = -1;
  for (const maneuver of plan.maneuvers) {
    if (
      typeof maneuver.id !== 'string' ||
      maneuver.id.trim() === '' ||
      typeof maneuver.instruction !== 'string' ||
      maneuver.instruction.trim() === '' ||
      maneuver.instruction.length > 500 ||
      !validCoordinate(maneuver.coordinate) ||
      !Number.isFinite(maneuver.distanceFromRouteStartMeters) ||
      maneuver.distanceFromRouteStartMeters < previousDistance ||
      (maneuver.distanceToNextMeters !== null &&
        (!Number.isFinite(maneuver.distanceToNextMeters) ||
          maneuver.distanceToNextMeters < 0))
    ) {
      throw new Error('Bushmesh route maneuver sequence is invalid.');
    }
    previousDistance = maneuver.distanceFromRouteStartMeters;
  }
}

/**
 * Samples route geometry into points suitable for the existing offline-pack
 * coverage gate. This is deliberately conservative: every retained point must
 * be covered by a verified local map pack before Drive can call the route
 * map-ready.
 */
export function routeCoveragePoints(
  geometry: Coordinate[],
  maxSpacingMeters = 2_000,
): MapCoordinate[] {
  if (geometry.length === 0) {
    return [];
  }
  if (!Number.isFinite(maxSpacingMeters) || maxSpacingMeters <= 0) {
    throw new Error('Route coverage spacing must be positive.');
  }

  const points: MapCoordinate[] = [{...geometry[0]}];
  let anchor = geometry[0];

  for (let index = 1; index < geometry.length; index += 1) {
    const point = geometry[index];
    if (!validCoordinate(point)) {
      throw new Error('Route geometry contains an invalid coordinate.');
    }

    if (distanceMeters(anchor, point) >= maxSpacingMeters) {
      points.push({...point});
      anchor = point;
    }
  }

  const last = geometry[geometry.length - 1];
  const retainedLast = points[points.length - 1];
  if (
    retainedLast.latitude !== last.latitude ||
    retainedLast.longitude !== last.longitude
  ) {
    points.push({...last});
  }

  return points;
}
