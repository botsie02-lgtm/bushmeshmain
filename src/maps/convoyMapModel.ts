import {
  ConvoyFreshness,
  getConvoyFreshness,
} from '../convoy/convoy';
import {
  BushMeshMapPackCatalogEntry,
  offlineMapPackFromCatalogEntry,
} from './mapPackCatalog';
import {BushMeshMapPackManifestV1} from './mapPackManifest';
import {coordinateInBounds, MapCoordinate, isOfflineMapPackReady} from './offlineMapPacks';
import {operationalBoundsForCoordinates} from './operationalPicture';

export const CONVOY_MAP_TILE_PIXELS = 256;
export const CONVOY_MAP_MAX_TILES = 100;
const MERCATOR_LATITUDE_LIMIT = 85.05112878;

export type ConvoyMapFix = MapCoordinate & {
  receivedAtMs: number;
  headingDegrees: number | null;
  accuracyMeters?: number | null;
};

/** Callers MUST supply only authorised members of the currently active convoy. */
export type ConvoyMapMember = {
  id: string;
  label: string;
  position: ConvoyMapFix | null;
};

export type ConvoyMapPoint = {
  id: string;
  label: string;
  kind: 'self' | 'member';
  coordinate: MapCoordinate;
  headingDegrees: number | null;
  freshness: 'self' | ConvoyFreshness;
  lastKnown: boolean;
  ageSeconds: number;
};

export type ConvoyMapMissingMember = {id: string; label: string};

export type ConvoyMapScene = {
  points: ConvoyMapPoint[];
  missingMembers: ConvoyMapMissingMember[];
  self: ConvoyMapPoint | null;
  memberCount: number;
};

export type ConvoyMapCameraMode = 'follow-self' | 'frame-convoy' | 'free';
export type ConvoyMapOrientation = 'north-up' | 'heading-up';
export type ConvoyMapCamera = {
  center: MapCoordinate | null;
  mode: ConvoyMapCameraMode;
  rotationDegrees: number;
};

export type ConvoyMapTile = {
  key: string;
  packId: string;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
};

export type ConvoyMapViewport = {width: number; height: number};

export type ConvoyMapOverlay = {
  id: string;
  kind: 'route' | 'hazard' | 'checkpoint' | 'regroup';
  label: string;
  points: MapCoordinate[];
};

