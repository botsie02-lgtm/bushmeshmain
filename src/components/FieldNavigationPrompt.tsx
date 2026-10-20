import React, {useMemo} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {distanceMeters, formatDistance} from '../convoy/convoy';
import {fieldTargetLabel} from '../convoy/fieldTarget';
import {activeOperationalMarkers} from '../convoy/operationalMarkers';
import {useConvoy} from '../state/ConvoyContext';
import {useDrive} from '../state/DriveContext';
import {colors} from '../theme/colors';

const NAVIGABLE_TYPES = new Set(['regroup', 'help', 'hazard']);

function priority(type: string): number {
  switch (type) {
    case 'help':
      return 3;
    case 'regroup':
      return 2;
    case 'hazard':
      return 1;
    default:
      return 0;
  }
}

export function FieldNavigationPrompt(): React.JSX.Element | null {
  const {operationalMarkers} = useDrive();
  const {
    localPosition,
    navigationFieldTarget,
    setNavigationFieldTarget,
    clearNavigationTarget,
  } = useConvoy();

  const candidate = useMemo(() => {
    const active = activeOperationalMarkers(operationalMarkers)
      .filter(marker => NAVIGABLE_TYPES.has(marker.type))
      .sort((left, right) => {
        const priorityDelta = priority(right.type) - priority(left.type);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        return right.createdAtMs - left.createdAtMs;
      });

    return active[0] ?? null;
  }, [operationalMarkers]);

  if (!candidate) {
    return null;
  }

  const targeted = navigationFieldTarget?.id === candidate.id;
  const distance = localPosition
    ? formatDistance(distanceMeters(localPosition, candidate))
    : null;
  const label = fieldTargetLabel(candidate.type);

  const activate = () => {
    setNavigationFieldTarget({
      id: candidate.id,
      label,
      type: candidate.type,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      senderId: candidate.senderId,
      createdAtMs: candidate.createdAtMs,
      expiresAtMs: candidate.expiresAtMs,
    });
  };

  return (
    <View style={styles.banner}>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>
          {candidate.type === 'help'
            ? 'ASSISTANCE LOCATION'
            : candidate.type === 'regroup'
              ? 'REGROUP LOCATION'
              : 'HAZARD LOCATION'}
        </Text>
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.detail}>
          sender {candidate.senderId.slice(-6)}
          {distance ? ` · ${distance} direct` : ' · waiting for your GPS'}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.button, targeted && styles.buttonActive]}
        onPress={targeted ? clearNavigationTarget : activate}>
        <Text style={[styles.buttonText, targeted && styles.buttonTextActive]}>
          {targeted ? 'STOP NAV' : 'NAVIGATE'}
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
    paddingVertical: 11,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  copy: {flex: 1, minWidth: 0},
  eyebrow: {
    color: colors.warning,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 3,
  },
  button: {
    minWidth: 84,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  buttonActive: {
    backgroundColor: colors.accent,
  },
  buttonText: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
  },
  buttonTextActive: {
    color: colors.background,
  },
});
