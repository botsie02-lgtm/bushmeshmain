import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Image,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {BushMeshMapPackCatalogEntry} from './mapPackCatalog';
import {
  CONVOY_MAP_TILE_PIXELS,
  ConvoyMapCameraMode,
  ConvoyMapFix,
  ConvoyMapMember,
  ConvoyMapOrientation,
  ConvoyMapOverlay,
  ConvoyMapViewport,
  buildConvoyMapScene,
  coordinateFromScreenOffset,
  coordinateInManifest,
  fitConvoyZoom,
  isOfflineTileUri,
  isValidMapCoordinate,
  planConvoyMapTiles,
  resolveConvoyMapCamera,
  screenPixel,
  selectRenderableMapPack,
} from './convoyMapModel';
import {MapCoordinate} from './offlineMapPacks';
import {nativeOfflineTileSource} from './nativeOfflineTileSource';
import {colors} from '../theme/colors';

export type ConvoyMapTileSource = {
  isAvailable: () => boolean;
  /** Return only a locally readable file/content URI or data-image URI. Never HTTP(S). */
  readTile: (tile: {
    pack: BushMeshMapPackCatalogEntry;
    z: number;
    x: number;
    y: number;
  }) => Promise<string | null>;
};

export type ConvoyMapProps = {
  /** Null means no active convoy: member coordinates are deliberately withheld. */
  activeConvoyId: string | null;
  /** The caller, not the map, must perform active-convoy membership authorisation. */
  authorisedMembers: readonly ConvoyMapMember[];
  selfFix: ConvoyMapFix | null;
  packCatalog: readonly BushMeshMapPackCatalogEntry[];
  tileSource?: ConvoyMapTileSource;
  overlays?: readonly ConvoyMapOverlay[];
  height?: number;
  nowMs?: number;
};

type TileLoadState = 'loading' | 'loaded' | 'missing' | 'error';

const EMPTY_OVERLAYS: readonly ConvoyMapOverlay[] = [];

function statusLabel(ageSeconds: number): string {
  if (ageSeconds < 60) {
    return `${ageSeconds}s ago`;
  }
  if (ageSeconds < 3600) {
    return `${Math.floor(ageSeconds / 60)}m ago`;
  }
  return `${Math.floor(ageSeconds / 3600)}h ago`;
}

function MapButton({label, onPress, selected = false}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{selected}}
      style={[styles.button, selected && styles.selectedButton]}
      onPress={onPress}>
      <Text style={[styles.buttonText, selected && styles.selectedText]}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * A functional, offline-only geographic viewport. No network tile fallback.
 *
 * A verified archive and a tile reader are separate prerequisites: the first
 * is already in BushMesh; the native PMTiles/MBTiles tile reader is not yet.
 * Until a reader is available the UI explicitly says "position plot only".
 */
