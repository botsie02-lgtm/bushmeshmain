import {
  BushMeshMapPackCatalogEntry,
  cloneMapPackCatalogEntry,
} from '../maps/mapPackCatalog';
import {
  BushMeshInstalledMapArtifact,
  installedArtifactMatchesManifest,
  validateMapPackManifest,
} from '../maps/mapPackManifest';
import {
  MapCoordinate,
  OfflineMapPack,
  validateMapBounds,
} from '../maps/offlineMapPacks';

export const BUSHMESH_MAP_STATE_SNAPSHOT_VERSION = 2 as const;
const LEGACY_MAP_STATE_SNAPSHOT_VERSION = 1 as const;
const MAX_PACKS = 256;
const MAX_REQUIRED_TRIP_POINTS = 20_000;

export type BushMeshMapStateSnapshotV2 = {
  version: typeof BUSHMESH_MAP_STATE_SNAPSHOT_VERSION;
  savedAtMs: number;
  catalog: BushMeshMapPackCatalogEntry[];
  simulatedPacks: OfflineMapPack[];
  requiredTripPoints: MapCoordinate[];
};

type LegacyMapStateSnapshotV1 = {
  version: typeof LEGACY_MAP_STATE_SNAPSHOT_VERSION;
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

  return (
    pack.totalBytes === null ||
    (finiteNonNegative(pack.totalBytes) && pack.totalBytes > 0)
  );
}

function clonePack(pack: OfflineMapPack): OfflineMapPack {
  return {
    ...pack,
    bounds: {...pack.bounds},
  };
}

function validArtifact(value: unknown): value is BushMeshInstalledMapArtifact {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const artifact = value as Partial<BushMeshInstalledMapArtifact>;
  return (
    typeof artifact.packId === 'string' &&
    artifact.packId.trim() !== '' &&
    typeof artifact.manifestVersion === 'string' &&
    artifact.manifestVersion.trim() !== '' &&
    (artifact.format === 'pmtiles' || artifact.format === 'mbtiles') &&
    typeof artifact.localUri === 'string' &&
    artifact.localUri.trim() !== '' &&
    typeof artifact.bytes === 'number' &&
    Number.isSafeInteger(artifact.bytes) &&
    artifact.bytes > 0 &&
    typeof artifact.sha256 === 'string' &&
    /^[0-9a-f]{64}$/i.test(artifact.sha256) &&
    finiteNonNegative(artifact.verifiedAtMs)
  );
}

function validCatalogEntry(value: unknown): value is BushMeshMapPackCatalogEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Partial<BushMeshMapPackCatalogEntry>;
  try {
    validateMapPackManifest(entry.manifest);
  } catch {
    return false;
  }

  if (
    !['not-installed', 'installing', 'ready', 'invalid'].includes(
      String(entry.installState),
    ) ||
    (entry.lastError !== null &&
      (typeof entry.lastError !== 'string' || entry.lastError.length > 2_000))
  ) {
    return false;
  }

  if (entry.artifact !== null) {
    if (!validArtifact(entry.artifact)) {
      return false;
    }
    if (!installedArtifactMatchesManifest(entry.manifest, entry.artifact)) {
      return false;
    }
  }

  return entry.installState !== 'ready' || entry.artifact !== null;
}

function normalizeCatalogEntryForPersistence(
  entry: BushMeshMapPackCatalogEntry,
): BushMeshMapPackCatalogEntry {
  const clone = cloneMapPackCatalogEntry(entry);
  if (
    clone.artifact !== null &&
    installedArtifactMatchesManifest(clone.manifest, clone.artifact)
  ) {
    return {...clone, installState: 'ready', lastError: null};
  }

  return {
    ...clone,
    artifact: null,
    installState: clone.installState === 'invalid' ? 'invalid' : 'not-installed',
  };
}

function validateCommonSnapshotParts(
  savedAtMs: unknown,
  requiredTripPoints: unknown,
): asserts requiredTripPoints is MapCoordinate[] {
  if (!finiteNonNegative(savedAtMs)) {
    throw new Error('Bushmesh map-state snapshot has an invalid saved time.');
  }
  if (
    !Array.isArray(requiredTripPoints) ||
    requiredTripPoints.length > MAX_REQUIRED_TRIP_POINTS ||
    !requiredTripPoints.every(validCoordinate)
  ) {
    throw new Error('Bushmesh map-state trip-point list is invalid.');
  }
}

