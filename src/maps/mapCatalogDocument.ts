import {
  BushMeshMapPackManifestV1,
  validateMapPackManifest,
} from './mapPackManifest';

export const BUSHMESH_MAP_CATALOG_VERSION = 1 as const;
const MAX_CATALOG_PACKS = 512;
const MAX_CATALOG_NAME_LENGTH = 240;
const MAX_PUBLISHER_LENGTH = 240;
const MAX_CATALOG_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export type BushMeshMapCatalogDocumentV1 = {
  schemaVersion: typeof BUSHMESH_MAP_CATALOG_VERSION;
  catalogId: string;
  name: string;
  publisher: string;
  generatedAtMs: number;
  expiresAtMs: number | null;
  packs: BushMeshMapPackManifestV1[];
};

export type BushMeshMapCatalogTrustPolicy = {
  allowedCatalogIds: string[];
  allowedCatalogHosts: string[];
  allowedRemoteHosts: string[];
  requireExpiry: boolean;
  maxDocumentAgeMs?: number;
};

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9][a-z0-9._-]{2,127}$/i.test(value)
  );
}

export function normalizeMapCatalogHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

function remoteHostForManifest(
  manifest: BushMeshMapPackManifestV1,
): string | null {
  if (manifest.source.kind !== 'remote') {
    return null;
  }

  try {
    return normalizeMapCatalogHost(new URL(manifest.source.url).hostname);
  } catch {
    return null;
  }
}

export function validateMapCatalogDocument(
  document: unknown,
): asserts document is BushMeshMapCatalogDocumentV1 {
  if (!document || typeof document !== 'object') {
    throw new Error('Bushmesh map catalog is not an object.');
  }

  const candidate = document as Partial<BushMeshMapCatalogDocumentV1>;
  if (candidate.schemaVersion !== BUSHMESH_MAP_CATALOG_VERSION) {
    throw new Error(
      `Unsupported Bushmesh map catalog version ${String(candidate.schemaVersion)}.`,
    );
  }
  if (!validIdentifier(candidate.catalogId)) {
    throw new Error('Bushmesh map catalog ID is invalid.');
  }
  if (
    typeof candidate.name !== 'string' ||
    candidate.name.trim() === '' ||
    candidate.name.length > MAX_CATALOG_NAME_LENGTH
  ) {
    throw new Error('Bushmesh map catalog name is invalid.');
  }
  if (
    typeof candidate.publisher !== 'string' ||
    candidate.publisher.trim() === '' ||
    candidate.publisher.length > MAX_PUBLISHER_LENGTH
  ) {
    throw new Error('Bushmesh map catalog publisher is invalid.');
  }
  if (
    typeof candidate.generatedAtMs !== 'number' ||
    !Number.isFinite(candidate.generatedAtMs) ||
    candidate.generatedAtMs < 0
  ) {
    throw new Error('Bushmesh map catalog generated time is invalid.');
  }
  if (
    candidate.expiresAtMs !== null &&
    (typeof candidate.expiresAtMs !== 'number' ||
      !Number.isFinite(candidate.expiresAtMs) ||
      candidate.expiresAtMs <= candidate.generatedAtMs)
  ) {
    throw new Error('Bushmesh map catalog expiry is invalid.');
  }
  if (!Array.isArray(candidate.packs) || candidate.packs.length > MAX_CATALOG_PACKS) {
    throw new Error('Bushmesh map catalog pack list is invalid.');
  }

  const ids = new Set<string>();
  for (const manifest of candidate.packs) {
    validateMapPackManifest(manifest);
    if (ids.has(manifest.id)) {
      throw new Error(`Bushmesh map catalog repeats pack ID ${manifest.id}.`);
    }
    ids.add(manifest.id);
  }
}

export function decodeMapCatalogDocument(
  serialized: string,
): BushMeshMapCatalogDocumentV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Bushmesh map catalog is not valid JSON.');
  }

  validateMapCatalogDocument(parsed);
  return parsed;
}

export function assertMapCatalogSourceTrusted(
  sourceUrl: string,
  policy: BushMeshMapCatalogTrustPolicy,
): void {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error('Bushmesh map catalog URL is invalid.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Bushmesh map catalogs must be loaded over HTTPS.');
  }

  const allowedHosts = new Set(
    policy.allowedCatalogHosts.map(normalizeMapCatalogHost),
  );
  const host = normalizeMapCatalogHost(parsed.hostname);
  if (!allowedHosts.has(host)) {
    throw new Error(`Map catalog host ${host} is not trusted by this build.`);
  }
}

/**
 * Applies local trust policy after structural validation. HTTPS alone is not
 * treated as publisher authenticity; callers must explicitly pin catalog IDs
 * and permitted artifact hosts before catalog manifests can be registered.
 */
export function assertMapCatalogTrusted(
  document: BushMeshMapCatalogDocumentV1,
  policy: BushMeshMapCatalogTrustPolicy,
  nowMs = Date.now(),
): void {
  validateMapCatalogDocument(document);

  const allowedCatalogIds = new Set(policy.allowedCatalogIds);
  if (!allowedCatalogIds.has(document.catalogId)) {
    throw new Error(`Map catalog ${document.catalogId} is not trusted by this build.`);
  }

  const maxAge = policy.maxDocumentAgeMs ?? MAX_CATALOG_AGE_MS;
  if (!Number.isFinite(maxAge) || maxAge <= 0) {
    throw new Error('Bushmesh map catalog trust policy has an invalid maximum age.');
  }
  if (document.generatedAtMs > nowMs + 5 * 60 * 1000) {
    throw new Error('Bushmesh map catalog was generated unreasonably far in the future.');
  }
  if (nowMs - document.generatedAtMs > maxAge) {
    throw new Error('Bushmesh map catalog is older than the configured trust window.');
  }
  if (policy.requireExpiry && document.expiresAtMs === null) {
    throw new Error('Bushmesh map catalog must declare an expiry time.');
  }
  if (document.expiresAtMs !== null && document.expiresAtMs <= nowMs) {
    throw new Error('Bushmesh map catalog has expired.');
  }

  const allowedHosts = new Set(
    policy.allowedRemoteHosts.map(normalizeMapCatalogHost),
  );
  for (const manifest of document.packs) {
    const host = remoteHostForManifest(manifest);
    if (host !== null && !allowedHosts.has(host)) {
      throw new Error(
        `Map pack ${manifest.id} uses untrusted artifact host ${host}.`,
      );
    }
  }
}

export function trustedCatalogManifests(
  document: BushMeshMapCatalogDocumentV1,
  policy: BushMeshMapCatalogTrustPolicy,
  nowMs = Date.now(),
): BushMeshMapPackManifestV1[] {
  assertMapCatalogTrusted(document, policy, nowMs);
  return document.packs.map(manifest => ({
    ...manifest,
    bounds: {...manifest.bounds},
    source: {...manifest.source},
  }));
}
