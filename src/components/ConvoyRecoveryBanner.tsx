import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {formatDistance, getConvoyFreshness, positionAgeSeconds} from '../convoy/convoy';
import {buildRecoverySearchArea} from '../convoy/recoverySearchArea';
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
    navigationTargetVehicleId,
    setNavigationTarget,
    clearNavigationTarget,
    getRecoveryTrailAssessment,
  } = useConvoy();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const candidate = useMemo(() => {
    return [...vehicles]
      .filter(vehicle => {
        const freshness = getConvoyFreshness(vehicle.receivedAtMs, nowMs);
        return freshness === 'stale' || freshness === 'lost';
      })
      .sort((left, right) => {
        const leftFreshness = getConvoyFreshness(left.receivedAtMs, nowMs);
        const rightFreshness = getConvoyFreshness(right.receivedAtMs, nowMs);
        if (leftFreshness !== rightFreshness) {
          return leftFreshness === 'lost' ? -1 : 1;
        }
        return left.receivedAtMs - right.receivedAtMs;
      })[0] ?? null;
  }, [vehicles, nowMs]);

  if (!candidate) {
    return null;
  }

  const freshness = getConvoyFreshness(candidate.receivedAtMs, nowMs);
  const ageSeconds = positionAgeSeconds(candidate.receivedAtMs, nowMs);
  const trail = getRecoveryTrailAssessment(candidate.id, nowMs);
  const searchArea = buildRecoverySearchArea(candidate, nowMs);
  const targeted = navigationTargetVehicleId === candidate.id;

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
    <View style={styles.banner}>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>
          {freshness === 'lost' ? 'LOST VEHICLE' : 'VEHICLE STALE'}
        </Text>
        <Text style={styles.name} numberOfLines={1}>
          {candidate.name}
        </Text>
        <Text style={styles.detail}>
          Last heard {formatAge(ageSeconds)} ago · {uncertaintyText}
        </Text>
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
        style={[styles.button, targeted && styles.buttonActive]}
        onPress={() =>
          targeted ? clearNavigationTarget() : setNavigationTarget(candidate.id)
        }>
        <Text style={[styles.buttonText, targeted && styles.buttonTextActive]}>
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
    borderBottomColor: colors.danger,
  },
  copy: {flex: 1, minWidth: 0},
  eyebrow: {
    color: colors.danger,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
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
    borderColor: colors.danger,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  buttonActive: {backgroundColor: colors.danger},
  buttonText: {color: colors.danger, fontSize: 9, fontWeight: '900'},
  buttonTextActive: {color: colors.background},
});
