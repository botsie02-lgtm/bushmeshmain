import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {getConvoyFreshness} from '../convoy/convoy';
import {ConvoyLinkTrend, getConvoyLinkTrend} from '../convoy/linkTrend';
import {useConvoy} from '../state/ConvoyContext';
import {colors} from '../theme/colors';

type LinkWatchCase = {
  vehicleId: string;
  vehicleName: string;
  trend: ConvoyLinkTrend;
};

function formatDelta(value: number | null, suffix: string): string {
  if (value === null) {
    return '—';
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}${suffix}`;
}

export function ConvoyLinkWatchBanner(): React.JSX.Element | null {
  const {
    vehicles,
    buddyTails,
    navigationTargetVehicleId,
    setNavigationTarget,
    clearNavigationTarget,
  } = useConvoy();
  const [nowMs, setNowMs] = useState(Date.now());
  const [caseIndex, setCaseIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  const watchCases = useMemo<LinkWatchCase[]>(() => {
    const vehicleById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));

    return buddyTails
      .flatMap(tail => {
        const vehicle = vehicleById.get(tail.vehicleId);
        if (!vehicle) {
          return [];
        }

        const freshness = getConvoyFreshness(vehicle.receivedAtMs, nowMs);
        if (freshness !== 'live' && freshness !== 'recent') {
          return [];
        }

        const trend = getConvoyLinkTrend(tail, nowMs);
        if (!trend?.shouldWarn) {
          return [];
        }

        return [
          {
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            trend,
          },
        ];
      })
      .sort((left, right) => {
        if (left.trend.state !== right.trend.state) {
          return left.trend.state === 'fragile' ? -1 : 1;
        }
        return (left.trend.snrDeltaDb ?? 0) - (right.trend.snrDeltaDb ?? 0);
      });
  }, [buddyTails, nowMs, vehicles]);

  useEffect(() => {
    if (watchCases.length === 0) {
      setCaseIndex(0);
      return;
    }
    setCaseIndex(current => Math.min(current, watchCases.length - 1));
  }, [watchCases.length]);

  const current = watchCases[caseIndex] ?? watchCases[0] ?? null;
  if (!current) {
    return null;
  }

  const {trend} = current;
  const fragile = trend.state === 'fragile';
  const targeted = navigationTargetVehicleId === current.vehicleId;
  const showNext = watchCases.length > 1;

  return (
    <View style={[styles.banner, fragile ? styles.fragile : styles.degrading]}>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, fragile ? styles.fragileText : styles.degradingText]}>
          {fragile ? 'RADIO LINK FRAGILE' : 'RADIO LINK DEGRADING'}
          {showNext ? ` · ${caseIndex + 1} OF ${watchCases.length}` : ''}
        </Text>
        <Text style={styles.name}>{current.vehicleName}</Text>
        <Text style={styles.metrics}>
          SNR trend {formatDelta(trend.snrDeltaDb, ' dB')} · latest{' '}
          {trend.latestSnrDb === null ? '—' : `${trend.latestSnrDb.toFixed(1)} dB`} · path{' '}
          {trend.latestPathLength ?? '—'}
          {trend.pathDelta === null ? '' : ` (${formatDelta(trend.pathDelta, '')})`}
        </Text>
        <Text style={styles.detail}>{trend.detail}</Text>
        <Text style={styles.disclaimer}>
          Position is still current. This warning uses observed link history only and does not predict when contact will be lost.
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.focusButton, targeted && styles.focusButtonActive]}
          onPress={() =>
            targeted ? clearNavigationTarget() : setNavigationTarget(current.vehicleId)
          }>
          <Text style={[styles.focusText, targeted && styles.focusTextActive]}>
            {targeted ? 'FOCUSED' : 'FOCUS'}
          </Text>
        </TouchableOpacity>
        {showNext ? (
          <TouchableOpacity
            style={styles.nextButton}
            onPress={() =>
              setCaseIndex(index => (index + 1) % watchCases.length)
            }>
            <Text style={styles.nextText}>NEXT</Text>
          </TouchableOpacity>
        ) : null}
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
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
  },
  fragile: {borderBottomColor: colors.danger},
  degrading: {borderBottomColor: colors.warning},
  copy: {flex: 1, minWidth: 0},
  eyebrow: {fontSize: 8, fontWeight: '900', letterSpacing: 1},
  fragileText: {color: colors.danger},
  degradingText: {color: colors.warning},
  name: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },
  metrics: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 3,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 3,
  },
  disclaimer: {
    color: colors.textMuted,
    fontSize: 8,
    lineHeight: 11,
    marginTop: 3,
  },
  actions: {gap: 6},
  focusButton: {
    minWidth: 72,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 8,
    alignItems: 'center',
  },
  focusButtonActive: {backgroundColor: colors.warning},
  focusText: {color: colors.warning, fontSize: 8, fontWeight: '900'},
  focusTextActive: {color: colors.background},
  nextButton: {
    minWidth: 72,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    alignItems: 'center',
  },
  nextText: {color: colors.textSecondary, fontSize: 8, fontWeight: '900'},
});
