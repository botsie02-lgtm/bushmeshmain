import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {formatDistance} from '../convoy/convoy';
import {useRouteSession} from '../state/RouteSessionContext';
import {colors} from '../theme/colors';

function statusLabel(status: ReturnType<typeof useRouteSession>['status']): string {
  switch (status) {
    case 'arrived':
      return 'ARRIVED';
    case 'off-route':
      return 'OFF ROUTE';
    case 'planning':
      return 'CALCULATING';
    case 'ready':
      return 'OFFLINE ROUTE';
    case 'engine-unavailable':
      return 'ROUTER UNAVAILABLE';
    case 'error':
      return 'ROUTE ERROR';
    case 'idle':
    default:
      return 'ROUTE';
  }
}

export function RouteGuidanceBanner(): React.JSX.Element | null {
  const {
    status,
    activePlan,
    progress,
    mapCoverage,
    errorMessage,
    clearRoute,
  } = useRouteSession();

  if (activePlan === null) {
    return null;
  }

  const nextManeuver = progress?.nextManeuver ?? null;
  const mapReady = mapCoverage.complete;
  const problem = status === 'off-route' || status === 'error';

  return (
    <View
      style={[
        styles.banner,
        status === 'arrived'
          ? styles.bannerArrived
          : problem
            ? styles.bannerWarning
            : styles.bannerActive,
      ]}>
      <View style={styles.copy}>
        <View style={styles.eyebrowRow}>
          <Text
            style={[
              styles.eyebrow,
              problem ? styles.warningText : styles.activeText,
            ]}>
            {statusLabel(status)}
          </Text>
          <Text style={mapReady ? styles.mapReady : styles.mapMissing}>
            {mapReady
              ? 'MAP READY'
              : `${mapCoverage.missingPointIndexes.length} MAP GAPS`}
          </Text>
        </View>

        <Text style={styles.instruction} numberOfLines={2}>
          {status === 'arrived'
            ? 'Destination reached'
            : errorMessage ?? nextManeuver?.instruction ?? 'Continue on route'}
        </Text>

        {progress ? (
          <Text style={styles.detail}>
            {progress.distanceToNextManeuverMeters !== null
              ? `${formatDistance(progress.distanceToNextManeuverMeters)} to next · `
              : ''}
            {formatDistance(progress.remainingDistanceMeters)} remaining
            {status === 'off-route'
              ? ` · ${formatDistance(progress.crossTrackDistanceMeters)} off route`
              : ''}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        style={styles.stopButton}
        onPress={() => {
          clearRoute().catch(() => undefined);
        }}>
        <Text style={styles.stopText}>STOP ROUTE</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
  },
  bannerActive: {borderBottomColor: colors.accent},
  bannerArrived: {borderBottomColor: colors.success},
  bannerWarning: {borderBottomColor: colors.warning},
  copy: {flex: 1, minWidth: 0},
  eyebrowRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  eyebrow: {fontSize: 9, fontWeight: '900', letterSpacing: 1},
  activeText: {color: colors.accent},
  warningText: {color: colors.warning},
  mapReady: {color: colors.success, fontSize: 8, fontWeight: '900'},
  mapMissing: {color: colors.warning, fontSize: 8, fontWeight: '900'},
  instruction: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 3,
  },
  detail: {color: colors.textSecondary, fontSize: 10, fontWeight: '700', marginTop: 3},
  stopButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  stopText: {color: colors.textSecondary, fontSize: 8, fontWeight: '900'},
});
