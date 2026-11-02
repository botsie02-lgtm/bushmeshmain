import {Buffer} from 'buffer';

import {
  BushMeshMapCatalogDocumentV1,
  BushMeshMapCatalogTrustPolicy,
  assertMapCatalogSourceTrusted,
  decodeMapCatalogDocument,
  trustedCatalogManifests,
} from './mapCatalogDocument';
import {BushMeshMapPackManifestV1} from './mapPackManifest';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 1_000_000;

export type MapCatalogFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  nowMs?: number;
};

export type LoadedMapCatalog = {
  sourceUrl: string;
  document: BushMeshMapCatalogDocumentV1;
  manifests: BushMeshMapPackManifestV1[];
  receivedBytes: number;
  loadedAtMs: number;
};

function positiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return resolved;
}

function contentLength(response: Response): number | null {
  const raw = response.headers.get('content-length');
  if (raw === null || raw.trim() === '') {
    return null;
  }

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function assertJsonContentType(response: Response): void {
  const type = response.headers.get('content-type');
  if (type === null) {
    return;
  }

  const normalized = type.toLowerCase();
  if (
    !normalized.includes('application/json') &&
    !normalized.includes('+json') &&
    !normalized.includes('text/json')
  ) {
    throw new Error(`Map catalog returned unsupported content type ${type}.`);
  }
}

/**
 * Fetches a catalog only from locally pinned HTTPS origins, re-checks the final
 * response URL after redirects, caps the decoded document size, then applies
 * catalog ID/age/artifact-host trust policy before returning any manifests.
 */
export async function fetchTrustedMapCatalog(
  sourceUrl: string,
  policy: BushMeshMapCatalogTrustPolicy,
  options: MapCatalogFetchOptions = {},
): Promise<LoadedMapCatalog> {
  assertMapCatalogSourceTrusted(sourceUrl, policy);

  const timeoutMs = positiveInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    'Map catalog timeout',
  );
  const maxBytes = positiveInteger(
    options.maxBytes,
    DEFAULT_MAX_BYTES,
    'Map catalog size limit',
  );
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new Error('Map catalog clock value is invalid.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(sourceUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
      credentials: 'omit',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Map catalog server returned HTTP ${response.status}.`);
    }

    const finalUrl = response.url || sourceUrl;
    assertMapCatalogSourceTrusted(finalUrl, policy);
    assertJsonContentType(response);

    const declaredBytes = contentLength(response);
    if (declaredBytes !== null && declaredBytes > maxBytes) {
      throw new Error(
        `Map catalog declares ${declaredBytes} bytes, above the ${maxBytes}-byte limit.`,
      );
    }

    const serialized = await response.text();
    const receivedBytes = Buffer.byteLength(serialized, 'utf8');
    if (receivedBytes > maxBytes) {
      throw new Error(
        `Map catalog received ${receivedBytes} bytes, above the ${maxBytes}-byte limit.`,
      );
    }

    const document = decodeMapCatalogDocument(serialized);
    const manifests = trustedCatalogManifests(document, policy, nowMs);

    return {
      sourceUrl: finalUrl,
      document,
      manifests,
      receivedBytes,
      loadedAtMs: nowMs,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || /aborted/i.test(error.message))
    ) {
      throw new Error(`Map catalog request timed out after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