export function ConvoyMap({
  activeConvoyId,
  authorisedMembers,
  selfFix,
  packCatalog,
  tileSource = nativeOfflineTileSource,
  overlays = EMPTY_OVERLAYS,
  height = 350,
  nowMs,
}: ConvoyMapProps): React.JSX.Element {
  const [clockMs, setClockMs] = useState(() => nowMs ?? Date.now());
  const [viewport, setViewport] = useState<ConvoyMapViewport>({width: 320, height});
  const [cameraMode, setCameraMode] = useState<ConvoyMapCameraMode>('follow-self');
  const [orientation, setOrientation] = useState<ConvoyMapOrientation>('north-up');
  const [requestedPackId, setRequestedPackId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(13);
  const [manualCenter, setManualCenter] = useState<MapCoordinate | null>(null);
  const [uris, setUris] = useState<Record<string, string>>({});
  const [tileState, setTileState] = useState<Record<string, TileLoadState>>({});
  const requestedTilesRef = useRef(new Set<string>());
  const sourceRef = useRef(tileSource);
  const activeArtifactRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const lastFixRef = useRef<ConvoyMapFix | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (nowMs !== undefined) {
      setClockMs(nowMs);
      return;
    }
    const interval = setInterval(() => setClockMs(Date.now()), 10_000);
    return () => clearInterval(interval);
  }, [nowMs]);

  useEffect(() => {
    if (isValidMapCoordinate(selfFix) && Number.isFinite(selfFix.receivedAtMs)) {
      lastFixRef.current = selfFix;
    }
  }, [selfFix]);
  const effectiveSelf = selfFix ?? lastFixRef.current;
  const scene = useMemo(
    () => buildConvoyMapScene(
      effectiveSelf,
      activeConvoyId === null ? [] : authorisedMembers,
      nowMs ?? clockMs,
    ),
    [effectiveSelf, activeConvoyId, authorisedMembers, nowMs, clockMs],
  );
  const pack = useMemo(
    () => selectRenderableMapPack(packCatalog, requestedPackId),
    [packCatalog, requestedPackId],
  );
  const camera = useMemo(
    () => resolveConvoyMapCamera(scene, cameraMode, orientation, manualCenter),
    [scene, cameraMode, orientation, manualCenter],
  );
  const center = camera.center;
  const displayZoom = useMemo(() => {
    if (!pack) {
      return zoom;
    }
    if (cameraMode !== 'frame-convoy' || !center) {
      return Math.max(pack.manifest.minZoom, Math.min(pack.manifest.maxZoom, zoom));
    }
    return fitConvoyZoom(
      (scene.points.some(point => !point.lastKnown)
        ? scene.points.filter(point => !point.lastKnown)
        : scene.points
      ).map(point => point.coordinate),
      center,
      viewport,
      pack.manifest.minZoom,
      pack.manifest.maxZoom,
    );
  }, [pack, cameraMode, center, zoom, scene, viewport]);

  const tiles = useMemo(
    () =>
      pack && center
        ? planConvoyMapTiles(pack, center, displayZoom, viewport, camera.rotationDegrees)
        : [],
    [pack, center, displayZoom, viewport, camera.rotationDegrees],
  );

  const tileKeys = useMemo(
    () => [...new Set(tiles.map(tile => tile.key))],
    [tiles],
  );

  useEffect(() => {
    const artifactKey = pack?.artifact
      ? `${pack.manifest.id}/${pack.manifest.version}/${pack.artifact.localUri}/${pack.artifact.verifiedAtMs}`
      : null;
    if (activeArtifactRef.current !== artifactKey) {
      activeArtifactRef.current = artifactKey;
      requestedTilesRef.current.clear();
      setUris({});
      setTileState({});
    }
    if (sourceRef.current !== tileSource) {
      sourceRef.current = tileSource;
      requestedTilesRef.current.clear();
      setUris({});
      setTileState({});
    }
    if (!pack || !tileSource.isAvailable() || tiles.length === 0) {
      return;
    }

    const unique = new Map(tiles.map(tile => [tile.key, tile]));
    // Keep a bounded cache across GPS updates and pans. Do not re-read the
    // same tile every ten seconds as freshness changes.
    if (requestedTilesRef.current.size > 256) {
      requestedTilesRef.current.clear();
      setUris({});
      setTileState({});
    }
    unique.forEach(tile => {
      if (requestedTilesRef.current.has(tile.key)) {
        return;
      }
      requestedTilesRef.current.add(tile.key);
      // An injected implementation can only return offline local image URIs.
      tileSource.readTile({pack, z: tile.z, x: tile.x, y: tile.y})
        .then(uri => {
          if (!mountedRef.current) {
            return;
          }
          if (!uri || !isOfflineTileUri(uri)) {
            setTileState(current => ({...current, [tile.key]: 'missing'}));
            return;
          }
          setUris(current => ({...current, [tile.key]: uri}));
          setTileState(current => ({...current, [tile.key]: 'loading'}));
        })
        .catch(() => {
          if (mountedRef.current) {
            setTileState(current => ({...current, [tile.key]: 'error'}));
          }
        });
    });
  }, [pack, tileSource, tiles]);

  const loadedTiles = tileKeys.filter(key => tileState[key] === 'loaded').length;
  const missingTiles = tileKeys.filter(
    key => tileState[key] === 'missing' || tileState[key] === 'error',
  ).length;
  const hasReader = tileSource.isAvailable();
  const mapStatus = !pack
    ? 'NO VERIFIED OFFLINE PACK'
    : !hasReader
      ? 'TILE READER UNAVAILABLE'
      : tiles.length === 0
        ? 'VIEW TOO LARGE FOR TILE BUDGET'
        : loadedTiles === tileKeys.length && tileKeys.length > 0
          ? 'OFFLINE BASEMAP READY'
          : loadedTiles > 0
            ? 'PARTIAL OFFLINE BASEMAP'
            : missingTiles > 0
              ? 'LOCAL TILES UNAVAILABLE'
              : 'LOADING OFFLINE TILES';

  const panTo = useCallback((dx: number, dy: number) => {
    if (!center) {
      return;
    }
    const angle = (-camera.rotationDegrees * Math.PI) / 180;
    const mapDx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const mapDy = dx * Math.sin(angle) + dy * Math.cos(angle);
    setManualCenter(coordinateFromScreenOffset(center, displayZoom, mapDx, mapDy));
    setCameraMode('free');
  }, [center, displayZoom, camera.rotationDegrees]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dx) > 8 || Math.abs(gesture.dy) > 8,
    onPanResponderRelease: (_event, gesture) => {
      if (Math.abs(gesture.dx) > 8 || Math.abs(gesture.dy) > 8) {
        panTo(-gesture.dx, -gesture.dy);
      }
    },
    onPanResponderTerminationRequest: () => true,
  }), [panTo]);

  const onLayout = (event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width > 0 && (width !== viewport.width || height !== viewport.height)) {
      setViewport({width, height});
    }
  };

  const renderPoint = (point: (typeof scene.points)[number]) => {
    if (!center) {
      return null;
    }
    const xy = screenPixel(point.coordinate, center, displayZoom, viewport);
    if (xy.left < -90 || xy.left > viewport.width + 90 ||
        xy.top < -90 || xy.top > viewport.height + 90) {
      return null;
    }
    const isSelf = point.kind === 'self';
    const stale = point.lastKnown;
    const heading = point.headingDegrees ?? 0;
    return (
      <View key={point.id} style={[styles.markerAnchor, {left: xy.left, top: xy.top}]}>
        <View style={[
          styles.marker,
          isSelf ? styles.selfMarker : styles.memberMarker,
          stale && styles.lastKnownMarker,
          point.freshness === 'lost' && styles.lostMarker,
        ]}>
          <Text style={[styles.heading, {transform: [{rotate: `${heading}deg`}]}]}>
            ▲
          </Text>
        </View>
        <View style={[styles.markerLabel, {transform: [{rotate: `${-camera.rotationDegrees}deg`}]}]}>
          <Text numberOfLines={1} style={styles.markerName}>{point.label}</Text>
          <Text style={stale ? styles.markerAgeStale : styles.markerAge}>
            {stale ? 'LAST KNOWN · ' : ''}
            {statusLabel(point.ageSeconds)}
          </Text>
        </View>
      </View>
    );
  };

  const lineElements: React.JSX.Element[] = [];
  const overlayPoints: React.JSX.Element[] = [];
  if (center) {
    overlays.forEach(overlay => {
      const points = overlay.points.filter(isValidMapCoordinate);
      if (overlay.kind === 'route' && points.length >= 2) {
        for (let i = 1; i < points.length; i += 1) {
          const a = screenPixel(points[i - 1], center, displayZoom, viewport);
          const b = screenPixel(points[i], center, displayZoom, viewport);
          const length = Math.hypot(b.left - a.left, b.top - a.top);
          if (length > Math.max(viewport.width, viewport.height) * 2) {
            continue;
          }
          lineElements.push(
            <View key={`${overlay.id}:${i}`} style={[
              styles.routeLine,
              {left: a.left, top: a.top, width: length,
                transform: [{rotate: `${Math.atan2(b.top - a.top, b.left - a.left) * 180 / Math.PI}deg`}]},
            ]} />,
          );
        }
      } else if (overlay.kind !== 'route' && points[0]) {
        const xy = screenPixel(points[0], center, displayZoom, viewport);
        overlayPoints.push(
          <View key={overlay.id} style={[styles.overlayAnchor, {left: xy.left, top: xy.top}]}>
            <View style={[styles.overlayPill, {transform: [{rotate: `${-camera.rotationDegrees}deg`}]}]}>
              <Text style={styles.overlayText}>
                {overlay.kind.toUpperCase()} · {overlay.label}
              </Text>
            </View>
          </View>,
        );
      }
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Text style={styles.title}>Offline convoy map</Text>
        <Text style={styles.mapStatus}>{mapStatus}</Text>
      </View>

      <View style={styles.controls}>
        <MapButton label="FOLLOW" selected={cameraMode === 'follow-self'} onPress={() => setCameraMode('follow-self')} />
        <MapButton label="CONVOY" selected={cameraMode === 'frame-convoy'} onPress={() => setCameraMode('frame-convoy')} />
        <MapButton label={orientation === 'north-up' ? 'NORTH ↑' : 'HEADING ↑'}
          onPress={() => setOrientation(value => value === 'north-up' ? 'heading-up' : 'north-up')} />
        <MapButton label="−" onPress={() => {
          if (center) { setManualCenter(center); setCameraMode('free'); }
          setZoom(Math.max(pack?.manifest.minZoom ?? 0, displayZoom - 1));
        }} />
        <MapButton label="+" onPress={() => {
          if (center) { setManualCenter(center); setCameraMode('free'); }
          setZoom(Math.min(pack?.manifest.maxZoom ?? 20, displayZoom + 1));
        }} />
      </View>

      <View style={[styles.canvas, {height}]} onLayout={onLayout} {...panResponder.panHandlers}>
        {center ? (
          <View style={[styles.mapPlane, {width: viewport.width, height: viewport.height,
            transform: [{rotate: `${camera.rotationDegrees}deg`}]}]}>
            {tiles.map(tile => uris[tile.key] ? (
              <Image
                key={tile.key + ':' + tile.left + ':' + tile.top}
                source={{uri: uris[tile.key]}}
                resizeMode="stretch"
                onLoad={() => setTileState(current => current[tile.key] === 'loaded'
                  ? current : {...current, [tile.key]: 'loaded'})}
                onError={() => setTileState(current => ({...current, [tile.key]: 'error'}))}
                style={[styles.tile, {left: tile.left, top: tile.top}]}
              />
            ) : null)}
            {lineElements}
            {overlayPoints}
            {scene.points.map(renderPoint)}
          </View>
        ) : (
          <View style={styles.centerEmpty}>
            <Text style={styles.emptyTitle}>No position to center on</Text>
            <Text style={styles.emptyBody}>GPS is unavailable. A last-known fix or authorised convoy update will restore the view.</Text>
          </View>
        )}
        <View pointerEvents="none" style={styles.bottomLegend}>
          <Text style={styles.legendText}>
            {loadedTiles}/{tileKeys.length} tiles loaded · {missingTiles} unavailable
          </Text>
        </View>
      </View>

      {loadedTiles > 0 && pack?.manifest.attribution ? (
        <Text style={styles.attribution}>{pack.manifest.attribution}</Text>
      ) : null}
      {pack && center && !coordinateInManifest(center, pack.manifest) ? (
        <Text style={styles.warning}>Outside the selected pack's declared coverage. Offline tiles may be missing here.</Text>
      ) : null}
      {!pack ? (
        <Text style={styles.warning}>Download and verify a real map pack before driving offline. Demo coverage is not a basemap.</Text>
      ) : !hasReader ? (
        <Text style={styles.warning}>The map archive is verified, but this Android build has no PMTiles/MBTiles tile-reader bridge. Positions are shown without an offline basemap.</Text>
      ) : null}

      {packCatalog.length > 0 ? (
        <View style={styles.packChoices}>
          <Text style={styles.packHeading}>LOCAL MAP PACK</Text>
          {packCatalog.map(entry => {
            const ready = selectRenderableMapPack([entry], entry.manifest.id) !== null;
            return (
              <MapButton key={entry.manifest.id}
                label={`${entry.manifest.name} · ${ready ? 'VERIFIED' : entry.installState.toUpperCase()}`}
                selected={pack?.manifest.id === entry.manifest.id}
                onPress={() => setRequestedPackId(entry.manifest.id)} />
            );
          })}
          <MapButton label="AUTO" selected={requestedPackId === null}
            onPress={() => setRequestedPackId(null)} />
        </View>
      ) : null}

      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          {activeConvoyId === null ? 'NO ACTIVE CONVOY · OWN POSITION ONLY' :
            `${scene.memberCount} AUTHORISED MEMBERS · ${scene.missingMembers.length} WITHOUT POSITION`}
        </Text>
        <Text style={styles.summaryText}>
          {scene.self?.lastKnown ? 'YOUR GPS · LAST KNOWN' : scene.self ? 'YOUR GPS · FIX RETAINED' : 'YOUR GPS · UNAVAILABLE'}
        </Text>
      </View>
      {scene.missingMembers.length > 0 ? (
        <Text style={styles.missingText}>
          Position unavailable: {scene.missingMembers.map(member => member.label).join(', ')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 14},
  topRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap'},
  title: {color: colors.textPrimary, fontSize: 17, fontWeight: '900'},
  mapStatus: {color: colors.warning, fontSize: 9, fontWeight: '900', letterSpacing: 0.4},
  controls: {flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginVertical: 10},
  button: {borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSoft, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8},
  selectedButton: {backgroundColor: colors.accent, borderColor: colors.accent},
  buttonText: {color: colors.textSecondary, fontSize: 9, fontWeight: '900'},
  selectedText: {color: colors.background},
  canvas: {position: 'relative', overflow: 'hidden', borderRadius: 10, backgroundColor: '#101D23', borderColor: colors.border, borderWidth: 1},
  mapPlane: {position: 'absolute', left: 0, top: 0},
  tile: {width: CONVOY_MAP_TILE_PIXELS, height: CONVOY_MAP_TILE_PIXELS, position: 'absolute'},
  markerAnchor: {position: 'absolute', alignItems: 'center', justifyContent: 'flex-start', width: 0, height: 0},
  marker: {width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center', position: 'absolute', top: -12, left: -12},
  selfMarker: {backgroundColor: colors.accent, borderColor: '#07130A'},
  memberMarker: {backgroundColor: '#44A7CF', borderColor: colors.textPrimary},
  lastKnownMarker: {backgroundColor: colors.warning, borderStyle: 'dashed'},
  lostMarker: {backgroundColor: colors.textMuted, borderColor: colors.warning},
  heading: {color: colors.background, fontSize: 12, fontWeight: '900'},
  markerLabel: {position: 'absolute', top: 14, left: -55, width: 110, alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 3},
  markerName: {color: colors.textPrimary, fontSize: 10, fontWeight: '800'},
  markerAge: {color: colors.success, fontSize: 8},
  markerAgeStale: {color: colors.warning, fontSize: 8, fontWeight: '800'},
  centerEmpty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24},
  emptyTitle: {color: colors.textPrimary, fontSize: 15, fontWeight: '800'},
  emptyBody: {color: colors.textSecondary, fontSize: 11, textAlign: 'center', lineHeight: 17, marginTop: 8},
  bottomLegend: {position: 'absolute', bottom: 5, right: 6, backgroundColor: colors.surface, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4},
  legendText: {color: colors.textSecondary, fontSize: 9},
  routeLine: {height: 3, backgroundColor: colors.accent, position: 'absolute'},
  overlayAnchor: {position: 'absolute', width: 0, height: 0},
  overlayPill: {position: 'absolute', top: -10, left: -45, width: 90, backgroundColor: colors.warning, borderRadius: 7, padding: 3},
  overlayText: {color: colors.background, fontSize: 8, fontWeight: '900', textAlign: 'center'},
  warning: {color: colors.warning, fontSize: 11, lineHeight: 16, marginTop: 9},
  attribution: {color: colors.textSecondary, fontSize: 9, marginTop: 4},
  packChoices: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 12},
  packHeading: {color: colors.textMuted, fontSize: 9, fontWeight: '900'},
  summaryRow: {marginTop: 10, gap: 4},
  summaryText: {color: colors.textSecondary, fontSize: 9, fontWeight: '800'},
  missingText: {color: colors.warning, marginTop: 6, fontSize: 10},
});
