import React, {useMemo} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {formatDistance} from '../convoy/convoy';
import {ConvoyGapDecision} from '../convoy/gapMonitor';
import {useConvoy} from '../state/ConvoyContext';
import {useConvoyFormation} from '../state/ConvoyFormationContext';
import {colors} from '../theme/colors';

function gapLabel(gap: ConvoyGapDecision | null): string {
  if (!gap) {
    return 'FRONT';
  }
  switch (gap.state) {
    case 'good':
      return gap.distanceMeters == null
        ? 'GAP OK'
        : `${formatDistance(gap.distanceMeters)} GAP`;
    case 'caution':
      return gap.distanceMeters == null
        ? 'GAP WIDENING'
        : `${formatDistance(gap.distanceMeters)} CAUTION`;
    case 'critical':
      return gap.distanceMeters == null
        ? 'GAP CRITICAL'
        : `${formatDistance(gap.distanceMeters)} CRITICAL`;
    case 'lost':
      return 'AHEAD LOST';
    case 'unknown':
      return 'GAP UNKNOWN';
  }
}

function gapColor(gap: ConvoyGapDecision | null): string {
  switch (gap?.state) {
    case 'good':
      return colors.success;
    case 'caution':
    case 'unknown':
      return colors.warning;
    case 'critical':
    case 'lost':
      return colors.danger;
    default:
      return colors.textMuted;
  }
}

export function ConvoyFormationPanel(): React.JSX.Element {
  const {vehicles} = useConvoy();
  const {
    configured,
    members,
    snapshot,
    startDraftFormation,
    clearFormation,
    moveMember,
    removeMember,
    addVehicle,
  } = useConvoyFormation();

  const assignedIds = useMemo(() => new Set(members.map(member => member.id)), [members]);
  const unassignedVehicles = useMemo(
    () => vehicles.filter(vehicle => !assignedIds.has(vehicle.id)),
    [assignedIds, vehicles],
  );

  if (!configured) {
    return (
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>CONVOY FORMATION</Text>
        <Text style={styles.title}>Order not configured</Text>
        <Text style={styles.body}>
          Bushmesh will not guess lead or tail from GPS geometry. Create a draft
          from the heard-member list, then explicitly arrange the real convoy order.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={startDraftFormation}>
          <Text style={styles.primaryButtonText}>CREATE DRAFT ORDER</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>CONVOY FORMATION</Text>
          <Text style={styles.title}>
            {snapshot.members.length} vehicle{snapshot.members.length === 1 ? '' : 's'} in order
          </Text>
          <Text style={styles.body}>
            Adjacent gaps are straight-line separation only. Stale or lost fixes
            make the gap unknown rather than reusing an old coordinate.
          </Text>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearFormation}>
          <Text style={styles.clearButtonText}>RESET</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryMetric}>
          <Text style={styles.summaryValue}>{snapshot.worstGapState.toUpperCase()}</Text>
          <Text style={styles.summaryLabel}>WORST GAP</Text>
        </View>
        <View style={styles.summaryMetric}>
          <Text style={styles.summaryValue}>{snapshot.alertCount}</Text>
          <Text style={styles.summaryLabel}>ALERT GAPS</Text>
        </View>
        <View style={styles.summaryMetric}>
          <Text style={styles.summaryValue}>{snapshot.unknownGapCount}</Text>
          <Text style={styles.summaryLabel}>UNKNOWN</Text>
        </View>
      </View>

      <View style={styles.memberList}>
        {snapshot.members.map((state, index) => {
          const self = state.kind === 'self';
          return (
            <View key={state.id} style={styles.memberRow}>
              <View style={styles.orderBadge}>
                <Text style={styles.orderNumber}>{index + 1}</Text>
                <Text style={styles.roleText}>{state.role.toUpperCase()}</Text>
              </View>
              <View style={styles.memberCopy}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {state.label}{self ? ' · THIS VEHICLE' : ''}
                </Text>
                <Text style={[styles.gapText, {color: gapColor(state.gapToAhead)}]}>
                  {gapLabel(state.gapToAhead)}
                  {state.freshness !== 'self'
                    ? ` · ${state.freshness.toUpperCase()}`
                    : ''}
                </Text>
              </View>
              <View style={styles.memberActions}>
                <TouchableOpacity
                  style={[styles.arrowButton, index === 0 && styles.disabledButton]}
                  disabled={index === 0}
                  onPress={() => moveMember(state.id, 'up')}>
                  <Text style={styles.arrowText}>↑</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.arrowButton,
                    index === snapshot.members.length - 1 && styles.disabledButton,
                  ]}
                  disabled={index === snapshot.members.length - 1}
                  onPress={() => moveMember(state.id, 'down')}>
                  <Text style={styles.arrowText}>↓</Text>
                </TouchableOpacity>
                {!self ? (
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => removeMember(state.id)}>
                    <Text style={styles.removeText}>×</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {unassignedVehicles.length > 0 ? (
        <View style={styles.unassignedSection}>
          <Text style={styles.unassignedTitle}>HEARD · NOT IN FORMATION</Text>
          <View style={styles.unassignedWrap}>
            {unassignedVehicles.map(vehicle => (
              <TouchableOpacity
                key={vehicle.id}
                style={styles.addButton}
                onPress={() => addVehicle(vehicle.id)}>
                <Text style={styles.addButtonText}>+ {vehicle.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerRow: {flexDirection: 'row', gap: 12, alignItems: 'flex-start'},
  headerCopy: {flex: 1, minWidth: 0},
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {color: colors.textPrimary, fontSize: 16, fontWeight: '900', marginTop: 3},
  body: {color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 5},
  primaryButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  primaryButtonText: {color: colors.background, fontSize: 9, fontWeight: '900'},
  clearButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  clearButtonText: {color: colors.textSecondary, fontSize: 8, fontWeight: '900'},
  summaryRow: {flexDirection: 'row', gap: 8, marginTop: 12},
  summaryMetric: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 9,
    backgroundColor: colors.surfaceSoft,
  },
  summaryValue: {color: colors.textPrimary, fontSize: 13, fontWeight: '900'},
  summaryLabel: {color: colors.textMuted, fontSize: 7, fontWeight: '900', marginTop: 2},
  memberList: {marginTop: 10, gap: 7},
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  orderBadge: {width: 42, alignItems: 'center'},
  orderNumber: {color: colors.textPrimary, fontSize: 16, fontWeight: '900'},
  roleText: {color: colors.textMuted, fontSize: 6, fontWeight: '900'},
  memberCopy: {flex: 1, minWidth: 0},
  memberName: {color: colors.textPrimary, fontSize: 11, fontWeight: '900'},
  gapText: {fontSize: 8, fontWeight: '900', marginTop: 3},
  memberActions: {flexDirection: 'row', alignItems: 'center', gap: 4},
  arrowButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {opacity: 0.3},
  arrowText: {color: colors.textPrimary, fontSize: 13, fontWeight: '900'},
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: {color: colors.danger, fontSize: 17, lineHeight: 18, fontWeight: '900'},
  unassignedSection: {marginTop: 12},
  unassignedTitle: {color: colors.textMuted, fontSize: 8, fontWeight: '900'},
  unassignedWrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7},
  addButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  addButtonText: {color: colors.accent, fontSize: 8, fontWeight: '900'},
});
