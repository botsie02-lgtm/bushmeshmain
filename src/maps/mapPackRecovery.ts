import {
  BushMeshMapPackCatalogEntry,
  cloneMapPackCatalogEntry,
  markMapPackInvalid,
  markMapPackNotInstalled,
  applyVerifiedMapPackArtifact,
} from './mapPackCatalog';
import {
  BushMeshInstalledMapArtifact,
  BushMeshMapPackManifestV1,
} from './mapPackManifest';

/**
 * On restart, persistent catalog metadata is not proof that files still exist
 * or retain their SHA-256. Recheck each claimed-ready artifact using the
 * existing native installer/verifier before making it map-renderable.
 *
 * This never fetches remote content. A missing file is not ready; a verifier
 * error becomes visible as invalid rather than silently trusting stale data.
 */
export async function revalidateRestoredMapCatalog(
  catalog: readonly BushMeshMapPackCatalogEntry[],
  verify: (manifest: BushMeshMapPackManifestV1) => Promise<BushMeshInstalledMapArtifact | null>,
): Promise<BushMeshMapPackCatalogEntry[]> {
  let next = catalog.map(cloneMapPackCatalogEntry);
  for (const entry of catalog) {
    if (entry.installState !== 'ready' || entry.artifact === null) {
      continue;
    }
    try {
      const artifact = await verify(entry.manifest);
      next = artifact
        ? applyVerifiedMapPackArtifact(next, entry.manifest.id, artifact)
        : markMapPackNotInstalled(next, entry.manifest.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown native map verification error.';
      next = markMapPackInvalid(
        next,
        entry.manifest.id,
        `On-device map verification failed: ${message}`,
      );
    }
  }
  return next;
}
