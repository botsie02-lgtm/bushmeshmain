import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {useConvoyRecovery} from '../state/ConvoyRecoveryContext';
import {colors} from '../theme/colors';

function formatDuration(durationMs: number | null, startedAtMs: number): string {
  const elapsedMs = durationMs ?? Math.max(0, Date.now() - startedAtMs);
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3_600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  return `${Math.floor(seconds / 3_600)}h`;
}

export function ConvoyRecoveryHistoryStrip(): React.JSX.Element | null {
  const {incidents, clearRecoveryHistory} = useConvoyRecovery();
  const recent = incidents.slice(0, 3);

  if (recent.length === 0) {
    return null;
  }

  const activeCount = incidents.filter(incident => incident.status === 'active').length;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>RECOVERY INCIDENTS</Text>
          <Text style={styles.summary}>
            {incidents.length} incident{incidents.length === 1 ? '' : 's'} this session
            {activeCount > 0 ? ` · ${activeCount} active` : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearRecoveryHistory}>
          <Text style={styles.clearText}>CLEAR</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.eventsRow}>
        {recent.map(incident => {
          const active = incident.status === 'active';
          return (
            <View key={incident.id} style={styles.eventChip}>
              <Text
                style={[
                  styles.eventType,
                  active
                    ? incident.worstState === 'lost'
                      ? styles.lostText
                      : styles.staleText
                    : styles.recoveredText,
                ]}>
                {active
                  ? incident.worstState === 'lost'
                    ? 'LOST · ACTIVE'
                    : 'STALE · ACTIVE'
                  : incident.worstState === 'lost'
                    ? 'LOST · RECOVERED'
                    : 'STALE · RECOVERED'}
              </Text>
              <Text style={styles.eventName} numberOfLines={1}>
                {incident.vehicleName}
              </Text>
              <Text style={styles.eventAge}>
                {formatDuration(incident.durationMs, incident.startedAtMs)}
                {incident.escalatedToLostAtMs !== null ? ' · escalated' : ''}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surfaceSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  eyebrow: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  summary: {
    color: colors.textSecondary,
    fontSize: 9,
    marginTop: 2,
  },
  clearButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  clearText: {color: colors.textSecondary, fontSize: 8, fontWeight: '900'},
  eventsRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 8,
  },
  eventChip: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 7,
    backgroundColor: colors.surface,
  },
  eventType: {fontSize: 8, fontWeight: '900'},
  staleText: {color: colors.warning},
  lostText: {color: colors.danger},
  recoveredText: {color: colors.success},
  eventName: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
  },
  eventAge: {
    color: colors.textMuted,
    fontSize: 8,
    marginTop: 2,
  },
});
