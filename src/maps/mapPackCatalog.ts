import {
  BushMeshInstalledMapArtifact,
  BushMeshMapPackManifestV1,
  installedArtifactMatchesManifest,
  offlineMapPackFromManifest,
  validateMapPackManifest,
} from './mapPackManifest';
import {OfflineMapPack} from './offlineMapPacks';

export type BushMeshMapPackInstallState =
  | 'not-installed'
  | 'installing'
  | 'ready'
  | 'invalid';

export type BushMeshMapPackCatalogEntry = {
  manifest: BushMeshMapPackManifestV1;
  artifact: BushMeshInstalledMapArtifact | null;
  installState: BushMeshMapPackInstallState;
  lastError: string | null;
};

function cloneManifest(
  manifest: BushMeshMapPackManifestV1,
): BushMeshMapPackManifestV1 {
  return {
    ...manifest,
    bounds: {...manifest.bounds},
    source: {...manifest.source},
  };
}

function cloneArtifact(
  artifact: BushMeshInstalledMapArtifact | null,
): BushMeshInstalledMapArtifact | null {
  return artifact === null ? null : {...artifact};
}

export function cloneMapPackCatalogEntry(
  entry: BushMeshMapPackCatalogEntry,
): BushMeshMapPackCatalogEntry {
  return {
    manifest: cloneManifest(entry.manifest),
    artifact: cloneArtifact(entry.artifact),
    installState: entry.installState,
    lastError: entry.lastError,
  };
}

export function registerMapPackManifest(
  current: BushMeshMapPackCatalogEntry[],
  manifest: BushMeshMapPackManifestV1,
): BushMeshMapPackCatalogEntry[] {
  validateMapPackManifest(manifest);
  const existing = current.find(entry => entry.manifest.id === manifest.id) ?? null;
  const retainedArtifact =
    existing?.artifact && installedArtifactMatchesManifest(manifest, existing.artifact)
      ? existing.artifact
      : null;

  const entry: BushMeshMapPackCatalogEntry = {
    manifest: cloneManifest(manifest),
    artifact: cloneArtifact(retainedArtifact),
    installState: retainedArtifact ? 'ready' : 'not-installed',
    lastError: null,
  };

  return [
    entry,
    ...current
      .filter(item => item.manifest.id !== manifest.id)
      .map(cloneMapPackCatalogEntry),
  ];
}

export function markMapPackInstalling(
  current: BushMeshMapPackCatalogEntry[],
  packId: string,
): BushMeshMapPackCatalogEntry[] {
  return current.map(entry =>
    entry.manifest.id === packId
      ? {
          ...cloneMapPackCatalogEntry(entry),
          installState: 'installing' as const,
          lastError: null,
        }
      : cloneMapPackCatalogEntry(entry),
  );
}

export function applyVerifiedMapPackArtifact(
  current: BushMeshMapPackCatalogEntry[],
  packId: string,
  artifact: BushMeshInstalledMapArtifact,
): BushMeshMapPackCatalogEntry[] {
  let found = false;
  const next = current.map(entry => {
    if (entry.manifest.id !== packId) {
      return cloneMapPackCatalogEntry(entry);
    }

    found = true;
    if (!installedArtifactMatchesManifest(entry.manifest, artifact)) {
      throw new Error(
        `Verified map artifact does not match manifest for ${entry.manifest.id}.`,
      );
    }

    return {
      manifest: cloneManifest(entry.manifest),
      artifact: {...artifact},
      installState: 'ready' as const,
      lastError: null,
    };
  });

  if (!found) {
    throw new Error(`Unknown Bushmesh map pack ${packId}.`);
  }
  return next;
}

export function markMapPackInvalid(
  current: BushMeshMapPackCatalogEntry[],
  packId: string,
  message: string,
): BushMeshMapPackCatalogEntry[] {
  return current.map(entry =>
    entry.manifest.id === packId
      ? {
          manifest: cloneManifest(entry.manifest),
          artifact: null,
          installState: 'invalid' as const,
          lastError: message.trim() || 'Map-pack verification failed.',
        }
      : cloneMapPackCatalogEntry(entry),
  );
}

export function markMapPackNotInstalled(
  current: BushMeshMapPackCatalogEntry[],
  packId: string,
): BushMeshMapPackCatalogEntry[] {
  return current.map(entry =>
    entry.manifest.id === packId
      ? {
          manifest: cloneManifest(entry.manifest),
          artifact: null,
          installState: 'not-installed' as const,
          lastError: null,
        }
      : cloneMapPackCatalogEntry(entry),
  );
}

export function removeMapPackCatalogEntry(
  current: BushMeshMapPackCatalogEntry[],
  packId: string,
): BushMeshMapPackCatalogEntry[] {
  return current
    .filter(entry => entry.manifest.id !== packId)
    .map(cloneMapPackCatalogEntry);
}

export function offlineMapPackFromCatalogEntry(
  entry: BushMeshMapPackCatalogEntry,
): OfflineMapPack {
  const derived = offlineMapPackFromManifest(entry.manifest, entry.artifact);

  if (entry.installState === 'installing') {
    return {
      ...derived,
      state: 'downloading',
      checksumVerified: false,
    };
  }
  if (entry.installState === 'invalid') {
    return {
      ...derived,
      state: 'invalid',
      checksumVerified: false,
    };
  }
  if (entry.installState !== 'ready') {
    return {
      ...derived,
      state: 'not-installed',
      checksumVerified: false,
    };
  }

  if (
    entry.artifact === null ||
    !installedArtifactMatchesManifest(entry.manifest, entry.artifact)
  ) {
    return {
      ...derived,
      state: 'invalid',
      checksumVerified: false,
    };
  }

  return derived;
}

export function offlineMapPacksFromCatalog(
  catalog: BushMeshMapPackCatalogEntry[],
): OfflineMapPack[] {
  return catalog.map(offlineMapPackFromCatalogEntry);
}
