export type ConvoyFreshness = 'live' | 'recent' | 'stale' | 'lost';

export type ConvoyVehicle = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  speedKmh: number;
  headingDegrees: number | null;
  accuracyMeters: number | null;
  sequence: number;
  packetTimestampSeconds: number;
  receivedAtMs: number;
  snrDb: number | null;
  pathLength: number | null;
  simulated?: boolean;
};

export type Coordinate = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

export function getConvoyFreshness(
  receivedAtMs: number,
  nowMs = Date.now(),
): ConvoyFreshness {
  const ageSeconds = Math.max(0, (nowMs - receivedAtMs) / 1000);

  if (ageSeconds <= 30) {
    return 'live';
  }
  if (ageSeconds <= 120) {
    return 'recent';
  }
  if (ageSeconds <= 600) {
    return 'stale';
  }
  return 'lost';
}

export function positionAgeSeconds(
  receivedAtMs: number,
  nowMs = Date.now(),
): number {
  return Math.max(0, Math.floor((nowMs - receivedAtMs) / 1000));
}

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const haversine =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return EARTH_RADIUS_METERS * arc;
}

export function bearingDegrees(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function compassDirection(bearing: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = ((bearing % 360) + 360) % 360;
  return directions[Math.round(normalized / 45) % directions.length];
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function formatPositionAge(ageSeconds: number): string {
  if (ageSeconds < 5) {
    return 'now';
  }
  if (ageSeconds < 60) {
    return `${ageSeconds}s ago`;
  }
  if (ageSeconds < 3600) {
    return `${Math.floor(ageSeconds / 60)}m ago`;
  }
  return `${Math.floor(ageSeconds / 3600)}h ago`;
}

export function shouldReplaceVehiclePosition(
  current: ConvoyVehicle | undefined,
  incoming: ConvoyVehicle,
): boolean {
  if (!current) {
    return true;
  }

  if (incoming.packetTimestampSeconds !== current.packetTimestampSeconds) {
    return incoming.packetTimestampSeconds > current.packetTimestampSeconds;
  }

  return incoming.sequence >= current.sequence;
}
