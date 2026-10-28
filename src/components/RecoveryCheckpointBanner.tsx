import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {formatDistance} from '../convoy/convoy';
import {useConvoy} from '../state/ConvoyContext';
import {useConvoyRecovery} from '../state/ConvoyRecoveryContext';
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

export function RecoveryCheckpointBanner(): React.JSX.Element | null {
  const {activeCases} = useConvoyRecovery();
  const {
    localPosition,
    navigationFieldTarget,
    setNavigationFieldTarget,
    clearNavigationTarget,
  } = useConvoy();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  const recoveryCase =
    activeCases.find(item => item.checkpoints?.lastContinuousBeforeBreak) ?? null;
  const checkpoint = recoveryCase?.checkpoints?.lastContinuousBeforeBreak ?? null;
  const latestBreak = recoveryCase?.checkpoints?.latestBreak ?? null;

  if (!recoveryCase || !checkpoint || !latestBreak) {
    return null;
  }

  const targetId = `recovery-checkpoint:${recoveryCase.vehicle.id}:${checkpoint.receivedAtMs}`;
  const selected = navigationFieldTarget?.id === targetId;
  const ageSeconds = Math.max(
    0,
    Math.floor((nowMs - checkpoint.receivedAtMs) / 1000),
  );
  const directDistance = localPosition
    ? formatDistance(
        Math.sqrt(
          // Display-only approximation is deliberately avoided here; the
          // actual navigation surface calculates geodesic distance/bearing.
          0,
        ),
      )
    : null;

  const selectCheckpoint = () => {
    if (selected) {
      clearNavigationTarget();
      return;
    }

    setNavigationFieldTarget({
      id: targetId,
      label: `${recoveryCase.vehicle.name} recovery checkpoint`,
      type: 'recovery-checkpoint',
      latitude: checkpoint.latitude,
      longitude: checkpoint.longitude,
      senderId: recoveryCase.vehicle.id,
      createdAtMs: checkpoint.receivedAtMs,
      expiresAtMs: null,
    });
  };

  return (
    <View style={styles.banner}>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>LAST CONTINUOUS CHECKPOINT</Text>
        <Text style={styles.name}>{recoveryCase.vehicle.name}</Text>
        <Text style={styles.detail}>
          {formatAge(ageSeconds)} old · trail break follows this fix ·{' '}
          {formatDistance(latestBreak.distanceJumpMeters)} discontinuity
        </Text>
        <Text style={styles.warning}>
          Reference anchor only. This is an observed historical fix, not the vehicle’s current or predicted location.
        </Text>
        {directDistance ? (
          <Text style={styles.directDistance}>{directDistance} direct</Text>
        ) : null}
      </View>

      <TouchableOpacity
        style={[styles.button, selected && styles.buttonActive]}
        onPress={selectCheckpoint}>
        <Text style={[styles.buttonText, selected && styles.buttonTextActive]}>
          {selected ? 'TARGET' : 'CHECKPOINT'}
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
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.warning,
  },
  copy: {flex: 1, minWidth: 0},
  eyebrow: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 2,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  warning: {
    color: colors.textMuted,
    fontSize: 8,
    lineHeight: 12,
    marginTop: 3,
  },
  directDistance: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '800',
    marginTop: 3,
  },
  button: {
    minWidth: 88,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 8,
    alignItems: 'center',
  },
  buttonActive: {backgroundColor: colors.warning},
  buttonText: {color: colors.warning, fontSize: 8, fontWeight: '900'},
  buttonTextActive: {color: colors.background},
});
