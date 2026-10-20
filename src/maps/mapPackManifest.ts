import {
  MapBounds,
  OfflineMapPack,
  validateMapBounds,
} from './offlineMapPacks';

export const BUSHMESH_MAP_PACK_MANIFEST_VERSION = 1 as const;

export type BushMeshMapPackFormat = 'pmtiles' | 'mbtiles';

export type BushMeshMapPackSource =
  | {
      kind: 'remote';
      url: string;
    }
  | {
      kind: 'import';
      displayName: string;
    };

export type BushMeshMapPackManifestV1 = {
  schemaVersion: typeof BUSHMESH_MAP_PACK_MANIFEST_VERSION;
  id: string;
  name: string;
  version: string;
  bounds: MapBounds;
  format: BushMeshMapPackFormat;
  minZoom: number;
  maxZoom: number;
  tileSize: 256 | 512;
  expectedBytes: number;
  sha256: string;
  source: BushMeshMapPackSource;
  attribution?: string | null;
};

/**
 * A verified local file record. The native installer creates this only after
 * byte length and SHA-256 verification succeeds.
 */
export type BushMeshInstalledMapArtifact = {
  packId: string;
  manifestVersion: string;
  format: BushMeshMapPackFormat;
  localUri: string;
  bytes: number;
  sha256: string;
  verifiedAtMs: number;
};

function finiteIntegerInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function validSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function validPackId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9][a-z0-9._-]{2,127}$/i.test(value)
  );
}

function validHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateMapPackManifest(
  manifest: unknown,
): asserts manifest is BushMeshMapPackManifestV1 {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Bushmesh map-pack manifest is not an object.');
  }

  const candidate = manifest as Partial<BushMeshMapPackManifestV1>;
  if (candidate.schemaVersion !== BUSHMESH_MAP_PACK_MANIFEST_VERSION) {
    throw new Error(
      `Unsupported Bushmesh map-pack manifest version ${String(candidate.schemaVersion)}.`,
    );
  }
  if (!validPackId(candidate.id)) {
    throw new Error('Bushmesh map-pack manifest ID is invalid.');
  }
  if (
    typeof candidate.name !== 'string' ||
    candidate.name.trim() === '' ||
    candidate.name.length > 240
  ) {
    throw new Error('Bushmesh map-pack manifest name is invalid.');
  }
  if (
    typeof candidate.version !== 'string' ||
    candidate.version.trim() === '' ||
    candidate.version.length > 120
  ) {
    throw new Error('Bushmesh map-pack manifest version is invalid.');
  }
  if (!candidate.bounds || validateMapBounds(candidate.bounds) !== null) {
    throw new Error('Bushmesh map-pack manifest bounds are invalid.');
  }
  if (candidate.format !== 'pmtiles' && candidate.format !== 'mbtiles') {
    throw new Error('Bushmesh map-pack format must be PMTiles or MBTiles.');
  }
  if (
    !finiteIntegerInRange(candidate.minZoom, 0, 24) ||
    !finiteIntegerInRange(candidate.maxZoom, 0, 24) ||
    candidate.minZoom > candidate.maxZoom
  ) {
    throw new Error('Bushmesh map-pack zoom range is invalid.');
  }
  if (candidate.tileSize !== 256 && candidate.tileSize !== 512) {
    throw new Error('Bushmesh map-pack tile size must be 256 or 512 pixels.');
  }
  if (
    typeof candidate.expectedBytes !== 'number' ||
    !Number.isSafeInteger(candidate.expectedBytes) ||
    candidate.expectedBytes <= 0
  ) {
    throw new Error('Bushmesh map-pack expected byte length is invalid.');
  }
  if (!validSha256(candidate.sha256)) {
    throw new Error('Bushmesh map-pack SHA-256 is invalid.');
  }
  if (!candidate.source || typeof candidate.source !== 'object') {
    throw new Error('Bushmesh map-pack source is invalid.');
  }

  if (candidate.source.kind === 'remote') {
    if (
      typeof candidate.source.url !== 'string' ||
      !validHttpsUrl(candidate.source.url)
    ) {
      throw new Error('Remote Bushmesh map packs require an HTTPS URL.');
    }
  } else if (candidate.source.kind === 'import') {
    if (
      typeof candidate.source.displayName !== 'string' ||
      candidate.source.displayName.trim() === '' ||
      candidate.source.displayName.length > 240
    ) {
      throw new Error('Imported Bushmesh map-pack display name is invalid.');
    }
  } else {
    throw new Error('Unsupported Bushmesh map-pack source kind.');
  }

  if (
    candidate.attribution !== undefined &&
    candidate.attribution !== null &&
    (typeof candidate.attribution !== 'string' ||
      candidate.attribution.length > 1_000)
  ) {
    throw new Error('Bushmesh map-pack attribution is invalid.');
  }
}

export function decodeMapPackManifest(
  serialized: string,
): BushMeshMapPackManifestV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Bushmesh map-pack manifest is not valid JSON.');
  }

  validateMapPackManifest(parsed);
  return parsed;
}

export function installedArtifactMatchesManifest(
  manifest: BushMeshMapPackManifestV1,
  artifact: BushMeshInstalledMapArtifact,
): boolean {
  validateMapPackManifest(manifest);

  return (
    artifact.packId === manifest.id &&
    artifact.manifestVersion === manifest.version &&
    artifact.format === manifest.format &&
    artifact.bytes === manifest.expectedBytes &&
    artifact.sha256.toLowerCase() === manifest.sha256.toLowerCase() &&
    Number.isFinite(artifact.verifiedAtMs) &&
    artifact.verifiedAtMs >= 0 &&
    artifact.localUri.trim() !== ''
  );
}

/**
 * Converts installation state into the existing trip-readiness model. A pack
 * only becomes ready/checksumVerified when the native artifact record matches
 * the exact manifest that declared the bytes.
 */
export function offlineMapPackFromManifest(
  manifest: BushMeshMapPackManifestV1,
  artifact: BushMeshInstalledMapArtifact | null,
): OfflineMapPack {
  validateMapPackManifest(manifest);
  const verified =
    artifact !== null && installedArtifactMatchesManifest(manifest, artifact);

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    bounds: {...manifest.bounds},
    state: verified ? 'ready' : 'not-installed',
    downloadedBytes: verified ? manifest.expectedBytes : 0,
    totalBytes: manifest.expectedBytes,
    checksumVerified: verified,
  };
}
