import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {summarizeLatestFieldTestRun} from '../diagnostics/fieldTestRun';
import {useFieldEventTrace} from '../state/FieldEventTraceContext';
import {colors} from '../theme/colors';

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function FieldTestRunCard(): React.JSX.Element | null {
  const {events} = useFieldEventTrace();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const run = useMemo(
    () => summarizeLatestFieldTestRun(events, nowMs),
    [events, nowMs],
  );

  if (!run) {
    return null;
  }

  return (
    <View
      style={[
        styles.card,
        run.state === 'active' ? styles.cardActive : styles.cardCompleted,
      ]}>
      <View style={styles.header}>
        <View>
          <Text
            style={[
              styles.eyebrow,
              run.state === 'active' ? styles.activeText : styles.completedText,
            ]}>
            {run.state === 'active' ? 'FIELD TEST RUNNING' : 'FIELD TEST COMPLETED'}
          </Text>
          <Text style={styles.title}>{formatDuration(run.durationMs)}</Text>
        </View>
        <Text style={styles.eventCount}>{run.eventCount} events</Text>
      </View>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, styles.actionText]}>
            {run.actionEventCount}
          </Text>
          <Text style={styles.metricLabel}>ACTION</Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, styles.watchText]}>
            {run.watchEventCount}
          </Text>
          <Text style={styles.metricLabel}>WATCH</Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, styles.infoText]}>
            {run.infoEventCount}
          </Text>
          <Text style={styles.metricLabel}>INFO</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{run.markerCodes.length}</Text>
          <Text style={styles.metricLabel}>MARKERS</Text>
        </View>
      </View>

      <Text style={styles.hint}>
        Counts cover only the most recent TEST START → TEST END window. Marker taps themselves are excluded from event severity counts.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: colors.surface,
    padding: 14,
  },
  cardActive: {borderColor: colors.accent},
  cardCompleted: {borderColor: colors.success},
  header: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12},
  eyebrow: {fontSize: 8, fontWeight: '900', letterSpacing: 1},
  activeText: {color: colors.accent},
  completedText: {color: colors.success},
  title: {color: colors.textPrimary, fontSize: 20, fontWeight: '900', marginTop: 2},
  eventCount: {color: colors.textSecondary, fontSize: 9, fontWeight: '800'},
  metrics: {flexDirection: 'row', gap: 8, marginTop: 11},
  metric: {flex: 1, borderRadius: 12, backgroundColor: colors.surfaceSoft, padding: 8},
  metricValue: {color: colors.textPrimary, fontSize: 17, fontWeight: '900'},
  actionText: {color: colors.danger},
  watchText: {color: colors.warning},
  infoText: {color: colors.accent},
  metricLabel: {color: colors.textMuted, fontSize: 7, fontWeight: '900', marginTop: 1},
  hint: {color: colors.textMuted, fontSize: 8, lineHeight: 12, marginTop: 9},
});
