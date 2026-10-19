import React, {useMemo} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {getConvoyFreshness} from '../convoy/convoy';
import {activeOperationalMarkers} from '../convoy/operationalMarkers';
import {useConvoy} from '../state/ConvoyContext';
import {useDrive} from '../state/DriveContext';
import {useOfflineMaps} from '../state/OfflineMapContext';
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

export function MapScreen(): React.JSX.Element {
  const {vehicles, localPosition} = useConvoy();
  const {operationalMarkers} = useDrive();
  const {
    packs,
    coverage,
    requiredTripPoints,
    loadDemoHighCountryPack,
    clearMapState,
  } = useOfflineMaps();

  const nowMs = Date.now();
  const activeMarkers = useMemo(
    () => activeOperationalMarkers(operationalMarkers, nowMs),
    [operationalMarkers, nowMs],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>OFFLINE MAP</Text>
            <Text style={styles.title}>Convoy operating picture</Text>
          </View>
          <View
            style={[
              styles.coveragePill,
              coverage.complete ? styles.coverageReady : styles.coverageMissing,
            ]}>
            <Text style={styles.coveragePillText}>
              {coverage.complete ? 'TRIP COVERED' : 'PACKS NEEDED'}
            </Text>
          </View>
        </View>
        <Text style={styles.body}>
          This surface is already driven by live Bushmesh domain state. Native
          MapLibre tiles will replace the diagnostic canvas without changing the
          convoy, alert or offline-pack contracts.
        </Text>
      </View>

      <View style={styles.canvas}>
        <Text style={styles.canvasLabel}>MAP RENDERER FOUNDATION</Text>
        <Text style={styles.canvasTitle}>
          {localPosition
            ? `${localPosition.latitude.toFixed(5)}, ${localPosition.longitude.toFixed(5)}`
            : 'Waiting for your position'}
        </Text>
        <Text style={styles.canvasDetail}>
          YOU · {vehicles.length} remote vehicle{vehicles.length === 1 ? '' : 's'} ·{' '}
          {activeMarkers.length} active operational marker
          {activeMarkers.length === 1 ? '' : 's'}
        </Text>
        <View style={styles.canvasGrid}>
          <View style={styles.canvasMetric}>
            <Text style={styles.canvasMetricValue}>{packs.length}</Text>
            <Text style={styles.canvasMetricLabel}>LOCAL PACKS</Text>
          </View>
          <View style={styles.canvasMetric}>
            <Text style={styles.canvasMetricValue}>
              {coverage.coveredPointCount}/{coverage.totalPointCount}
            </Text>
            <Text style={styles.canvasMetricLabel}>TRIP POINTS COVERED</Text>
          </View>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Offline map packs</Text>
        <Text style={styles.sectionMeta}>
          {coverage.readyPackIds.length} verified ready
        </Text>
      </View>

      {packs.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No map packs registered yet</Text>
          <Text style={styles.emptyText}>
            The development pack below is metadata-only. It lets us exercise trip
            coverage logic before native tile downloads are installed.
          </Text>
        </View>
      ) : (
        packs.map(pack => (
          <View key={pack.id} style={styles.packCard}>
            <View style={styles.packTopRow}>
              <View style={styles.packCopy}>
                <Text style={styles.packName}>{pack.name}</Text>
                <Text style={styles.packVersion}>Version {pack.version}</Text>
              </View>
              <Text
                style={
                  pack.state === 'ready' && pack.checksumVerified
                    ? styles.readyText
                    : styles.warningText
                }>
                {pack.state === 'ready' && pack.checksumVerified
                  ? 'VERIFIED'
                  : pack.state.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.packBounds}>
              {pack.bounds.south.toFixed(2)} → {pack.bounds.north.toFixed(2)} lat ·{' '}
              {pack.bounds.west.toFixed(2)} → {pack.bounds.east.toFixed(2)} lon
            </Text>
          </View>
        ))
      )}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={loadDemoHighCountryPack}>
          <Text style={styles.primaryButtonText}>Load demo trip pack</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={clearMapState}>
          <Text style={styles.secondaryButtonText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Convoy positions</Text>
        <Text style={styles.sectionMeta}>{vehicles.length} heard</Text>
      </View>

      {vehicles.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No remote Bushmesh position packets have been accepted yet.
          </Text>
        </View>
      ) : (
        vehicles.map(vehicle => {
          const freshness = getConvoyFreshness(vehicle.receivedAtMs, nowMs);
          return (
            <View key={vehicle.id} style={styles.positionCard}>
              <View style={styles.positionCopy}>
                <Text style={styles.positionName}>{vehicle.name}</Text>
                <Text style={styles.positionCoords}>
                  {vehicle.latitude.toFixed(5)}, {vehicle.longitude.toFixed(5)}
                </Text>
              </View>
              <Text
                style={
                  freshness === 'live' || freshness === 'recent'
                    ? styles.readyText
                    : styles.warningText
                }>
                {freshness.toUpperCase()}
              </Text>
            </View>
          );
        })
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Operational markers</Text>
        <Text style={styles.sectionMeta}>{activeMarkers.length} active</Text>
      </View>

      {activeMarkers.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No active STOP, HAZARD, REGROUP or HELP locations.
          </Text>
        </View>
      ) : (
        activeMarkers.map(marker => (
          <View key={marker.id} style={styles.markerCard}>
            <View>
              <Text style={styles.markerType}>{markerLabel(marker.type)}</Text>
              <Text style={styles.positionCoords}>
                {marker.latitude.toFixed(5)}, {marker.longitude.toFixed(5)}
              </Text>
            </View>
            <Text style={styles.markerSender}>{marker.senderId.slice(-6)}</Text>
          </View>
        ))
      )}

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
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 36},
  heroCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
  },
  heroTopRow: {flexDirection: 'row', justifyContent: 'space-between', gap: 12},
  heroCopy: {flex: 1},
  eyebrow: {color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.2},
  title: {color: colors.textPrimary, fontSize: 25, fontWeight: '900', marginTop: 5},
  body: {color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 10},
  coveragePill: {borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, alignSelf: 'flex-start'},
  coverageReady: {borderWidth: 1, borderColor: colors.success},
  coverageMissing: {borderWidth: 1, borderColor: colors.warning},
  coveragePillText: {color: colors.textPrimary, fontSize: 9, fontWeight: '900'},
  canvas: {
    minHeight: 190,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 18,
    justifyContent: 'center',
    marginBottom: 18,
  },
  canvasLabel: {color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1},
  canvasTitle: {color: colors.textPrimary, fontSize: 22, fontWeight: '900', marginTop: 8},
  canvasDetail: {color: colors.textSecondary, fontSize: 12, marginTop: 6},
  canvasGrid: {flexDirection: 'row', gap: 10, marginTop: 18},
  canvasMetric: {flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 12},
  canvasMetricValue: {color: colors.accent, fontSize: 20, fontWeight: '900'},
  canvasMetricLabel: {color: colors.textMuted, fontSize: 8, fontWeight: '900', marginTop: 3},
  sectionHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginBottom: 9},
  sectionTitle: {color: colors.textPrimary, fontSize: 16, fontWeight: '900'},
  sectionMeta: {color: colors.textMuted, fontSize: 11, fontWeight: '700'},
  emptyCard: {backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 14},
  emptyTitle: {color: colors.textPrimary, fontSize: 14, fontWeight: '800'},
  emptyText: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4},
  packCard: {backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, marginBottom: 10},
  packTopRow: {flexDirection: 'row', justifyContent: 'space-between', gap: 10},
  packCopy: {flex: 1},
  packName: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  packVersion: {color: colors.textMuted, fontSize: 10, marginTop: 2},
  packBounds: {color: colors.textSecondary, fontSize: 11, marginTop: 8},
  readyText: {color: colors.success, fontSize: 10, fontWeight: '900'},
  warningText: {color: colors.warning, fontSize: 10, fontWeight: '900'},
  buttonRow: {flexDirection: 'row', gap: 10, marginBottom: 18},
  button: {flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center'},
  primaryButton: {backgroundColor: colors.accent},
  primaryButtonText: {color: colors.background, fontWeight: '900'},
  secondaryButton: {backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border},
  secondaryButtonText: {color: colors.textPrimary, fontWeight: '800'},
  positionCard: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 8},
  positionCopy: {flex: 1},
  positionName: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  positionCoords: {color: colors.textSecondary, fontSize: 11, marginTop: 3},
  markerCard: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.warning, borderRadius: 16, padding: 14, marginBottom: 8},
  markerType: {color: colors.warning, fontSize: 14, fontWeight: '900'},
  markerSender: {color: colors.textMuted, fontSize: 11, fontWeight: '800'},
  tripCard: {backgroundColor: colors.surfaceSoft, borderRadius: 18, padding: 16, marginTop: 10},
  tripText: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 6},
});
