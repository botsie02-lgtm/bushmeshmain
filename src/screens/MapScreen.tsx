import React, {useEffect, useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {buddyTailDistanceMeters} from '../convoy/buddyTails';
import {
  distanceMeters,
  formatDistance,
  getConvoyFreshness,
} from '../convoy/convoy';
import {
  FieldNavigationTarget,
  fieldTargetLabel,
  getFieldTargetGuidance,
} from '../convoy/fieldTarget';
import {getMovingTargetGuidance} from '../convoy/movingTarget';
import {
  OperationalMarker,
  activeOperationalMarkers,
} from '../convoy/operationalMarkers';
import {ConvoyMap, ConvoyMapTileSource} from '../maps/ConvoyMap';
import {ConvoyMapMember, ConvoyMapOverlay} from '../maps/convoyMapModel';
import {projectOfflinePolyline, projectOfflineTrack} from '../maps/offlineTrackProjection';
import {projectFieldChannelPositions, type FieldChannelPosition} from '../maps/fieldChannelPositionAdapter';
import {ConnectedChannelFieldLocation} from '../convoy/fieldLocation/ConnectedChannelFieldLocation';
import {MapPackCatalogPanel} from '../components/MapPackCatalogPanel';
import {useConvoy} from '../state/ConvoyContext';
import {useDrive} from '../state/DriveContext';
import {useLocationSession} from '../state/LocationSessionContext';
import {useOfflineMaps} from '../state/OfflineMapContext';
import {useRouteSession} from '../state/RouteSessionContext';
import {colors} from '../theme/colors';

function markerLabel(type: string): string {
  switch (type) {
    case 'stop':
      return 'STOP';
    case 'hazard':
      return 'HAZARD';
    case 'regroup':
      return 'REGROUP';
    case 'help':
      return 'HELP';
    default:
      return type.toUpperCase();
  }
}

function formatAge(ageSeconds: number): string {
  if (ageSeconds < 60) {
    return `${ageSeconds}s`;
  }
  if (ageSeconds < 3_600) {
    return `${Math.floor(ageSeconds / 60)}m`;
  }
  return `${Math.floor(ageSeconds / 3_600)}h`;
}

function canNavigateToMarker(marker: OperationalMarker): boolean {
  return marker.type === 'regroup' || marker.type === 'help';
}

function fieldTargetFromMarker(marker: OperationalMarker): FieldNavigationTarget {
  return {
    id: marker.id,
    label: fieldTargetLabel(marker.type),
    type: marker.type,
    latitude: marker.latitude,
    longitude: marker.longitude,
    senderId: marker.senderId,
    createdAtMs: marker.createdAtMs,
    expiresAtMs: marker.expiresAtMs,
  };
}

export type MapScreenProps = {
  activeConvoyId?: string | null;
  authorisedMembers?: readonly ConvoyMapMember[];
  overlays?: readonly ConvoyMapOverlay[];
  tileSource?: ConvoyMapTileSource;
  /** Navigate to Device > Offline map packs; never starts installation here. */
  onManageMapPacks?: () => void;
  /** Explicit staging screen mount; never starts sharing. */
  showChannelFieldTest?: boolean;
};

export function MapScreen({
  activeConvoyId = null,
  authorisedMembers = [],
  overlays = [],
  tileSource,
  onManageMapPacks,
  showChannelFieldTest = false,
}: MapScreenProps = {}): React.JSX.Element {
  const {
    vehicles,
    buddyTails,
    localPosition,
    navigationTargetVehicleId,
    navigationTargetVehicle,
    navigationFieldTarget,
    setNavigationTarget,
    setNavigationFieldTarget,
    clearNavigationTarget,
  } = useConvoy();
  const {operationalMarkers} = useDrive();
  const {
    latestFix,
    trackPoints,
    trackDistanceMeters,
    trackStartedAtMs,
    clearTrack,
  } = useLocationSession();
  const {
    packs,
    packCatalog,
    coverage,
    requiredTripPoints,
    loadDemoHighCountryPack,
    clearMapState,
  } = useOfflineMaps();
  const [nowMs, setNowMs] = useState(Date.now());
  const {activePlan, progress: routeProgress, status: routeStatus} = useRouteSession();
  const [showRadioPositions, setShowRadioPositions] = useState(false);
  const [showMapDiagnostics, setShowMapDiagnostics] = useState(false);
  const [confirmClearMapState, setConfirmClearMapState] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const activeMarkers = useMemo(
    () => activeOperationalMarkers(operationalMarkers, nowMs),
    [operationalMarkers, nowMs],
  );
  const recentTrackPoints = useMemo(
    () => trackPoints.slice(-5).reverse(),
    [trackPoints],
  );
  const trail = useMemo(() => projectOfflineTrack(trackPoints), [trackPoints]);
  const [explicitChannelMarkers, setExplicitChannelMarkers] = useState<FieldChannelPosition[]>([]);
  const fieldChannelPositions = useMemo(
    () => [...explicitChannelMarkers, ...projectFieldChannelPositions(vehicles, nowMs)],
    [explicitChannelMarkers, vehicles, nowMs],
  );
  const projectedRoute = useMemo(
    () => activePlan ? projectOfflinePolyline(activePlan.geometry) : [],
    [activePlan],
  );
  const visibleOverlays = useMemo<ConvoyMapOverlay[]>(() => [
    ...overlays,
    ...(projectedRoute.length >= 2 && activePlan ? [{
      id: 'offline-route:' + activePlan.id,
      kind: 'route' as const,
      label: 'Local route engine',
      points: projectedRoute,
    }] : []),
    ...(trail.vertices.length >= 2 ? [{
      id: 'local-recorded-trail',
      kind: 'trail' as const,
      label: 'Recorded GPS trail',
      points: trail.vertices,
    }] : []),
  ], [overlays, projectedRoute, activePlan, trail]);
  const movingTarget = useMemo(
    () => getMovingTargetGuidance(localPosition, navigationTargetVehicle, nowMs),
    [localPosition, navigationTargetVehicle, nowMs],
  );
  const fixedTarget = useMemo(
    () => getFieldTargetGuidance(localPosition, navigationFieldTarget, nowMs),
    [localPosition, navigationFieldTarget, nowMs],
  );
  const buddyTailByVehicle = useMemo(
    () => new Map(buddyTails.map(tail => [tail.vehicleId, tail])),
    [buddyTails],
  );

  const hasNavigationTarget =
    navigationTargetVehicleId !== null || navigationFieldTarget !== null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>OFFLINE OPERATING PICTURE</Text>
            <Text style={styles.title}>Convoy map</Text>
          </View>
          <View
            style={[
              styles.coveragePill,
              coverage.complete && requiredTripPoints.length > 0
                ? styles.coverageReady : styles.coverageMissing,
            ]}>
            <Text style={styles.coveragePillText}>
              {requiredTripPoints.length === 0
                ? 'TRIP NOT CHECKED'
                : coverage.complete ? 'TRIP COVERED' : 'COVERAGE INCOMPLETE'}
            </Text>
          </View>
        </View>
        <Text style={styles.body}>
          Offline map tiles appear only when a verified local pack and a compatible
          tile reader are available. Only current, explicitly authorised
          convoy member positions may appear as member markers. Radio-heard
          positions are separate, unverified diagnostics.
        </Text>
      </View>

      <ConvoyMap
        activeConvoyId={activeConvoyId}
        authorisedMembers={authorisedMembers}
        selfFix={
          latestFix
            ? {
                latitude: latestFix.latitude,
                longitude: latestFix.longitude,
                headingDegrees: latestFix.headingDegrees ?? null,
                accuracyMeters: latestFix.accuracyMeters ?? null,
                receivedAtMs: latestFix.timestampMs,
              }
            : localPosition
              ? {...localPosition, headingDegrees: null, receivedAtMs: 0}
              : null
        }
        packCatalog={packCatalog}
        overlays={visibleOverlays}
        fieldChannelPositions={fieldChannelPositions}
        tileSource={tileSource}
      />
      {showChannelFieldTest ? <ConnectedChannelFieldLocation onPositions={setExplicitChannelMarkers} /> : null}
      {trail.displayCount > 0 ? (
        <Text style={styles.mapTrailHint}>
          RECORDED GPS TRAIL · {trail.displayCount}/{trail.originalCount} visual points
          {' · '}{formatDistance(trackDistanceMeters)} total (recorded)
          {' · '}GPX exports retain all recorded points
        </Text>
      ) : null}
      {activePlan && routeProgress ? (
        <Text style={styles.mapTrailHint}>
          ATTACHED ENGINE ROUTE · {routeStatus.toUpperCase()} ·{' '}
          {formatDistance(routeProgress.remainingDistanceMeters)} remaining
          {' · '}engine {activePlan.engineId}
          {' · '}raster map tiles do not supply road routing
        </Text>
      ) : null}
      <View style={styles.sourceNotice}>
        <Text style={styles.sourceNoticeTitle}>VERIFIED CONVOY MARKERS</Text>
        <Text style={styles.sourceNoticeText}>
          {activeConvoyId === null
            ? 'No verified operational convoy selected. Member markers are withheld.'
            : authorisedMembers.length === 0
              ? 'No verified member-position feed supplied. Public carrier contacts stay excluded.'
              : authorisedMembers.length + ' authorised member records supplied for the selected convoy.'}
        </Text>
        <Text style={styles.sourceNoticeText}>
          Raster tiles are independently loaded by the offline archive reader.
          Archive verification alone is not image-loading proof.
        </Text>
        {onManageMapPacks ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Manage offline map packs in Device"
            style={styles.mapManagerButton}
            onPress={onManageMapPacks}>
            <Text style={styles.mapManagerText}>MANAGE OFFLINE MAP PACKS</Text>
          </TouchableOpacity>
        ) : <MapPackCatalogPanel />}
      </View>

      {hasNavigationTarget ? (
        <View
          style={[
            styles.navigationCard,
            navigationFieldTarget
              ? fixedTarget?.expired
                ? styles.navigationCardHold
                : fixedTarget?.arrived
                  ? styles.navigationCardArrived
                  : styles.navigationCardFixed
              : styles.navigationCardHold,
          ]}>
          <View style={styles.navigationTopRow}>
            <View style={styles.navigationCopy}>
              <Text style={styles.navigationEyebrow}>
                {navigationFieldTarget
                  ? fixedTarget?.expired
                    ? 'FIXED TARGET EXPIRED · HOLD'
                    : fixedTarget?.arrived
                      ? 'ARRIVED'
                      : 'FIXED FIELD DESTINATION'
                  : 'UNVERIFIED RADIO TARGET · DIRECT BEARING ONLY'}
              </Text>
              <Text style={styles.navigationName}>
                {navigationFieldTarget?.label ??
                  navigationTargetVehicle?.name ??
                  'Target unavailable'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.navigationClearButton}
              onPress={clearNavigationTarget}>
              <Text style={styles.navigationClearText}>STOP NAV</Text>
            </TouchableOpacity>
          </View>

          {navigationFieldTarget ? (
            fixedTarget ? (
              <>
                <View style={styles.navigationGuidanceRow}>
                  <View>
                    <Text style={styles.navigationBearing}>
                      {fixedTarget.compassDirection} ·{' '}
                      {Math.round(fixedTarget.bearingDegrees)}°
                    </Text>
                    <Text style={styles.navigationGuidanceLabel}>DIRECT BEARING</Text>
                  </View>
                  <View style={styles.navigationDistanceCopy}>
                    <Text style={styles.navigationDistance}>
                      {formatDistance(fixedTarget.distanceMeters)}
                    </Text>
                    <Text style={styles.navigationGuidanceLabel}>STRAIGHT LINE</Text>
                  </View>
                </View>
                <Text
                  style={
                    fixedTarget.expired
                      ? styles.navigationStatusHold
                      : fixedTarget.arrived
                        ? styles.navigationStatusArrived
                        : styles.navigationStatusFixed
                  }>
                  {fixedTarget.expired
                    ? 'EXPIRED · do not rely on this location as current'
                    : fixedTarget.arrived
                      ? `ON SCENE · within ${fixedTarget.arrivalRadiusMeters} m`
                      : `${markerLabel(fixedTarget.type)} · fixed coordinate from ${navigationFieldTarget.senderId.slice(-6)}`}
                </Text>
              </>
            ) : (
              <Text style={styles.navigationStatusHold}>
                Waiting for your GPS fix. The fixed target remains retained.
              </Text>
            )
          ) : movingTarget ? (
            <>
              <View style={styles.navigationGuidanceRow}>
                <View>
                  <Text style={styles.navigationBearing}>
                    {movingTarget.compassDirection} ·{' '}
                    {Math.round(movingTarget.bearingDegrees)}°
                  </Text>
                  <Text style={styles.navigationGuidanceLabel}>DIRECT BEARING</Text>
                </View>
                <View style={styles.navigationDistanceCopy}>
                  <Text style={styles.navigationDistance}>
                    {formatDistance(movingTarget.distanceMeters)}
                  </Text>
                  <Text style={styles.navigationGuidanceLabel}>STRAIGHT LINE</Text>
                </View>
              </View>
              <Text
                style={
                  styles.navigationStatusHold
                }>
                {movingTarget.safeToFollow
                  ? `UNVERIFIED · radio-heard fix ${formatAge(movingTarget.ageSeconds)} old. Identity and membership are not confirmed.`
                  : `UNVERIFIED · HOLD · ${movingTarget.freshness.toUpperCase()} last-known position · ${formatAge(movingTarget.ageSeconds)} old`}
              </Text>
            </>
          ) : (
            <Text style={styles.navigationStatusHold}>
              Waiting for both your GPS fix and the selected vehicle position.
            </Text>
          )}

          <Text style={styles.navigationHint}>
            Direct bearing only. Radio-heard vehicle and marker targets in
            this legacy view are not Security-verified convoy destinations.
            BushMesh does not claim road or trail routing.
          </Text>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Unverified radio-heard positions</Text>
        <Text style={styles.sectionMeta}>{vehicles.length} heard</Text>
      </View>

      <Text style={styles.sourceNoticeText}>
        This is a legacy channel-only position list. It is never a Security v1
        roster, and these positions are never plotted as verified members.
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={showRadioPositions
          ? 'Hide unverified radio positions' : 'Show unverified radio positions'}
        accessibilityState={{expanded: showRadioPositions}}
        style={styles.mapManagerButton}
        onPress={() => setShowRadioPositions(current => !current)}>
        <Text style={styles.mapManagerText}>
          {showRadioPositions
            ? 'HIDE UNVERIFIED POSITION LIST' : 'SHOW UNVERIFIED POSITION LIST'}
        </Text>
      </TouchableOpacity>
      {showRadioPositions ? (
      vehicles.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No remote Bushmesh position packets have been accepted yet.
          </Text>
        </View>
      ) : (
        vehicles.map(vehicle => {
          const freshness = getConvoyFreshness(vehicle.receivedAtMs, nowMs);
          const targeted = navigationTargetVehicleId === vehicle.id;
          const tail = buddyTailByVehicle.get(vehicle.id) ?? null;
          const tailDistance = tail ? buddyTailDistanceMeters(tail) : 0;

          return (
            <View key={vehicle.id} style={styles.positionCard}>
              <View style={styles.positionCopy}>
                <Text style={styles.positionName}>{vehicle.name}</Text>
                <Text style={styles.positionCoords}>
                  {vehicle.latitude.toFixed(5)}, {vehicle.longitude.toFixed(5)}
                </Text>
                <Text style={styles.positionMeta}>
                  {freshness.toUpperCase()} · {formatAge(Math.floor((nowMs - vehicle.receivedAtMs) / 1000))} old
                  {tail && tail.points.length > 1
                    ? ` · tail ${tail.points.length} fixes / ${formatDistance(tailDistance)}`
                    : ''}
                </Text>
              </View>
              <View style={styles.positionActions}>
                <Text style={styles.warningText}>
                  HEARD · {freshness.toUpperCase()} · NOT VERIFIED
                </Text>
                <TouchableOpacity
                  style={[
                    styles.navigateButton,
                    targeted && styles.navigateButtonActive,
                  ]}
                  onPress={() =>
                    targeted
                      ? clearNavigationTarget()
                      : setNavigationTarget(vehicle.id)
                  }>
                  <Text
                    style={[
                      styles.navigateButtonText,
                      targeted && styles.navigateButtonTextActive,
                    ]}>
                    {targeted ? 'BEARING ACTIVE' : 'DIRECT BEARING · UNVERIFIED'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Radio-origin markers (unverified)</Text>
        <Text style={styles.sectionMeta}>{activeMarkers.length} active</Text>
      </View>

      {activeMarkers.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No active STOP, HAZARD, REGROUP or HELP locations.
          </Text>
        </View>
      ) : (
        activeMarkers.map(marker => {
          const navigable = canNavigateToMarker(marker);
          const targeted = navigationFieldTarget?.id === marker.id;
          const directDistance = localPosition
            ? formatDistance(distanceMeters(localPosition, marker))
            : null;

          return (
            <View key={marker.id} style={styles.markerCard}>
              <View style={styles.markerCopy}>
                <Text style={styles.markerType}>{markerLabel(marker.type)}</Text>
                <Text style={styles.positionCoords}>
                  {marker.latitude.toFixed(5)}, {marker.longitude.toFixed(5)}
                </Text>
                <Text style={styles.positionMeta}>
                  sender {marker.senderId.slice(-6)}
                  {directDistance ? ` · ${directDistance} direct` : ''}
                  {navigable ? ' · DESTINATION CAPABLE' : ' · WARNING ONLY'}
                </Text>
              </View>
              {navigable ? (
                <TouchableOpacity
                  style={[
                    styles.navigateButton,
                    targeted && styles.navigateButtonActive,
                  ]}
                  onPress={() =>
                    targeted
                      ? clearNavigationTarget()
                      : setNavigationFieldTarget(fieldTargetFromMarker(marker))
                  }>
                  <Text
                    style={[
                      styles.navigateButtonText,
                      targeted && styles.navigateButtonTextActive,
                    ]}>
                    {targeted ? 'TARGET' : 'NAVIGATE'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.markerSender}>{marker.senderId.slice(-6)}</Text>
              )}
            </View>
          );
        })
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Breadcrumb trail</Text>
        <Text style={styles.sectionMeta}>{trackPoints.length} retained points</Text>
      </View>

      {trackPoints.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No local trail yet</Text>
          <Text style={styles.emptyText}>
            Start Android GPS or the simulator. Accepted fixes are compacted into a
            bounded trail with GPS jitter suppression.
          </Text>
        </View>
      ) : (
        <View style={styles.trailCard}>
          <View style={styles.trailSummaryRow}>
            <View>
              <Text style={styles.trailValue}>
                {formatDistance(trackDistanceMeters)}
              </Text>
              <Text style={styles.trailLabel}>RECORDED DISTANCE</Text>
            </View>
            <View style={styles.trailStartCopy}>
              <Text style={styles.trailStartValue}>
                {trackStartedAtMs
                  ? new Date(trackStartedAtMs).toLocaleTimeString()
                  : '—'}
              </Text>
              <Text style={styles.trailLabel}>TRAIL START</Text>
            </View>
          </View>

          <Text style={styles.trailHint}>
            The map shows a bounded preview of your persisted GPS breadcrumb
            trail. GPX export preserves the full retained sample sequence;
            the displayed polyline is not used to recalculate distance.
          </Text>
          {recentTrackPoints.map(point => (
            <View
              key={`${point.recordedAtMs}-${point.latitude}-${point.longitude}`}
              style={styles.trailPointRow}>
              <Text style={styles.trailPointCoords}>
                {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
              </Text>
              <Text style={styles.trailPointTime}>
                {new Date(point.recordedAtMs).toLocaleTimeString()}
              </Text>
            </View>
          ))}

          <TouchableOpacity style={styles.clearTrailButton} onPress={clearTrack}>
            <Text style={styles.clearTrailText}>Clear trail</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Map pack diagnostics</Text>
        <Text style={styles.sectionMeta}>
          {coverage.readyPackIds.length} verified ready
        </Text>
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={showMapDiagnostics
          ? 'Hide advanced map diagnostics' : 'Show advanced map diagnostics'}
        accessibilityState={{expanded: showMapDiagnostics}}
        style={styles.mapManagerButton}
        onPress={() => setShowMapDiagnostics(current => !current)}>
        <Text style={styles.mapManagerText}>
          {showMapDiagnostics ? 'HIDE PACK DIAGNOSTICS' : 'SHOW PACK DIAGNOSTICS'}
        </Text>
      </TouchableOpacity>
      {showMapDiagnostics ? (
      <>
      {packs.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No map packs registered yet</Text>
          <Text style={styles.emptyText}>
            Demo packs are metadata-only and cannot supply a basemap. Register a
            trusted regional manifest to download and verify a real archive.
          </Text>
        </View>
      ) : (
        packs.map(pack => {
          const packVerified =
            !pack.simulated && pack.state === 'ready' && pack.checksumVerified;
          const packStatus = pack.simulated
            ? 'SIMULATED'
            : packVerified
              ? 'VERIFIED'
              : pack.state.toUpperCase();

          return (
            <View key={pack.id} style={styles.packCard}>
              <View style={styles.packTopRow}>
                <View style={styles.packCopy}>
                  <Text style={styles.packName}>{pack.name}</Text>
                  <Text style={styles.packVersion}>Version {pack.version}</Text>
                </View>
                <Text style={packVerified ? styles.readyText : styles.warningText}>
                  {packStatus}
                </Text>
              </View>
              <Text style={styles.packBounds}>
                {pack.bounds.south.toFixed(2)} → {pack.bounds.north.toFixed(2)} lat ·{' '}
                {pack.bounds.west.toFixed(2)} → {pack.bounds.east.toFixed(2)} lon
              </Text>
            </View>
          );
        })
      )}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={loadDemoHighCountryPack}>
          <Text style={styles.primaryButtonText}>Load demo trip pack</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Review clear map state"
          style={[styles.button, styles.secondaryButton]}
          onPress={() => setConfirmClearMapState(true)}>
          <Text style={styles.secondaryButtonText}>Review clear map state</Text>
        </TouchableOpacity>
      </View>
      {confirmClearMapState ? (
        <View style={styles.sourceNotice}>
          <Text style={styles.sourceNoticeTitle}>CLEAR MAP DATA?</Text>
          <Text style={styles.warningText}>
            This removes saved map metadata and local trip selection from the app.
            It is not needed to change map packs.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Confirm clear map data"
            style={styles.mapManagerButton}
            onPress={() => {clearMapState(); setConfirmClearMapState(false);}}>
            <Text style={styles.mapManagerText}>CONFIRM CLEAR MAP DATA</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Cancel clear map data"
            style={styles.mapManagerButton}
            onPress={() => setConfirmClearMapState(false)}>
            <Text style={styles.mapManagerText}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      </>
      ) : null}

      {requiredTripPoints.length > 0 ? (
        <View style={styles.tripCard}>
          <Text style={styles.sectionTitle}>Trip coverage check</Text>
          <Text style={styles.tripText}>
            {coverage.complete
              ? `All ${coverage.totalPointCount} required route points are inside verified local packs.`
              : `${coverage.missingPointIndexes.length} of ${coverage.totalPointCount} required route points are not covered by a verified local pack.`}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mapTrailHint: {
    color: colors.textSecondary, fontSize: 10, lineHeight: 16,
    marginBottom: 8, paddingHorizontal: 10,
  },
  screen: {flex: 1, backgroundColor: colors.background},
  sourceNotice: {padding: 14, borderRadius: 14, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, gap: 8, marginBottom: 12},
  sourceNoticeTitle: {color: colors.accent, fontSize: 13, fontWeight: '900'},
  sourceNoticeText: {color: colors.textSecondary, fontSize: 13, lineHeight: 20,
    paddingHorizontal: 10, marginBottom: 8},
  mapManagerButton: {minHeight: 56, borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surfaceSoft,
    paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center',
    alignItems: 'center', marginBottom: 8},
  mapManagerText: {color: colors.textPrimary, fontSize: 13, fontWeight: '800'},
  content: {padding: 16, paddingBottom: 36},
  heroCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroCopy: {flex: 1},
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 25,
    fontWeight: '900',
    marginTop: 5,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
  },
  coveragePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignSelf: 'flex-start',
  },
  coverageReady: {borderWidth: 1, borderColor: colors.success},
  coverageMissing: {borderWidth: 1, borderColor: colors.warning},
  coveragePillText: {color: colors.textPrimary, fontSize: 9, fontWeight: '900'},
  canvas: {
    minHeight: 200,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 18,
    justifyContent: 'center',
    marginBottom: 18,
  },
  canvasTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  canvasCopy: {flex: 1},
  canvasLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  canvasTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 8,
  },
  rendererPill: {
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  rendererPillText: {color: colors.warning, fontSize: 7, fontWeight: '900'},
  canvasDetail: {color: colors.textSecondary, fontSize: 12, marginTop: 8},
  focusText: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 5,
    fontWeight: '700',
  },
  canvasGrid: {flexDirection: 'row', gap: 8, marginTop: 18},
  canvasMetric: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 10,
  },
  canvasMetricValue: {color: colors.accent, fontSize: 17, fontWeight: '900'},
  canvasMetricLabel: {
    color: colors.textMuted,
    fontSize: 7,
    fontWeight: '900',
    marginTop: 3,
  },
  navigationCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 18,
    backgroundColor: colors.surface,
  },
  navigationCardLive: {borderColor: colors.success},
  navigationCardFixed: {borderColor: colors.accent},
  navigationCardArrived: {borderColor: colors.success},
  navigationCardHold: {borderColor: colors.warning},
  navigationTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  navigationCopy: {flex: 1},
  navigationEyebrow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  navigationName: {
    color: colors.textPrimary,
    fontSize: 21,
    fontWeight: '900',
    marginTop: 4,
  },
  navigationClearButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  navigationClearText: {color: colors.textSecondary, fontSize: 9, fontWeight: '900'},
  navigationGuidanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 16,
  },
  navigationBearing: {color: colors.accent, fontSize: 28, fontWeight: '900'},
  navigationDistanceCopy: {alignItems: 'flex-end'},
  navigationDistance: {color: colors.textPrimary, fontSize: 28, fontWeight: '900'},
  navigationGuidanceLabel: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 2,
  },
  navigationStatusLive: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 14,
  },
  navigationStatusFixed: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 14,
  },
  navigationStatusArrived: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 14,
  },
  navigationStatusHold: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 14,
  },
  navigationHint: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 7,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 9,
  },
  sectionTitle: {color: colors.textPrimary, fontSize: 16, fontWeight: '900'},
  sectionMeta: {color: colors.textMuted, fontSize: 11, fontWeight: '700'},
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  emptyTitle: {color: colors.textPrimary, fontSize: 14, fontWeight: '800'},
  emptyText: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4},
  positionCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  positionCopy: {flex: 1},
  positionName: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  positionCoords: {color: colors.textSecondary, fontSize: 11, marginTop: 3},
  positionMeta: {color: colors.textMuted, fontSize: 9, marginTop: 4, lineHeight: 13},
  positionActions: {alignItems: 'flex-end', gap: 7},
  readyText: {color: colors.success, fontSize: 10, fontWeight: '900'},
  warningText: {color: colors.warning, fontSize: 10, fontWeight: '900'},
  navigateButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  navigateButtonActive: {backgroundColor: colors.accent, borderColor: colors.accent},
  navigateButtonText: {color: colors.textSecondary, fontSize: 8, fontWeight: '900'},
  navigateButtonTextActive: {color: colors.background},
  markerCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
  },
  markerCopy: {flex: 1},
  markerType: {color: colors.warning, fontSize: 14, fontWeight: '900'},
  markerSender: {color: colors.textMuted, fontSize: 11, fontWeight: '800'},
  trailCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 14,
    marginBottom: 18,
  },
  trailSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  trailValue: {color: colors.accent, fontSize: 24, fontWeight: '900'},
  trailStartCopy: {alignItems: 'flex-end'},
  trailStartValue: {color: colors.textPrimary, fontSize: 16, fontWeight: '900'},
  trailLabel: {color: colors.textMuted, fontSize: 8, fontWeight: '900', marginTop: 3},
  trailHint: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 12,
    marginBottom: 8,
  },
  trailPointRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  trailPointCoords: {color: colors.textPrimary, fontSize: 11, fontWeight: '700'},
  trailPointTime: {color: colors.textMuted, fontSize: 10},
  clearTrailButton: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    alignItems: 'center',
  },
  clearTrailText: {color: colors.textSecondary, fontSize: 11, fontWeight: '900'},
  packCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  packTopRow: {flexDirection: 'row', justifyContent: 'space-between', gap: 10},
  packCopy: {flex: 1},
  packName: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  packVersion: {color: colors.textMuted, fontSize: 10, marginTop: 2},
  packBounds: {color: colors.textSecondary, fontSize: 11, marginTop: 8},
  buttonRow: {flexDirection: 'row', gap: 10, marginBottom: 18},
  button: {flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center'},
  primaryButton: {backgroundColor: colors.accent},
  primaryButtonText: {color: colors.background, fontWeight: '900'},
  secondaryButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {color: colors.textPrimary, fontWeight: '800'},
  tripCard: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 16,
    marginTop: 10,
  },
  tripText: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 6},
});
