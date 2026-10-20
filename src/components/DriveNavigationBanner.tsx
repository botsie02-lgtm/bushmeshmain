import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {buddyTailDistanceMeters} from '../convoy/buddyTails';
import {formatDistance} from '../convoy/convoy';
import {getFieldTargetGuidance} from '../convoy/fieldTarget';
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

function fixedTargetEyebrow(type: string, expired: boolean): string {
  if (expired) {
    return 'TARGET EXPIRED · HOLD';
  }

  switch (type) {
    case 'regroup':
      return 'NAVIGATE TO REGROUP';
    case 'help':
      return 'NAVIGATE TO HELP';
    case 'hazard':
      return 'HAZARD LOCATION';
    case 'stop':
      return 'STOP LOCATION';
    default:
      return 'FIXED FIELD TARGET';
  }
}

export function DriveNavigationBanner(): React.JSX.Element | null {
  const {
    localPosition,
    navigationTargetVehicleId,
    navigationTargetVehicle,
    navigationFieldTarget,
    getBuddyTail,
    clearNavigationTarget,
  } = useConvoy();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const movingGuidance = useMemo(
    () => getMovingTargetGuidance(localPosition, navigationTargetVehicle, nowMs),
    [localPosition, navigationTargetVehicle, nowMs],
  );
  const fixedGuidance = useMemo(
    () => getFieldTargetGuidance(localPosition, navigationFieldTarget, nowMs),
    [localPosition, navigationFieldTarget, nowMs],
  );
  const buddyTail = useMemo(
    () =>
      navigationTargetVehicleId
        ? getBuddyTail(navigationTargetVehicleId)
        : null,
    [getBuddyTail, navigationTargetVehicleId],
  );
  const tailDistanceMeters = buddyTail ? buddyTailDistanceMeters(buddyTail) : 0;

  const hasVehicleTarget = navigationTargetVehicleId !== null;
  const hasFieldTarget = navigationFieldTarget !== null;
  if (!hasVehicleTarget && !hasFieldTarget) {
    return null;
  }

  if (hasFieldTarget && navigationFieldTarget) {
    const expired =
      fixedGuidance?.expired ??
      (navigationFieldTarget.expiresAtMs !== null &&
        navigationFieldTarget.expiresAtMs <= nowMs);

    return (
      <View
        style={[
          styles.banner,
          expired ? styles.bannerHold : styles.bannerFixed,
        ]}>
        <View style={styles.targetCopy}>
          <Text style={styles.eyebrow}>
            {fixedTargetEyebrow(navigationFieldTarget.type, expired)}
          </Text>
          <Text style={styles.targetName} numberOfLines={1}>
            {navigationFieldTarget.label}
          </Text>
          <Text style={expired ? styles.tailText : styles.fixedText}>
            FIXED POINT · sender {navigationFieldTarget.senderId.slice(-6)}
          </Text>
        </View>

        {fixedGuidance ? (
          <View style={styles.guidance}>
            <Text style={styles.bearing}>
              {fixedGuidance.compassDirection}{' '}
              {Math.round(fixedGuidance.bearingDegrees)}°
            </Text>
            <Text style={styles.distance}>
              {formatDistance(fixedGuidance.distanceMeters)}
            </Text>
            <Text style={expired ? styles.freshnessHold : styles.freshnessFixed}>
              {expired ? 'EXPIRED · DO NOT RELY' : 'FIXED LOCATION'}
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

  const safeToFollow = movingGuidance?.safeToFollow ?? false;
  const hasUsefulTail = (buddyTail?.points.length ?? 0) > 1;

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
        {!safeToFollow && hasUsefulTail ? (
          <Text style={styles.tailText}>
            BUDDY TAIL · {buddyTail?.points.length ?? 0} fixes ·{' '}
            {formatDistance(tailDistanceMeters)} retained path
          </Text>
        ) : null}
      </View>

      {movingGuidance ? (
        <View style={styles.guidance}>
          <Text style={styles.bearing}>
            {movingGuidance.compassDirection}{' '}
            {Math.round(movingGuidance.bearingDegrees)}°
          </Text>
          <Text style={styles.distance}>
            {formatDistance(movingGuidance.distanceMeters)}
          </Text>
          <Text
            style={safeToFollow ? styles.freshnessLive : styles.freshnessHold}>
            {movingGuidance.freshness.toUpperCase()} ·{' '}
            {formatAge(movingGuidance.ageSeconds)}
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
  bannerFixed: {borderBottomColor: colors.accent},
  bannerHold: {borderBottomColor: colors.warning},
  targetCopy: {flex: 1, minWidth: 0},
  eyebrow: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  targetName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 3,
  },
  tailText: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '800',
    marginTop: 3,
  },
  fixedText: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '800',
    marginTop: 3,
  },
  guidance: {alignItems: 'flex-end', marginLeft: 10},
  bearing: {color: colors.accent, fontSize: 18, fontWeight: '900'},
  distance: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 1,
  },
  freshnessLive: {
    color: colors.success,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 2,
  },
  freshnessFixed: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 2,
  },
  freshnessHold: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 2,
  },
  waiting: {color: colors.warning, fontSize: 10, fontWeight: '900'},
  stopButton: {
    width: 36,
    height: 36,
    marginLeft: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopText: {
    color: colors.textSecondary,
    fontSize: 24,
    lineHeight: 25,
    fontWeight: '700',
  },
});
