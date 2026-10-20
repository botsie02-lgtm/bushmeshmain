import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {ConvoyFreshness, getConvoyFreshness} from '../convoy/convoy';
import {useConvoy} from '../state/ConvoyContext';
import {colors} from '../theme/colors';

type LossAlert = {
  key: string;
  vehicleId: string;
  vehicleName: string;
  freshness: 'stale' | 'lost';
  detectedAtMs: number;
};

function severityRank(freshness: ConvoyFreshness): number {
  switch (freshness) {
    case 'live':
      return 0;
    case 'recent':
      return 1;
    case 'stale':
      return 2;
    case 'lost':
      return 3;
  }
}

export function ConvoyLossBanner(): React.JSX.Element | null {
  const {vehicles, getBuddyTail} = useConvoy();
  const previousFreshnessRef = useRef(new Map<string, ConvoyFreshness>());
  const initializedRef = useRef(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [alert, setAlert] = useState<LossAlert | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const next = new Map<string, ConvoyFreshness>();
    let newestTransition: LossAlert | null = null;

    vehicles.forEach(vehicle => {
      const freshness = getConvoyFreshness(vehicle.receivedAtMs, nowMs);
      next.set(vehicle.id, freshness);

      const previous = previousFreshnessRef.current.get(vehicle.id);
      if (
        initializedRef.current &&
        previous &&
        severityRank(freshness) > severityRank(previous) &&
        (freshness === 'stale' || freshness === 'lost')
      ) {
        newestTransition = {
          key: `${vehicle.id}-${freshness}-${vehicle.receivedAtMs}`,
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          freshness,
          detectedAtMs: nowMs,
        };
      }
    });

    previousFreshnessRef.current = next;
    initializedRef.current = true;

    if (newestTransition) {
      setAlert(newestTransition);
      setDismissedKey(null);
    }
  }, [nowMs, vehicles]);

  if (!alert || alert.key === dismissedKey) {
    return null;
  }

  const tail = getBuddyTail(alert.vehicleId);
  const tailPoints = tail?.points.length ?? 0;
  const critical = alert.freshness === 'lost';

  return (
    <View style={[styles.banner, critical ? styles.lost : styles.stale]}>
      <View style={styles.copy}>
        <Text style={[styles.kicker, critical ? styles.lostText : styles.staleText]}>
          {critical ? 'CONVOY MEMBER LOST' : 'CONVOY POSITION STALE'}
        </Text>
        <Text style={styles.name}>{alert.vehicleName}</Text>
        <Text style={styles.detail}>
          No trustworthy new position has arrived.
          {tailPoints > 1
            ? ` Bushmesh retained ${tailPoints} Buddy Tail fixes for recovery.`
            : ' Last-known position must not be treated as current.'}
        </Text>
      </View>
      <TouchableOpacity
        accessibilityLabel="Dismiss convoy freshness alert"
        style={styles.dismiss}
        onPress={() => setDismissedKey(alert.key)}>
        <Text style={styles.dismissText}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    backgroundColor: colors.surface,
  },
  stale: {borderBottomColor: colors.warning},
  lost: {borderBottomColor: colors.danger},
  copy: {flex: 1, minWidth: 0},
  kicker: {fontSize: 9, fontWeight: '900', letterSpacing: 1},
  staleText: {color: colors.warning},
  lostText: {color: colors.danger},
  name: {color: colors.textPrimary, fontSize: 15, fontWeight: '900', marginTop: 2},
  detail: {color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 3},
  dismiss: {
    width: 36,
    height: 36,
    marginLeft: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {color: colors.textSecondary, fontSize: 23, lineHeight: 24},
});
