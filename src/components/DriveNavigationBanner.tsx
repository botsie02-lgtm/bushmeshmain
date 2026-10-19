import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {formatDistance} from '../convoy/convoy';
import {getMovingTargetGuidance} from '../convoy/movingTarget';
import {useConvoy} from '../state/ConvoyContext';
import {colors} from '../theme/colors';

function formatAge(ageSeconds: number): string {
  if (ageSeconds < 60) {
    return `${ageSeconds}s`;
  }
  if (ageSeconds < 3_600) {
    return `${Math.floor(ageSeconds / 60)}m`;
  }
  return `${Math.floor(ageSeconds / 3_600)}h`;
}

export function DriveNavigationBanner(): React.JSX.Element | null {
  const {
    localPosition,
    navigationTargetVehicleId,
    navigationTargetVehicle,
    clearNavigationTarget,
  } = useConvoy();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const guidance = useMemo(
    () => getMovingTargetGuidance(localPosition, navigationTargetVehicle, nowMs),
    [localPosition, navigationTargetVehicle, nowMs],
  );

  if (!navigationTargetVehicleId) {
    return null;
  }

  const safeToFollow = guidance?.safeToFollow ?? false;

  return (
    <View
      style={[
        styles.banner,
        safeToFollow ? styles.bannerLive : styles.bannerHold,
      ]}>
      <View style={styles.targetCopy}>
        <Text style={styles.eyebrow}>
          {safeToFollow ? 'NAVIGATE TO MATE' : 'LAST KNOWN · HOLD'}
        </Text>
        <Text style={styles.targetName} numberOfLines={1}>
          {navigationTargetVehicle?.name ?? 'Target unavailable'}
        </Text>
      </View>

      {guidance ? (
        <View style={styles.guidance}>
          <Text style={styles.bearing}>
            {guidance.compassDirection} {Math.round(guidance.bearingDegrees)}°
          </Text>
          <Text style={styles.distance}>{formatDistance(guidance.distanceMeters)}</Text>
          <Text
            style={safeToFollow ? styles.freshnessLive : styles.freshnessHold}>
            {guidance.freshness.toUpperCase()} · {formatAge(guidance.ageSeconds)}
          </Text>
        </View>
      ) : (
        <View style={styles.guidance}>
          <Text style={styles.waiting}>WAITING FOR GPS</Text>
        </View>
      )}

      <TouchableOpacity style={styles.stopButton} onPress={clearNavigationTarget}>
        <Text style={styles.stopText}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    backgroundColor: colors.surface,
  },
  bannerLive: {borderBottomColor: colors.success},
  bannerHold: {borderBottomColor: colors.warning},
  targetCopy: {flex: 1, minWidth: 0},
  eyebrow: {color: colors.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1},
  targetName: {color: colors.textPrimary, fontSize: 16, fontWeight: '900', marginTop: 3},
  guidance: {alignItems: 'flex-end', marginLeft: 10},
  bearing: {color: colors.accent, fontSize: 18, fontWeight: '900'},
  distance: {color: colors.textPrimary, fontSize: 13, fontWeight: '900', marginTop: 1},
  freshnessLive: {color: colors.success, fontSize: 8, fontWeight: '900', marginTop: 2},
  freshnessHold: {color: colors.warning, fontSize: 8, fontWeight: '900', marginTop: 2},
  waiting: {color: colors.warning, fontSize: 10, fontWeight: '900'},
  stopButton: {width: 36, height: 36, marginLeft: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center'},
  stopText: {color: colors.textSecondary, fontSize: 24, lineHeight: 25, fontWeight: '700'},
});
