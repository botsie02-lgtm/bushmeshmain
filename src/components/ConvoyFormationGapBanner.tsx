import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {formatDistance} from '../convoy/convoy';
import {ConvoyGapDecision} from '../convoy/gapMonitor';
import {useConvoyFormation} from '../state/ConvoyFormationContext';
import {colors} from '../theme/colors';

type FormationGapAlert = {
  aheadLabel: string;
  behindLabel: string;
  gap: ConvoyGapDecision;
};

function severity(gap: ConvoyGapDecision): number {
  switch (gap.state) {
    case 'critical':
      return 2;
    case 'caution':
      return 1;
    default:
      return 0;
  }
}

export function ConvoyFormationGapBanner(): React.JSX.Element | null {
  const {configured, snapshot, cautionGapMeters, criticalGapMeters} =
    useConvoyFormation();

  const alert = useMemo<FormationGapAlert | null>(() => {
    if (!configured) {
      return null;
    }

    const byId = new Map(snapshot.members.map(member => [member.id, member]));
    return snapshot.members.reduce<FormationGapAlert | null>((current, behind) => {
      const gap = behind.gapToAhead;
      if (
        !gap ||
        (gap.state !== 'caution' && gap.state !== 'critical') ||
        behind.aheadId === null
      ) {
        return current;
      }

      const ahead = byId.get(behind.aheadId);
      if (!ahead) {
        return current;
      }

      const candidate = {
        aheadLabel: ahead.label,
        behindLabel: behind.label,
        gap,
      };
      if (!current || severity(candidate.gap) > severity(current.gap)) {
        return candidate;
      }
      return current;
    }, null);
  }, [configured, snapshot]);

  if (!alert) {
    return null;
  }

  const critical = alert.gap.state === 'critical';
  const directGap =
    alert.gap.distanceMeters === null
      ? 'unknown'
      : formatDistance(alert.gap.distanceMeters);

  return (
    <View style={[styles.banner, critical ? styles.critical : styles.caution]}>
      <View style={styles.copy}>
        <Text
          style={[
            styles.eyebrow,
            critical ? styles.criticalText : styles.cautionText,
          ]}>
          {critical ? 'FORMATION GAP CRITICAL' : 'FORMATION GAP WIDENING'}
        </Text>
        <Text style={styles.title} numberOfLines={1}>
          {alert.aheadLabel} → {alert.behindLabel}
        </Text>
        <Text style={styles.detail}>
          {directGap} direct separation · caution {formatDistance(cautionGapMeters)} ·
          critical {formatDistance(criticalGapMeters)}
        </Text>
      </View>
      <View style={[styles.badge, critical ? styles.badgeCritical : styles.badgeCaution]}>
        <Text style={styles.badgeText}>{critical ? 'CRITICAL' : 'CAUTION'}</Text>
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
  critical: {borderBottomColor: colors.danger},
  caution: {borderBottomColor: colors.warning},
  copy: {flex: 1, minWidth: 0},
  eyebrow: {fontSize: 9, fontWeight: '900', letterSpacing: 1},
  criticalText: {color: colors.danger},
  cautionText: {color: colors.warning},
  title: {color: colors.textPrimary, fontSize: 13, fontWeight: '900', marginTop: 2},
  detail: {color: colors.textSecondary, fontSize: 9, lineHeight: 13, marginTop: 3},
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  badgeCritical: {borderColor: colors.danger},
  badgeCaution: {borderColor: colors.warning},
  badgeText: {color: colors.textPrimary, fontSize: 7, fontWeight: '900'},
});
