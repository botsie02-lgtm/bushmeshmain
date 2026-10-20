import {NativeModules, Platform} from 'react-native';

import {
  BushMeshInstalledMapArtifact,
  BushMeshMapPackManifestV1,
  installedArtifactMatchesManifest,
  validateMapPackManifest,
} from '../maps/mapPackManifest';

type NativeMapPackArtifact = {
  packId?: unknown;
  manifestVersion?: unknown;
  format?: unknown;
  localUri?: unknown;
  bytes?: unknown;
  sha256?: unknown;
  verifiedAtMs?: unknown;
};

type NativeMapPackModule = {
  downloadPack: (
    packId: string,
    manifestVersion: string,
    sourceUrl: string,
    expectedBytes: number,
    expectedSha256: string,
    format: string,
  ) => Promise<NativeMapPackArtifact>;
  verifyPack: (
    packId: string,
    manifestVersion: string,
    expectedBytes: number,
    expectedSha256: string,
    format: string,
  ) => Promise<NativeMapPackArtifact | null>;
  removePack: (packId: string) => Promise<boolean>;
};

const module = NativeModules.BushMeshMapPacks as NativeMapPackModule | undefined;

function normalizeFileUri(value: string): string {
  if (value.startsWith('file://')) {
    return value;
  }
  if (value.startsWith('file:/')) {
    return `file://${value.slice('file:'.length)}`;
  }
  return value;
}

function artifactFromNative(
  value: NativeMapPackArtifact,
): BushMeshInstalledMapArtifact {
  if (
    typeof value.packId !== 'string' ||
    value.packId.trim() === '' ||
    typeof value.manifestVersion !== 'string' ||
    value.manifestVersion.trim() === '' ||
    (value.format !== 'pmtiles' && value.format !== 'mbtiles') ||
    typeof value.localUri !== 'string' ||
    value.localUri.trim() === '' ||
    typeof value.bytes !== 'number' ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes <= 0 ||
    typeof value.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(value.sha256) ||
    typeof value.verifiedAtMs !== 'number' ||
    !Number.isFinite(value.verifiedAtMs) ||
    value.verifiedAtMs < 0
  ) {
    throw new Error('Android returned an invalid Bushmesh map-pack artifact.');
  }

  return {
    packId: value.packId,
    manifestVersion: value.manifestVersion,
    format: value.format,
    localUri: normalizeFileUri(value.localUri),
    bytes: value.bytes,
    sha256: value.sha256.toLowerCase(),
    verifiedAtMs: value.verifiedAtMs,
  };
}

function assertArtifactMatchesManifest(
  manifest: BushMeshMapPackManifestV1,
  artifact: BushMeshInstalledMapArtifact,
): void {
  if (!installedArtifactMatchesManifest(manifest, artifact)) {
    throw new Error(
      'Verified Android map-pack artifact does not match its Bushmesh manifest.',
    );
  }
}

export const nativeMapPacks = {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  },

  async download(
    manifest: BushMeshMapPackManifestV1,
  ): Promise<BushMeshInstalledMapArtifact> {
    validateMapPackManifest(manifest);
    if (!this.isSupported() || !module) {
      throw new Error('Native Bushmesh map-pack installation is unavailable.');
    }
    if (manifest.source.kind !== 'remote') {
      throw new Error('This map-pack manifest is not a remote download source.');
    }

    const nativeArtifact = await module.downloadPack(
      manifest.id,
      manifest.version,
      manifest.source.url,
      manifest.expectedBytes,
      manifest.sha256,
      manifest.format,
    );
    const artifact = artifactFromNative(nativeArtifact);
    assertArtifactMatchesManifest(manifest, artifact);
    return artifact;
  },

  async verify(
    manifest: BushMeshMapPackManifestV1,
  ): Promise<BushMeshInstalledMapArtifact | null> {
    validateMapPackManifest(manifest);
    if (!this.isSupported() || !module) {
      return null;
    }

    const nativeArtifact = await module.verifyPack(
      manifest.id,
      manifest.version,
      manifest.expectedBytes,
      manifest.sha256,
      manifest.format,
    );
    if (nativeArtifact === null) {
      return null;
    }

    const artifact = artifactFromNative(nativeArtifact);
    assertArtifactMatchesManifest(manifest, artifact);
    return artifact;
  },

  async remove(packId: string): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }
    if (!/^[a-z0-9][a-z0-9._-]{2,127}$/i.test(packId)) {
      throw new Error('Invalid Bushmesh map-pack ID.');
    }

    const removed = await module.removePack(packId);
    if (!removed) {
      throw new Error('Android could not remove the Bushmesh map pack.');
    }
  },
};
