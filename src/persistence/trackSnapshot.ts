import {
  BushMeshTrackPoint,
  BushMeshTrackSnapshot,
} from '../location/TrackRecorder';

export const BUSHMESH_TRACK_SNAPSHOT_VERSION = 1 as const;

export type BushMeshTrackSnapshotV1 = {
  version: typeof BUSHMESH_TRACK_SNAPSHOT_VERSION;
  savedAtMs: number;
  track: BushMeshTrackSnapshot;
};

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function nullableFinite(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function validPoint(value: unknown): value is BushMeshTrackPoint {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const point = value as Partial<BushMeshTrackPoint>;
  return (
    typeof point.latitude === 'number' &&
    Number.isFinite(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180 &&
    finiteNonNegative(point.timestampMs) &&
    finiteNonNegative(point.recordedAtMs) &&
    point.timestampMs === point.recordedAtMs &&
    nullableFinite(point.altitudeMeters) &&
    nullableFinite(point.speedKmh) &&
    nullableFinite(point.headingDegrees) &&
    nullableFinite(point.accuracyMeters)
  );
}

export function createTrackSnapshot(
  track: BushMeshTrackSnapshot,
  savedAtMs = Date.now(),
): BushMeshTrackSnapshotV1 {
  const snapshot: BushMeshTrackSnapshotV1 = {
    version: BUSHMESH_TRACK_SNAPSHOT_VERSION,
    savedAtMs,
    track: {
      points: track.points.map(point => ({...point})),
      totalDistanceMeters: track.totalDistanceMeters,
      startedAtMs: track.startedAtMs,
      lastRecordedAtMs: track.lastRecordedAtMs,
    },
  };
  validateTrackSnapshot(snapshot);
  return snapshot;
}

export function encodeTrackSnapshot(snapshot: BushMeshTrackSnapshotV1): string {
  validateTrackSnapshot(snapshot);
  return JSON.stringify(snapshot);
}

export function decodeTrackSnapshot(serialized: string): BushMeshTrackSnapshotV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Bushmesh track snapshot is not valid JSON.');
  }

  validateTrackSnapshot(parsed);
  return parsed;
}

export function validateTrackSnapshot(
  snapshot: unknown,
): asserts snapshot is BushMeshTrackSnapshotV1 {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Bushmesh track snapshot is not an object.');
  }

  const candidate = snapshot as Partial<BushMeshTrackSnapshotV1>;
  if (candidate.version !== BUSHMESH_TRACK_SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported Bushmesh track snapshot version ${String(candidate.version)}.`,
    );
  }
  if (!finiteNonNegative(candidate.savedAtMs)) {
    throw new Error('Bushmesh track snapshot has an invalid saved time.');
  }
  if (!candidate.track || typeof candidate.track !== 'object') {
    throw new Error('Bushmesh track snapshot payload is invalid.');
  }

  const track = candidate.track as Partial<BushMeshTrackSnapshot>;
  if (!Array.isArray(track.points) || track.points.length > 2_000) {
    throw new Error('Bushmesh track snapshot points are invalid.');
  }
  if (!finiteNonNegative(track.totalDistanceMeters)) {
    throw new Error('Bushmesh track snapshot distance is invalid.');
  }
  if (!nullableFinite(track.startedAtMs) || !nullableFinite(track.lastRecordedAtMs)) {
    throw new Error('Bushmesh track snapshot timestamps are invalid.');
  }

  let previousTimestamp = -1;
  for (const point of track.points) {
    if (!validPoint(point) || point.recordedAtMs <= previousTimestamp) {
      throw new Error('Bushmesh track snapshot point sequence is invalid.');
    }
    previousTimestamp = point.recordedAtMs;
  }
}
