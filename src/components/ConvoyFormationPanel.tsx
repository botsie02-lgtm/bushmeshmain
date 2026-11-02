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

const GAP_PRESETS = [
  {label: 'COMPACT', caution: 300, critical: 600},
  {label: 'STANDARD', caution: 600, critical: 1_000},
  {label: 'SPREAD', caution: 1_000, critical: 1_800},
] as const;

export function ConvoyFormationPanel(): React.JSX.Element {
  const {vehicles} = useConvoy();
  const {
    configured,
    members,
    snapshot,
    cautionGapMeters,
    criticalGapMeters,
    persistenceStatus,
    persistenceError,
    startDraftFormation,
    clearFormation,
    moveMember,
    removeMember,
    addVehicle,
    setGapThresholds,
    resetFormationStorage,
  } = useConvoyFormation();

  const assignedIds = useMemo(
    () => new Set(members.map(member => member.id)),
    [members],
  );
  const unassignedVehicles = useMemo(
    () => vehicles.filter(vehicle => !assignedIds.has(vehicle.id)),
    [assignedIds, vehicles],
  );

  const storageCopy =
    persistenceStatus === 'loading'
      ? 'LOADING SECURE FORMATION…'
      : persistenceStatus === 'ready'
        ? 'ENCRYPTED FORMATION SAVED ON ANDROID'
        : persistenceStatus === 'unsupported'
          ? 'FORMATION IS SESSION-ONLY ON THIS PLATFORM'
          : 'SECURE FORMATION STORAGE NEEDS ATTENTION';

  const storageColor =
    persistenceStatus === 'ready'
      ? colors.success
      : persistenceStatus === 'error'
        ? colors.danger
        : colors.textMuted;

  const storageStatus = (
    <View style={styles.storageCard}>
      <View style={styles.storageCopy}>
        <Text style={[styles.storageLabel, {color: storageColor}]}>
          {storageCopy}
        </Text>
        {persistenceStatus === 'error' ? (
          <Text style={styles.storageError} numberOfLines={3}>
            {persistenceError ??
              'Bushmesh could not read the encrypted formation snapshot.'}
          </Text>
        ) : null}
      </View>
      {persistenceStatus === 'error' ? (
        <TouchableOpacity
          style={styles.storageResetButton}
          onPress={() => resetFormationStorage().catch(() => undefined)}>
          <Text style={styles.storageResetText}>RESET STORAGE</Text>
        </TouchableOpacity>
      ) : null}
    </View>
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
        {storageStatus}
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={startDraftFormation}
          disabled={persistenceStatus === 'loading'}>
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

      {storageStatus}

      <View style={styles.thresholdCard}>
        <View style={styles.thresholdHeader}>
          <View>
            <Text style={styles.thresholdEyebrow}>GAP ALERT THRESHOLDS</Text>
            <Text style={styles.thresholdValue}>
              caution {formatDistance(cautionGapMeters)} · critical{' '}
              {formatDistance(criticalGapMeters)}
            </Text>
          </View>
        </View>
        <Text style={styles.thresholdHint}>
          These are Bushmesh alert settings, not universal safe following distances.
          Pick values appropriate to your convoy, terrain, visibility and speed.
        </Text>
        <View style={styles.presetRow}>
          {GAP_PRESETS.map(preset => {
            const active =
              cautionGapMeters === preset.caution &&
              criticalGapMeters === preset.critical;
            return (
              <TouchableOpacity
                key={preset.label}
                style={[styles.presetButton, active && styles.presetButtonActive]}
                onPress={() =>
                  setGapThresholds(preset.caution, preset.critical)
                }>
                <Text
                  style={[
                    styles.presetText,
                    active && styles.presetTextActive,
                  ]}>
                  {preset.label}
                </Text>
                <Text
                  style={[
                    styles.presetMeta,
                    active && styles.presetTextActive,
                  ]}>
                  {preset.caution}/{preset.critical} m
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
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
                  {state.label}
                  {self ? ' · THIS VEHICLE' : ''}
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
  storageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 11,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
  },
  storageCopy: {flex: 1, minWidth: 0},
  storageLabel: {fontSize: 8, fontWeight: '900'},
  storageError: {color: colors.textSecondary, fontSize: 9, lineHeight: 13, marginTop: 3},
  storageResetButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  storageResetText: {color: colors.danger, fontSize: 7, fontWeight: '900'},
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
  thresholdCard: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thresholdHeader: {flexDirection: 'row', justifyContent: 'space-between'},
  thresholdEyebrow: {color: colors.textMuted, fontSize: 8, fontWeight: '900'},
  thresholdValue: {color: colors.textPrimary, fontSize: 10, fontWeight: '900', marginTop: 2},
  thresholdHint: {color: colors.textMuted, fontSize: 8, lineHeight: 12, marginTop: 5},
  presetRow: {flexDirection: 'row', gap: 6, marginTop: 8},
  presetButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 7,
    alignItems: 'center',
  },
  presetButtonActive: {backgroundColor: colors.accent, borderColor: colors.accent},
  presetText: {color: colors.textSecondary, fontSize: 7, fontWeight: '900'},
  presetMeta: {color: colors.textMuted, fontSize: 7, marginTop: 2},
  presetTextActive: {color: colors.background},
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
