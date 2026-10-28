import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {useConvoyRecovery} from '../state/ConvoyRecoveryContext';
import {colors} from '../theme/colors';

function eventLabel(type: 'stale' | 'lost' | 'reacquired'): string {
  switch (type) {
    case 'stale':
      return 'STALE';
    case 'lost':
      return 'LOST';
    case 'reacquired':
      return 'BACK';
  }
}

function eventColor(type: 'stale' | 'lost' | 'reacquired'): string {
  switch (type) {
    case 'stale':
      return colors.warning;
    case 'lost':
      return colors.danger;
    case 'reacquired':
      return colors.success;
  }
}

function formatEventAge(occurredAtMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - occurredAtMs) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3_600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  return `${Math.floor(seconds / 3_600)}h`;
}

export function ConvoyRecoveryHistoryStrip(): React.JSX.Element | null {
  const {events, clearRecoveryHistory} = useConvoyRecovery();
  const recent = events.slice(0, 3);

  if (recent.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>RECOVERY HISTORY</Text>
          <Text style={styles.summary}>
            {events.length} transition{events.length === 1 ? '' : 's'} retained this session
          </Text>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearRecoveryHistory}>
          <Text style={styles.clearText}>CLEAR</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.eventsRow}>
        {recent.map(event => (
          <View key={event.id} style={styles.eventChip}>
            <Text style={[styles.eventType, {color: eventColor(event.type)}]}>
              {eventLabel(event.type)}
            </Text>
            <Text style={styles.eventName} numberOfLines={1}>
              {event.vehicleName}
            </Text>
            <Text style={styles.eventAge}>{formatEventAge(event.occurredAtMs)}</Text>
          </View>
        ))}
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
