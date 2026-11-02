import {RecoverySearchArea} from '../convoy/recoverySearchArea';
import {BushMeshGeoJsonPosition} from './operationalPictureGeoJson';

export type RecoverySearchAreaProperties = {
  id: string;
  vehicleId: string;
  state: RecoverySearchArea['state'];
  confidenceLabel: RecoverySearchArea['confidenceLabel'];
  radiusMeters: number;
  ageSeconds: number;
  semantic: 'uncertainty-envelope';
};

export type RecoverySearchAreaFeature = {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'Polygon';
    coordinates: BushMeshGeoJsonPosition[][];
  };
  properties: RecoverySearchAreaProperties;
};

const EARTH_RADIUS_METERS = 6_371_000;
const DEFAULT_SEGMENTS = 48;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function pointAtDistance(
  latitude: number,
  longitude: number,
  bearingDegrees: number,
  distanceMeters: number,
): BushMeshGeoJsonPosition {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(latitude);
  const lon1 = toRadians(longitude);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  const normalizedLongitude = ((toDegrees(lon2) + 540) % 360) - 180;
  return [normalizedLongitude, toDegrees(lat2)];
}

export function recoverySearchAreaToGeoJson(
  area: RecoverySearchArea | null | undefined,
  segments = DEFAULT_SEGMENTS,
): RecoverySearchAreaFeature | null {
  if (!area) {
    return null;
  }

  const safeSegments = Math.max(12, Math.min(96, Math.round(segments)));
  const ring: BushMeshGeoJsonPosition[] = [];

  for (let index = 0; index < safeSegments; index += 1) {
    ring.push(
      pointAtDistance(
        area.center.latitude,
        area.center.longitude,
        (index / safeSegments) * 360,
        area.radiusMeters,
      ),
    );
  }

  if (ring.length > 0) {
    ring.push([...ring[0]] as BushMeshGeoJsonPosition);
  }

  const id = `recovery-area:${area.vehicleId}`;
  return {
    type: 'Feature',
    id,
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
    properties: {
      id,
      vehicleId: area.vehicleId,
      state: area.state,
      confidenceLabel: area.confidenceLabel,
      radiusMeters: area.radiusMeters,
      ageSeconds: area.ageSeconds,
      semantic: 'uncertainty-envelope',
    },
  };
}
