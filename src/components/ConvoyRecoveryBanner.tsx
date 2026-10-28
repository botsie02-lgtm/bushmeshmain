import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {formatDistance} from '../convoy/convoy';
import {prioritizeConvoyRecoveryCases} from '../convoy/recoveryPriority';
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

export function ConvoyRecoveryBanner(): React.JSX.Element | null {
  const {
    vehicles,
    buddyTails,
    navigationTargetVehicleId,
    setNavigationTarget,
    clearNavigationTarget,
  } = useConvoy();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const recoveryCases = useMemo(
    () => prioritizeConvoyRecoveryCases(vehicles, buddyTails, nowMs),
    [vehicles, buddyTails, nowMs],
  );
  const candidate = recoveryCases[0] ?? null;

  if (!candidate) {
    return null;
  }

  const {vehicle, freshness, ageSeconds, trail, searchArea, level, reason} = candidate;
  const targeted = navigationTargetVehicleId === vehicle.id;

  const trailText = trail
    ? trail.pointCount >= 2
      ? `${trail.state.toUpperCase()} TRAIL · ${trail.pointCount} fixes · ${formatDistance(
          trail.retainedDistanceMeters,
        )}`
      : 'NO USEFUL RETAINED TRAIL'
    : 'NO RETAINED TRAIL';

  const uncertaintyText = searchArea
    ? `${formatDistance(searchArea.radiusMeters)} UNCERTAINTY RADIUS`
    : 'LAST FIX STILL WITHIN CURRENT-POSITION WINDOW';

  return (
    <View
      style={[
        styles.banner,
        level === 'critical'
          ? styles.bannerCritical
          : level === 'high'
            ? styles.bannerHigh
            : styles.bannerWatch,
      ]}>
      <View style={styles.copy}>
        <Text
          style={[
            styles.eyebrow,
            level === 'critical'
              ? styles.criticalText
              : level === 'high'
                ? styles.highText
                : styles.watchText,
          ]}>
          {freshness === 'lost' ? 'LOST VEHICLE' : 'VEHICLE STALE'}
          {recoveryCases.length > 1 ? ` · 1 OF ${recoveryCases.length}` : ''}
        </Text>
        <Text style={styles.name} numberOfLines={1}>
          {vehicle.name}
        </Text>
        <Text style={styles.detail}>
          Last heard {formatAge(ageSeconds)} ago · {uncertaintyText}
        </Text>
        <Text style={styles.reason}>{reason}</Text>
        <Text
          style={[
            styles.trail,
            trail?.state === 'usable' && styles.trailGood,
            trail?.state === 'broken' && styles.trailBad,
          ]}>
          {trailText}
        </Text>
      </View>

      <TouchableOpacity
        style={[
          styles.button,
          level === 'watch' ? styles.buttonWatch : styles.buttonUrgent,
          targeted && styles.buttonActive,
        ]}
        onPress={() =>
          targeted ? clearNavigationTarget() : setNavigationTarget(vehicle.id)
        }>
        <Text
          style={[
            styles.buttonText,
            level === 'watch' ? styles.buttonWatchText : styles.buttonUrgentText,
            targeted && styles.buttonTextActive,
          ]}>
          {targeted ? 'FOCUSED' : 'RECOVER'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
  },
  bannerCritical: {borderBottomColor: colors.danger},
  bannerHigh: {borderBottomColor: colors.warning},
  bannerWatch: {borderBottomColor: colors.accent},
  copy: {flex: 1, minWidth: 0},
  eyebrow: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  criticalText: {color: colors.danger},
  highText: {color: colors.warning},
  watchText: {color: colors.accent},
  name: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 3,
  },
  reason: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 3,
  },
  trail: {
    color: colors.warning,
    fontSize: 9,
    fontWeight: '900',
    marginTop: 3,
  },
  trailGood: {color: colors.success},
  trailBad: {color: colors.danger},
  button: {
    minWidth: 82,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  buttonUrgent: {borderColor: colors.danger},
  buttonWatch: {borderColor: colors.accent},
  buttonActive: {backgroundColor: colors.danger},
  buttonText: {fontSize: 9, fontWeight: '900'},
  buttonUrgentText: {color: colors.danger},
  buttonWatchText: {color: colors.accent},
  buttonTextActive: {color: colors.background},
});
