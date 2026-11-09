import {
  BushMeshMapPackManifestV1,
  decodeMapPackManifest,
} from './mapPackManifest';

/**
 * Manual field-test trust ceremony. This is OPERATOR-REVIEWED, NOT a
 * cryptographically signed publisher catalog. Independent fingerprint review
 * is required; the resulting *archive bytes* are checked by Android SHA-256.
 */
export function decodeOperatorReviewedMapManifest(
  raw: string,
  independentlyReviewedSha256: string,
  reviewConfirmed: boolean,
): BushMeshMapPackManifestV1 {
  if (raw.length === 0 || raw.length > 12_000) {
    throw new Error('Reviewed manifest must be between 1 and 12,000 characters.');
  }
  const manifest = decodeMapPackManifest(raw);
  if (!manifest.attribution || manifest.attribution.trim() === '') {
    throw new Error('Map source and licensing attribution are required.');
  }
  if (manifest.source.kind === 'import' &&
      manifest.expectedBytes > 512 * 1024 * 1024) {
    throw new Error('Android local document import is limited to 512 MiB.');
  }
  if (!/^[0-9a-f]{64}$/i.test(independentlyReviewedSha256.trim())) {
    throw new Error('Enter the independently reviewed 64-character archive SHA-256.');
  }
  if (manifest.sha256.toLowerCase() !== independentlyReviewedSha256.trim().toLowerCase()) {
    throw new Error('Reviewed fingerprint does not match manifest SHA-256.');
  }
  if (!reviewConfirmed) {
    throw new Error('Confirm the source licence and independently reviewed fingerprint before registration.');
  }
  return manifest;
}
