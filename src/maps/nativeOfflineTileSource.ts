import {NativeModules, Platform} from 'react-native';
import {ConvoyMapTileSource} from './ConvoyMap';

/**
 * Optional native archive reader contract.
 *
 * Existing BushMeshMapPacks downloads/verifies PMTiles or MBTiles archives but
 * does not extract tiles. This adapter deliberately reports unavailable until
 * a native read-only tile bridge is installed by the Android owner. It never
 * falls back to network tiles or treats an archive URI as an image.
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
      !/^[a-z0-9+/]+={0,2}$/i.test(tile.base64)
    ) {
      return null;
    }
    return `data:${tile.mimeType};base64,${tile.base64}`;
  },
};
