export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type MapBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type OfflineMapPackState =
  | 'not-installed'
  | 'downloading'
  | 'ready'
  | 'invalid';

export type OfflineMapPack = {
  id: string;
  name: string;
  version: string;
  bounds: MapBounds;
  state: OfflineMapPackState;
  downloadedBytes: number;
  totalBytes: number | null;
  checksumVerified: boolean;
};

export type TripMapCoverage = {
  complete: boolean;
  coveredPointCount: number;
  totalPointCount: number;
  missingPointIndexes: number[];
  readyPackIds: string[];
};

function validLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function validLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function validateMapBounds(bounds: MapBounds): string | null {
  if (!validLatitude(bounds.south) || !validLatitude(bounds.north)) {
    return 'Map bounds latitude must be between -90 and 90 degrees.';
  }

  if (!validLongitude(bounds.west) || !validLongitude(bounds.east)) {
    return 'Map bounds longitude must be between -180 and 180 degrees.';
  }

  if (bounds.south > bounds.north) {
    return 'Map bounds south latitude cannot be north of the north latitude.';
  }

  return null;
}

export function coordinateInBounds(
  coordinate: MapCoordinate,
  bounds: MapBounds,
): boolean {
  if (validateMapBounds(bounds) !== null) {
    return false;
  }

  if (
    !validLatitude(coordinate.latitude) ||
    !validLongitude(coordinate.longitude) ||
    coordinate.latitude < bounds.south ||
    coordinate.latitude > bounds.north
  ) {
    return false;
  }

  if (bounds.west <= bounds.east) {
    return (
      coordinate.longitude >= bounds.west && coordinate.longitude <= bounds.east
    );
  }

  // A west value greater than east means this pack crosses the antimeridian.
  return coordinate.longitude >= bounds.west || coordinate.longitude <= bounds.east;
}

export function isOfflineMapPackReady(pack: OfflineMapPack): boolean {
  if (validateMapBounds(pack.bounds) !== null) {
    return false;
  }

  if (pack.state !== 'ready' || !pack.checksumVerified) {
    return false;
  }

  if (pack.downloadedBytes < 0) {
    return false;
  }

  if (pack.totalBytes !== null) {
    if (pack.totalBytes <= 0 || pack.downloadedBytes < pack.totalBytes) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluates an intended trip against locally verified map packs.
 *
 * A route is only marked complete when every supplied point is covered by at
 * least one ready, checksum-verified pack. This prevents the UI from claiming
 * "offline ready" merely because some map data happens to be installed.
 */
export function getTripMapCoverage(
  packs: OfflineMapPack[],
  requiredPoints: MapCoordinate[],
): TripMapCoverage {
  const readyPacks = packs.filter(isOfflineMapPackReady);
  const missingPointIndexes: number[] = [];

  requiredPoints.forEach((point, index) => {
    const covered = readyPacks.some(pack => coordinateInBounds(point, pack.bounds));
    if (!covered) {
      missingPointIndexes.push(index);
    }
  });

  return {
    complete: requiredPoints.length > 0 && missingPointIndexes.length === 0,
    coveredPointCount: requiredPoints.length - missingPointIndexes.length,
    totalPointCount: requiredPoints.length,
    missingPointIndexes,
    readyPackIds: readyPacks.map(pack => pack.id),
  };
}

export function getMapPackDownloadProgress(pack: OfflineMapPack): number | null {
  if (pack.totalBytes === null || pack.totalBytes <= 0) {
    return null;
  }

  return Math.max(0, Math.min(1, pack.downloadedBytes / pack.totalBytes));
}
