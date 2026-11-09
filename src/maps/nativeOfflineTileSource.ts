import {NativeModules, Platform} from 'react-native';
import type {ConvoyMapTileSource} from './ConvoyMap';

/**
 * Android native archive tile reader contract.
 *
 * BushMeshOfflineTiles reads real raster images only from archives previously
 * SHA-256 verified by BushMeshMapPacks. No arbitrary path or online fallback.
 */
type BushMeshOfflineTilesModule = {
  readTileBase64: (
    packId: string,
    manifestVersion: string,
    format: 'pmtiles' | 'mbtiles',
    z: number,
    x: number,
    y: number,
  ) => Promise<{mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string} | null>;
};

const nativeModule = NativeModules.BushMeshOfflineTiles as
  | BushMeshOfflineTilesModule
  | undefined;

export const nativeOfflineTileSource: ConvoyMapTileSource = {
  isAvailable: () =>
    Platform.OS === 'android' &&
    typeof nativeModule?.readTileBase64 === 'function',

  async readTile({pack, z, x, y}) {
    if (!nativeOfflineTileSource.isAvailable() || !nativeModule || !pack.artifact) {
      return null;
    }
    const tile = await nativeModule.readTileBase64(
      pack.manifest.id,
      pack.manifest.version,
      pack.manifest.format,
      z,
      x,
      y,
    );
    if (
      !tile ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(tile.mimeType) ||
      tile.base64.length > 1_400_000 ||
      !/^[a-z0-9+/]+={0,2}$/i.test(tile.base64)
    ) {
      return null;
    }
    return `data:${tile.mimeType};base64,${tile.base64}`;
  },
};
