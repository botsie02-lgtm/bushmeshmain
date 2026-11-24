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
  accuracyMeters: number | null;
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
  /** Stable React identity for an unwrapped tile instance during small pans. */
  renderKey: string;
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
  kind: 'route' | 'trail' | 'hazard' | 'checkpoint' | 'regroup';
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

function validFix(fix: ConvoyMapFix | null, nowMs: number): fix is ConvoyMapFix {
  return (
    isValidMapCoordinate(fix) &&
    Number.isFinite(fix.receivedAtMs) &&
    fix.receivedAtMs >= 0 &&
    // A future-dated fix must not masquerade as a fresh GPS heading/marker.
    fix.receivedAtMs <= nowMs + 30_000
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
  if (validFix(selfFix, nowMs)) {
    const freshness = getConvoyFreshness(selfFix.receivedAtMs, nowMs);
    self = {
      id: 'self',
      label: 'You',
      kind: 'self',
      coordinate: {latitude: selfFix.latitude, longitude: selfFix.longitude},
      headingDegrees: normalizedHeading(selfFix.headingDegrees),
      accuracyMeters: Number.isFinite(selfFix.accuracyMeters) &&
        selfFix.accuracyMeters != null && selfFix.accuracyMeters >= 0
          ? selfFix.accuracyMeters : null,
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
    if (!validFix(member.position, nowMs)) {
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
      accuracyMeters: Number.isFinite(member.position.accuracyMeters) &&
        member.position.accuracyMeters != null && member.position.accuracyMeters >= 0
          ? member.position.accuracyMeters : null,
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

/** Approximate horizontal GPS error circle in Web Mercator screen pixels. */
export function mapAccuracyRadiusPixels(
  latitude: number, zoom: number, accuracyMeters: number | null,
): number | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(zoom) ||
      accuracyMeters === null || !Number.isFinite(accuracyMeters) ||
      accuracyMeters < 0) return null;
  const metersPerPixel =
    156543.03392804097 * Math.max(0.01, Math.cos(latitude * Math.PI / 180)) /
    2 ** zoom;
  return Math.min(90, Math.max(3, accuracyMeters / metersPerPixel));
}

export function normalizedHeading(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return ((value % 360) + 360) % 360;
}

/**
 * Ignore subpixel GPS jitter and minor heading variation while following.
 * No inertial/animated positioning is claimed: large changes remain immediate.
 */
export function stabilizeConvoyMapCamera(
  previous: ConvoyMapCamera | null,
  next: ConvoyMapCamera,
  zoom: number,
  minPixelChange = 3,
): ConvoyMapCamera {
  if (!previous || previous.mode !== next.mode ||
      !previous.center || !next.center) return next;
  const a = worldPixel(previous.center, zoom);
  const b = worldPixel(next.center, zoom);
  const worldWidth = CONVOY_MAP_TILE_PIXELS * 2 ** zoom;
  const longitudeDistance = Math.abs(a.x - b.x);
  const dx = Math.min(longitudeDistance, worldWidth - longitudeDistance);
  const dy = a.y - b.y;
  const stableCenter = Math.hypot(dx, dy) < minPixelChange
    ? previous.center : next.center;
  const rotationDelta = Math.abs(
    ((next.rotationDegrees - previous.rotationDegrees + 540) % 360) - 180,
  );
  return {
    ...next,
    center: stableCenter,
    rotationDegrees: rotationDelta < 2
      ? previous.rotationDegrees : next.rotationDegrees,
  };
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

/** Centre of a reviewed region, including antimeridian-wrapping bounds. */
export function mapPackBoundsCenter(manifest: BushMeshMapPackManifestV1): MapCoordinate {
  const {south, north, west, east} = manifest.bounds;
  const halfLongitude = west <= east ? (west + east) / 2 : (west + (east + 360)) / 2;
  const longitude = ((halfLongitude + 180) % 360 + 360) % 360 - 180;
  return {latitude: (south + north) / 2, longitude};
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
/** Reject tiles that do not intersect the declared, verified region. */
export function tileIntersectsMapPack(
  tile: {z: number; x: number; y: number},
  manifest: BushMeshMapPackManifestV1,
): boolean {
  const {z, x, y} = tile;
  if (!Number.isInteger(z) || z < 0 || z > 24 ||
      !Number.isInteger(x) || !Number.isInteger(y)) return false;
  const count = 2 ** z;
  if (x < 0 || x >= count || y < 0 || y >= count) return false;
  const tileWest = x / count * 360 - 180;
  const tileEast = (x + 1) / count * 360 - 180;
  const latitudeAt = (row: number) =>
    Math.atan(Math.sinh(Math.PI * (1 - 2 * row / count))) * 180 / Math.PI;
  const tileNorth = latitudeAt(y);
  const tileSouth = latitudeAt(y + 1);
  const bounds = manifest.bounds;
  if (tileNorth < bounds.south || tileSouth > bounds.north) return false;
  return bounds.west <= bounds.east
    ? tileEast >= bounds.west && tileWest <= bounds.east
    : (tileWest <= bounds.east || tileEast >= bounds.west);
}

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
      if (!tileIntersectsMapPack({z, x, y}, pack.manifest)) continue;
      tiles.push({
        renderKey: String(unwrappedX) + '/' + String(y),
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
