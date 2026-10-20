import {
  MapCoordinate,
  OfflineMapPack,
  validateMapBounds,
} from '../maps/offlineMapPacks';

export const BUSHMESH_MAP_STATE_SNAPSHOT_VERSION = 1 as const;
const MAX_PACKS = 256;
const MAX_REQUIRED_TRIP_POINTS = 20_000;

export type BushMeshMapStateSnapshotV1 = {
  version: typeof BUSHMESH_MAP_STATE_SNAPSHOT_VERSION;
  savedAtMs: number;
  packs: OfflineMapPack[];
  requiredTripPoints: MapCoordinate[];
};

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validCoordinate(value: unknown): value is MapCoordinate {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const coordinate = value as Partial<MapCoordinate>;
  return (
    typeof coordinate.latitude === 'number' &&
    Number.isFinite(coordinate.latitude) &&
    coordinate.latitude >= -90 &&
    coordinate.latitude <= 90 &&
    typeof coordinate.longitude === 'number' &&
    Number.isFinite(coordinate.longitude) &&
    coordinate.longitude >= -180 &&
    coordinate.longitude <= 180
  );
}

function validPack(value: unknown): value is OfflineMapPack {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const pack = value as Partial<OfflineMapPack>;
  if (
    typeof pack.id !== 'string' ||
    pack.id.trim() === '' ||
    pack.id.length > 160 ||
    typeof pack.name !== 'string' ||
    pack.name.trim() === '' ||
    pack.name.length > 240 ||
    typeof pack.version !== 'string' ||
    pack.version.trim() === '' ||
    pack.version.length > 120 ||
    !pack.bounds ||
    validateMapBounds(pack.bounds) !== null ||
    !['not-installed', 'downloading', 'ready', 'invalid'].includes(
      String(pack.state),
    ) ||
    !finiteNonNegative(pack.downloadedBytes) ||
    typeof pack.checksumVerified !== 'boolean' ||
    (pack.simulated !== undefined && typeof pack.simulated !== 'boolean')
  ) {
    return false;
  }

  if (
    pack.totalBytes !== null &&
    (!finiteNonNegative(pack.totalBytes) || pack.totalBytes <= 0)
  ) {
    return false;
  }

  return true;
}

function clonePack(pack: OfflineMapPack): OfflineMapPack {
  return {
    ...pack,
    bounds: {...pack.bounds},
  };
}

export function createMapStateSnapshot(
  packs: OfflineMapPack[],
  requiredTripPoints: MapCoordinate[],
  savedAtMs = Date.now(),
): BushMeshMapStateSnapshotV1 {
  const snapshot: BushMeshMapStateSnapshotV1 = {
    version: BUSHMESH_MAP_STATE_SNAPSHOT_VERSION,
    savedAtMs,
    packs: packs.map(clonePack),
    requiredTripPoints: requiredTripPoints.map(point => ({...point})),
  };
  validateMapStateSnapshot(snapshot);
  return snapshot;
}

export function encodeMapStateSnapshot(
  snapshot: BushMeshMapStateSnapshotV1,
): string {
  validateMapStateSnapshot(snapshot);
  return JSON.stringify(snapshot);
}

export function decodeMapStateSnapshot(
  serialized: string,
): BushMeshMapStateSnapshotV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Bushmesh map-state snapshot is not valid JSON.');
  }

  validateMapStateSnapshot(parsed);
  return parsed;
}

export function validateMapStateSnapshot(
  snapshot: unknown,
): asserts snapshot is BushMeshMapStateSnapshotV1 {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Bushmesh map-state snapshot is not an object.');
  }

  const candidate = snapshot as Partial<BushMeshMapStateSnapshotV1>;
  if (candidate.version !== BUSHMESH_MAP_STATE_SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported Bushmesh map-state snapshot version ${String(candidate.version)}.`,
    );
  }
  if (!finiteNonNegative(candidate.savedAtMs)) {
    throw new Error('Bushmesh map-state snapshot has an invalid saved time.');
  }
  if (!Array.isArray(candidate.packs) || candidate.packs.length > MAX_PACKS) {
    throw new Error('Bushmesh map-state snapshot pack list is invalid.');
  }
  if (
    !Array.isArray(candidate.requiredTripPoints) ||
    candidate.requiredTripPoints.length > MAX_REQUIRED_TRIP_POINTS
  ) {
    throw new Error('Bushmesh map-state trip-point list is invalid.');
  }

  const ids = new Set<string>();
  for (const pack of candidate.packs) {
    if (!validPack(pack)) {
      throw new Error('Bushmesh map-state snapshot contains an invalid pack.');
    }
    if (ids.has(pack.id)) {
      throw new Error('Bushmesh map-state snapshot contains duplicate pack IDs.');
    }
    ids.add(pack.id);
  }

  if (!candidate.requiredTripPoints.every(validCoordinate)) {
    throw new Error('Bushmesh map-state snapshot contains an invalid trip point.');
  }
}