function migrateLegacySnapshot(parsed: unknown): BushMeshMapStateSnapshotV2 | null {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const legacy = parsed as Partial<LegacyMapStateSnapshotV1>;
  if (legacy.version !== LEGACY_MAP_STATE_SNAPSHOT_VERSION) {
    return null;
  }

  validateCommonSnapshotParts(legacy.savedAtMs, legacy.requiredTripPoints);
  if (!Array.isArray(legacy.packs) || legacy.packs.length > MAX_PACKS) {
    throw new Error('Legacy Bushmesh map-state pack list is invalid.');
  }
  if (!legacy.packs.every(validPack)) {
    throw new Error('Legacy Bushmesh map-state contains an invalid pack.');
  }

  // V1 had no authenticated manifest/artifact pair. Never migrate a real
  // "ready" claim from it. Only simulated development packs are retained.
  const simulatedPacks = legacy.packs
    .filter(pack => pack.simulated === true)
    .map(clonePack);

  return {
    version: BUSHMESH_MAP_STATE_SNAPSHOT_VERSION,
    savedAtMs: legacy.savedAtMs,
    catalog: [],
    simulatedPacks,
    requiredTripPoints: legacy.requiredTripPoints.map(point => ({...point})),
  };
}

export function createMapStateSnapshot(
  catalog: BushMeshMapPackCatalogEntry[],
  simulatedPacks: OfflineMapPack[],
  requiredTripPoints: MapCoordinate[],
  savedAtMs = Date.now(),
): BushMeshMapStateSnapshotV2 {
  const snapshot: BushMeshMapStateSnapshotV2 = {
    version: BUSHMESH_MAP_STATE_SNAPSHOT_VERSION,
    savedAtMs,
    catalog: catalog.map(normalizeCatalogEntryForPersistence),
    simulatedPacks: simulatedPacks.map(clonePack),
    requiredTripPoints: requiredTripPoints.map(point => ({...point})),
  };
  validateMapStateSnapshot(snapshot);
  return snapshot;
}

export function encodeMapStateSnapshot(
  snapshot: BushMeshMapStateSnapshotV2,
): string {
  validateMapStateSnapshot(snapshot);
  return JSON.stringify(snapshot);
}

export function decodeMapStateSnapshot(
  serialized: string,
): BushMeshMapStateSnapshotV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Bushmesh map-state snapshot is not valid JSON.');
  }

  const migrated = migrateLegacySnapshot(parsed);
  if (migrated !== null) {
    return migrated;
  }

  validateMapStateSnapshot(parsed);
  return {
    ...parsed,
    catalog: parsed.catalog.map(normalizeCatalogEntryForPersistence),
    simulatedPacks: parsed.simulatedPacks.map(clonePack),
    requiredTripPoints: parsed.requiredTripPoints.map(point => ({...point})),
  };
}

export function validateMapStateSnapshot(
  snapshot: unknown,
): asserts snapshot is BushMeshMapStateSnapshotV2 {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Bushmesh map-state snapshot is not an object.');
  }

  const candidate = snapshot as Partial<BushMeshMapStateSnapshotV2>;
  if (candidate.version !== BUSHMESH_MAP_STATE_SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported Bushmesh map-state snapshot version ${String(candidate.version)}.`,
    );
  }

  validateCommonSnapshotParts(candidate.savedAtMs, candidate.requiredTripPoints);
  if (!Array.isArray(candidate.catalog) || candidate.catalog.length > MAX_PACKS) {
    throw new Error('Bushmesh map-state catalog is invalid.');
  }
  if (
    !Array.isArray(candidate.simulatedPacks) ||
    candidate.simulatedPacks.length > MAX_PACKS
  ) {
    throw new Error('Bushmesh simulated map-pack list is invalid.');
  }

  const ids = new Set<string>();
  for (const entry of candidate.catalog) {
    if (!validCatalogEntry(entry)) {
      throw new Error('Bushmesh map-state catalog contains an invalid entry.');
    }
    if (ids.has(entry.manifest.id)) {
      throw new Error('Bushmesh map-state catalog contains duplicate pack IDs.');
    }
    ids.add(entry.manifest.id);
  }

  for (const pack of candidate.simulatedPacks) {
    if (!validPack(pack) || pack.simulated !== true) {
      throw new Error('Bushmesh map-state contains an invalid simulated pack.');
    }
    if (ids.has(pack.id)) {
      throw new Error('Bushmesh map-state contains duplicate pack IDs.');
    }
    ids.add(pack.id);
  }
}
