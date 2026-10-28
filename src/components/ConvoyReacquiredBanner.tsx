import React, {useEffect, useMemo, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {ConvoyFreshness, getConvoyFreshness} from '../convoy/convoy';
import {useConvoy} from '../state/ConvoyContext';
import {colors} from '../theme/colors';

type ReacquiredNotice = {
  vehicleId: string;
  vehicleName: string;
  receivedAtMs: number;
  noticedAtMs: number;
};

function wasMissing(freshness: ConvoyFreshness | undefined): boolean {
  return freshness === 'stale' || freshness === 'lost';
}

function isBack(freshness: ConvoyFreshness): boolean {
  return freshness === 'live' || freshness === 'recent';
}

export function ConvoyReacquiredBanner({
  visible,
}: {
  visible: boolean;
}): React.JSX.Element | null {
  const {
    vehicles,
    navigationTargetVehicleId,
    setNavigationTarget,
  } = useConvoy();
  const previousFreshnessRef = useRef<Map<string, ConvoyFreshness>>(new Map());
  const previousReceivedAtRef = useRef<Map<string, number>>(new Map());
  const [notice, setNotice] = useState<ReacquiredNotice | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const nextFreshness = new Map<string, ConvoyFreshness>();
    const nextReceivedAt = new Map<string, number>();
    const now = Date.now();

    vehicles.forEach(vehicle => {
      const current = getConvoyFreshness(vehicle.receivedAtMs, now);
      const previous = previousFreshnessRef.current.get(vehicle.id);
      const previousReceivedAt = previousReceivedAtRef.current.get(vehicle.id);
      const hasNewFix =
        previousReceivedAt !== undefined && vehicle.receivedAtMs > previousReceivedAt;

      if (wasMissing(previous) && isBack(current) && hasNewFix) {
        setNotice({
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          receivedAtMs: vehicle.receivedAtMs,
          noticedAtMs: now,
        });
      }

      nextFreshness.set(vehicle.id, current);
      nextReceivedAt.set(vehicle.id, vehicle.receivedAtMs);
    });

    previousFreshnessRef.current = nextFreshness;
    previousReceivedAtRef.current = nextReceivedAt;
  }, [vehicles]);

  useEffect(() => {
    if (notice && nowMs - notice.noticedAtMs > 45_000) {
      setNotice(null);
    }
  }, [notice, nowMs]);

  const vehicle = useMemo(
    () => vehicles.find(item => item.id === notice?.vehicleId) ?? null,
    [notice?.vehicleId, vehicles],
  );

  if (!visible || !notice || !vehicle) {
    return null;
  }

  const freshness = getConvoyFreshness(vehicle.receivedAtMs, nowMs);
  if (!isBack(freshness)) {
    return null;
  }

  const targeted = navigationTargetVehicleId === vehicle.id;
  const ageSeconds = Math.max(
    0,
    Math.floor((nowMs - vehicle.receivedAtMs) / 1000),
  );

  return (
    <View style={styles.banner}>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>VEHICLE REACQUIRED</Text>
        <Text style={styles.name}>{notice.vehicleName}</Text>
        <Text style={styles.detail}>
          Fresh position {ageSeconds}s ago · {freshness.toUpperCase()}
          {vehicle.snrDb == null ? '' : ` · ${vehicle.snrDb.toFixed(1)} dB SNR`}
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.followButton, targeted && styles.followButtonActive]}
          onPress={() => setNavigationTarget(vehicle.id)}>
          <Text
            style={[
              styles.followButtonText,
              targeted && styles.followButtonTextActive,
            ]}>
            {targeted ? 'FOCUSED' : 'FOLLOW'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dismissButton} onPress={() => setNotice(null)}>
          <Text style={styles.dismissText}>×</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.success,
  },
  copy: {flex: 1, minWidth: 0},
  eyebrow: {
    color: colors.success,
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
  actions: {flexDirection: 'row', alignItems: 'center', gap: 7},
  followButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.success,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  followButtonActive: {backgroundColor: colors.success},
  followButtonText: {color: colors.success, fontSize: 9, fontWeight: '900'},
  followButtonTextActive: {color: colors.background},
  dismissButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    color: colors.textSecondary,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 21,
  },
});
