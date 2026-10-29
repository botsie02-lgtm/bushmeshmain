import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {formatDistance} from '../convoy/convoy';
import {
  ConvoyRecoveryIncident,
  useConvoyRecovery,
} from '../state/ConvoyRecoveryContext';
import {colors} from '../theme/colors';

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return 'ACTIVE';
  }

  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds === 0
      ? `${minutes}m`
      : `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function incidentSummary(incident: ConvoyRecoveryIncident): string {
  if (incident.status === 'active') {
    return incident.worstState === 'lost'
      ? 'Recovery remains active. Last-known location is not current.'
      : 'Position is stale. Continue monitoring for a fresh fix.';
  }

  const offset =
    incident.reacquisitionOffsetMeters === null
      ? 'offset unavailable'
      : `${formatDistance(incident.reacquisitionOffsetMeters)} from last known`;
  return incident.reacquiredViaRequest
    ? `Reacquired after an explicit position request · ${offset}.`
    : `Reacquired from normal position traffic · ${offset}.`;
}

function RecoveryIncidentRow({
  incident,
}: {
  incident: ConvoyRecoveryIncident;
}): React.JSX.Element {
  const active = incident.status === 'active';
  return (
    <View style={[styles.row, active && styles.rowActive]}>
      <View style={styles.rowTop}>
        <View style={styles.identity}>
          <Text style={styles.vehicleName} numberOfLines={1}>
            {incident.vehicleName}
          </Text>
          <Text style={styles.vehicleId}>{incident.vehicleId.slice(-8)}</Text>
        </View>
        <View
          style={[
            styles.statePill,
            active ? styles.statePillActive : styles.statePillRecovered,
          ]}>
          <Text
            style={[
              styles.stateText,
              active ? styles.stateTextActive : styles.stateTextRecovered,
            ]}>
            {active ? incident.worstState.toUpperCase() : 'RECOVERED'}
          </Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <Text style={styles.metric}>Started {formatTime(incident.startedAtMs)}</Text>
        <Text style={styles.metric}>Duration {formatDuration(incident.durationMs)}</Text>
        <Text style={styles.metric}>{incident.eventIds.length} event{incident.eventIds.length === 1 ? '' : 's'}</Text>
      </View>

      <Text style={styles.summary}>{incidentSummary(incident)}</Text>

      {incident.escalatedToLostAtMs !== null ? (
        <Text style={styles.lossDetail}>
          Escalated to LOST at {formatTime(incident.escalatedToLostAtMs)}
        </Text>
      ) : null}
    </View>
  );
}

export function ConvoyRecoveryHistory(): React.JSX.Element | null {
  const {incidents, clearRecoveryHistory} = useConvoyRecovery();
  const [expanded, setExpanded] = useState(false);

  const visibleIncidents = useMemo(
    () => (expanded ? incidents.slice(0, 12) : incidents.slice(0, 3)),
    [expanded, incidents],
  );

  if (incidents.length === 0) {
    return null;
  }

  const activeCount = incidents.filter(incident => incident.status === 'active').length;
  const recoveredCount = incidents.length - activeCount;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>RECOVERY HISTORY</Text>
          <Text style={styles.title}>
            {activeCount} active · {recoveredCount} recovered
          </Text>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearRecoveryHistory}>
          <Text style={styles.clearText}>CLEAR</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.description}>
        Bushmesh records freshness transitions and recovery outcomes so a temporary LOST banner does not erase what happened.
      </Text>

      <View style={styles.rows}>
        {visibleIncidents.map(incident => (
          <RecoveryIncidentRow key={incident.id} incident={incident} />
        ))}
      </View>

      {incidents.length > 3 ? (
        <TouchableOpacity
          style={styles.expandButton}
          onPress={() => setExpanded(value => !value)}>
          <Text style={styles.expandText}>
            {expanded ? 'SHOW LESS' : `SHOW ${Math.min(12, incidents.length)} INCIDENTS`}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {flex: 1, minWidth: 0},
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  clearButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  clearText: {color: colors.textMuted, fontSize: 8, fontWeight: '900'},
  description: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 8,
  },
  rows: {gap: 8, marginTop: 12},
  row: {
    padding: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
  },
  rowActive: {borderColor: colors.warning},
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  identity: {flex: 1, minWidth: 0},
  vehicleName: {color: colors.textPrimary, fontSize: 13, fontWeight: '900'},
  vehicleId: {color: colors.textMuted, fontSize: 8, marginTop: 2},
  statePill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  statePillActive: {borderColor: colors.warning},
  statePillRecovered: {borderColor: colors.success},
  stateText: {fontSize: 8, fontWeight: '900'},
  stateTextActive: {color: colors.warning},
  stateTextRecovered: {color: colors.success},
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 7,
  },
  metric: {color: colors.textSecondary, fontSize: 8, fontWeight: '700'},
  summary: {color: colors.textSecondary, fontSize: 9, lineHeight: 13, marginTop: 6},
  lossDetail: {color: colors.danger, fontSize: 8, fontWeight: '800', marginTop: 5},
  expandButton: {
    marginTop: 10,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  expandText: {color: colors.accent, fontSize: 8, fontWeight: '900'},
});
