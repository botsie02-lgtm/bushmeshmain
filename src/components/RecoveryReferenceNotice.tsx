import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {distanceMeters, formatDistance} from '../convoy/convoy';
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

export function RecoveryReferenceNotice({
  visible,
}: {
  visible: boolean;
}): React.JSX.Element | null {
  const {
    localPosition,
    navigationFieldTarget,
    clearNavigationTarget,
  } = useConvoy();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  if (
    !visible ||
    navigationFieldTarget?.type !== 'recovery-checkpoint'
  ) {
    return null;
  }

  const ageSeconds = Math.max(
    0,
    Math.floor((nowMs - navigationFieldTarget.createdAtMs) / 1000),
  );
  const directDistance = localPosition
    ? formatDistance(distanceMeters(localPosition, navigationFieldTarget))
    : null;

  return (
    <View style={styles.banner}>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>RECOVERY CHECKPOINT · REFERENCE ONLY</Text>
        <Text style={styles.name}>{navigationFieldTarget.label}</Text>
        <Text style={styles.detail}>
          Historical observed fix · {formatAge(ageSeconds)} old
          {directDistance ? ` · ${directDistance} direct` : ''}
        </Text>
        <Text style={styles.warning}>
          This target is not the vehicle’s current or predicted location. It is the last continuous fix before a detected trail break.
        </Text>
      </View>
      <TouchableOpacity style={styles.stopButton} onPress={clearNavigationTarget}>
        <Text style={styles.stopText}>STOP</Text>
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
    paddingVertical: 9,
    backgroundColor: colors.surfaceSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.warning,
  },
  copy: {flex: 1, minWidth: 0},
  eyebrow: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 2,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  warning: {
    color: colors.textMuted,
    fontSize: 8,
    lineHeight: 12,
    marginTop: 2,
  },
  stopButton: {
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  stopText: {color: colors.warning, fontSize: 8, fontWeight: '900'},
});