export function isValidMapCoordinate(value: MapCoordinate | null | undefined): value is MapCoordinate {
  return (
    !!value &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

function validFix(fix: ConvoyMapFix | null): fix is ConvoyMapFix {
  return (
    isValidMapCoordinate(fix) &&
    Number.isFinite(fix.receivedAtMs) &&
    fix.receivedAtMs >= 0
  );
}

export function buildConvoyMapScene(
  selfFix: ConvoyMapFix | null,
  authorisedMembers: readonly ConvoyMapMember[],
  nowMs = Date.now(),
): ConvoyMapScene {
  const points: ConvoyMapPoint[] = [];
  const missingMembers: ConvoyMapMissingMember[] = [];
  const seen = new Set<string>();

  let self: ConvoyMapPoint | null = null;
  if (validFix(selfFix)) {
    const freshness = getConvoyFreshness(selfFix.receivedAtMs, nowMs);
    self = {
      id: 'self',
      label: 'You',
      kind: 'self',
      coordinate: {latitude: selfFix.latitude, longitude: selfFix.longitude},
      headingDegrees: normalizedHeading(selfFix.headingDegrees),
      freshness: 'self',
      lastKnown: freshness === 'stale' || freshness === 'lost',
      ageSeconds: Math.max(0, Math.floor((nowMs - selfFix.receivedAtMs) / 1000)),
    };
    points.push(self);
  }

  for (const member of authorisedMembers) {
    if (!member.id || seen.has(member.id) || seen.size >= 256) {
      continue;
    }
    seen.add(member.id);
    const label = member.label.trim() || member.id;
    if (!validFix(member.position)) {
      missingMembers.push({id: member.id, label});
      continue;
    }

    const freshness = getConvoyFreshness(member.position.receivedAtMs, nowMs);
    points.push({
      id: member.id,
      label,
      kind: 'member',
      coordinate: {
        latitude: member.position.latitude,
        longitude: member.position.longitude,
      },
      headingDegrees: normalizedHeading(member.position.headingDegrees),
      freshness,
      lastKnown: freshness === 'stale' || freshness === 'lost',
      ageSeconds: Math.max(
        0,
        Math.floor((nowMs - member.position.receivedAtMs) / 1000),
      ),
    });
  }

  return {points, missingMembers, self, memberCount: seen.size};
}

export function normalizedHeading(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return ((value % 360) + 360) % 360;
}

export function resolveConvoyMapCamera(
  scene: ConvoyMapScene,
  mode: ConvoyMapCameraMode,
  orientation: ConvoyMapOrientation,
  previousCenter: MapCoordinate | null,
): ConvoyMapCamera {
  // Avoid zooming far away just because a historically known vehicle is
  // now lost; retain those markers, but frame current fixes preferentially.
  const currentPoints = scene.points.filter(point => !point.lastKnown);
  const coordinates = (currentPoints.length > 0 ? currentPoints : scene.points)
    .map(point => point.coordinate);
  const fallback = isValidMapCoordinate(previousCenter) ? previousCenter : null;
  const framed = operationalBoundsForCoordinates(coordinates)?.center ?? null;

  let center: MapCoordinate | null;
  if (mode === 'free') {
    center = fallback ?? framed;
  } else if (mode === 'follow-self') {
    center = scene.self?.coordinate ?? fallback ?? framed;
  } else {
    center = framed ?? fallback;
  }

  // Never use a stale heading to rotate the map: north-up is a safe fallback.
  const freshSelf = scene.self && !scene.self.lastKnown;
  return {
    mode,
    center,
    rotationDegrees:
      orientation === 'heading-up' && freshSelf && scene.self?.headingDegrees != null
        ? -scene.self.headingDegrees
        : 0,
  };
}

/** A verified artifact is required; catalog metadata is not map tile data. */
export function selectRenderableMapPack(
  catalog: readonly BushMeshMapPackCatalogEntry[],
  selectedPackId: string | null,
): BushMeshMapPackCatalogEntry | null {
  const candidates = selectedPackId === null
    ? catalog
    : catalog.filter(entry => entry.manifest.id === selectedPackId);
  return (
    candidates.find(entry =>
      entry.artifact !== null &&
      isOfflineMapPackReady(offlineMapPackFromCatalogEntry(entry)),
    ) ?? null
  );
}

export function coordinateInManifest(
  coordinate: MapCoordinate,
  manifest: BushMeshMapPackManifestV1,
): boolean {
  return coordinateInBounds(coordinate, manifest.bounds);
}

export function worldPixel(coordinate: MapCoordinate, zoom: number): {x: number; y: number} {
  const latitude = Math.max(-MERCATOR_LATITUDE_LIMIT, Math.min(MERCATOR_LATITUDE_LIMIT, coordinate.latitude));
  const scale = CONVOY_MAP_TILE_PIXELS * 2 ** zoom;
  const sine = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((coordinate.longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale,
  };
}

function nearestWrappedX(x: number, centerX: number, zoom: number): number {
  const world = CONVOY_MAP_TILE_PIXELS * 2 ** zoom;
  return x + Math.round((centerX - x) / world) * world;
}

export function screenPixel(
  coordinate: MapCoordinate,
  center: MapCoordinate,
  zoom: number,
  viewport: ConvoyMapViewport,
): {left: number; top: number} {
  const projected = worldPixel(coordinate, zoom);
  const origin = worldPixel(center, zoom);
  return {
    left: viewport.width / 2 + nearestWrappedX(projected.x, origin.x, zoom) - origin.x,
    top: viewport.height / 2 + projected.y - origin.y,
  };
}

export function coordinateFromScreenOffset(
  center: MapCoordinate,
  zoom: number,
  dx: number,
  dy: number,
): MapCoordinate {
  const world = CONVOY_MAP_TILE_PIXELS * 2 ** zoom;
  const origin = worldPixel(center, zoom);
  const x = ((origin.x + dx) % world + world) % world;
  const y = Math.max(0, Math.min(world, origin.y + dy));
  const normalizedY = 0.5 - y / world;
  return {
    latitude: (360 / Math.PI) * Math.atan(Math.exp(normalizedY * 2 * Math.PI)) - 90,
    longitude: (x / world) * 360 - 180,
  };
}

export function fitConvoyZoom(
  points: readonly MapCoordinate[],
  center: MapCoordinate,
  viewport: ConvoyMapViewport,
  minZoom: number,
  maxZoom: number,
): number {
  if (points.length < 2) {
    return Math.max(minZoom, Math.min(maxZoom, 14));
  }
  for (let zoom = maxZoom; zoom >= minZoom; zoom -= 1) {
    if (points.every(point => {
      const pixel = screenPixel(point, center, zoom, viewport);
      return (
        Math.abs(pixel.left - viewport.width / 2) <= Math.max(0, viewport.width / 2 - 50) &&
        Math.abs(pixel.top - viewport.height / 2) <= Math.max(0, viewport.height / 2 - 50)
      );
    })) {
      return zoom;
    }
  }
  return minZoom;
}

/** Bounded viewport tile plan; no download, network access or archive parsing. */
export function planConvoyMapTiles(
  pack: BushMeshMapPackCatalogEntry,
  center: MapCoordinate,
  zoom: number,
  viewport: ConvoyMapViewport,
  rotationDegrees = 0,
): ConvoyMapTile[] {
  if (
    !selectRenderableMapPack([pack], pack.manifest.id) ||
    !isValidMapCoordinate(center) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return [];
  }
  const z = Math.min(pack.manifest.maxZoom, Math.max(pack.manifest.minZoom, Math.round(zoom)));
  const origin = worldPixel(center, z);
  const count = 2 ** z;
  const diagonal = rotationDegrees === 0
    ? null
    : Math.sqrt(viewport.width ** 2 + viewport.height ** 2);
  const width = diagonal ?? viewport.width;
  const height = diagonal ?? viewport.height;
  const minX = Math.floor((origin.x - width / 2) / CONVOY_MAP_TILE_PIXELS);
  const maxX = Math.floor((origin.x + width / 2) / CONVOY_MAP_TILE_PIXELS);
  const minY = Math.max(0, Math.floor((origin.y - height / 2) / CONVOY_MAP_TILE_PIXELS));
  const maxY = Math.min(count - 1, Math.floor((origin.y + height / 2) / CONVOY_MAP_TILE_PIXELS));
  if ((maxX - minX + 1) * Math.max(0, maxY - minY + 1) > CONVOY_MAP_MAX_TILES) {
    return [];
  }

  const tiles: ConvoyMapTile[] = [];
  for (let unwrappedX = minX; unwrappedX <= maxX; unwrappedX += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const x = ((unwrappedX % count) + count) % count;
      tiles.push({
        key: `${pack.manifest.id}@${pack.manifest.version}/${z}/${x}/${y}`,
        packId: pack.manifest.id,
        z,
        x,
        y,
        left: unwrappedX * CONVOY_MAP_TILE_PIXELS - origin.x + viewport.width / 2,
        top: y * CONVOY_MAP_TILE_PIXELS - origin.y + viewport.height / 2,
      });
    }
  }
  return tiles;
}

/** Never allow a remote URL to turn an offline map view into an online request. */
export function isOfflineTileUri(uri: string): boolean {
  return (
    /^file:\/\/[^\s]+$/i.test(uri) ||
    /^content:\/\/[^\s]+$/i.test(uri) ||
    /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(uri)
  );
}
