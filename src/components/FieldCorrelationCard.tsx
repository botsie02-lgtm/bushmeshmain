import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {correlateFieldEvents} from '../diagnostics/eventCorrelation';
import {useFieldEventTrace} from '../state/FieldEventTraceContext';
import {colors} from '../theme/colors';

function formatWindow(windowMs: number): string {
  const seconds = Math.max(0, Math.round(windowMs / 1000));
  if (seconds < 60) {
    return `${seconds}s apart`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0
    ? `${minutes}m apart`
    : `${minutes}m ${remainingSeconds}s apart`;
}

export function FieldCorrelationCard(): React.JSX.Element | null {
  const {events} = useFieldEventTrace();
  const correlations = useMemo(() => correlateFieldEvents(events), [events]);

  if (correlations.length === 0) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>TIMING CLUES · NOT CAUSAL DIAGNOSES</Text>
      <Text style={styles.title}>Events worth inspecting together</Text>
      <Text style={styles.intro}>
        Bushmesh found state changes that happened close together. These clues only prioritise investigation; they do not prove one event caused another.
      </Text>

      <View style={styles.items}>
        {correlations.slice(0, 3).map(correlation => (
          <View key={correlation.id} style={styles.item}>
            <View
              style={[
                styles.confidenceDot,
                correlation.confidence === 'medium'
                  ? styles.confidenceMedium
                  : styles.confidenceLow,
              ]}
            />
            <View style={styles.copy}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{correlation.title}</Text>
                <Text style={styles.window}>{formatWindow(correlation.windowMs)}</Text>
              </View>
              <Text style={styles.detail}>{correlation.detail}</Text>
              <Text style={styles.codes}>
                {correlation.confidence.toUpperCase()} CONFIDENCE ·{' '}
                {correlation.eventCodes.join(' → ')}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 10,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
  },
  eyebrow: {color: colors.textMuted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8},
  title: {color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 2},
  intro: {color: colors.textSecondary, fontSize: 8, lineHeight: 12, marginTop: 6},
  items: {gap: 9, marginTop: 10},
  item: {flexDirection: 'row', gap: 8},
  confidenceDot: {width: 7, height: 7, borderRadius: 4, marginTop: 4},
  confidenceMedium: {backgroundColor: colors.warning},
  confidenceLow: {backgroundColor: colors.accent},
  copy: {flex: 1, minWidth: 0},
  itemHeader: {flexDirection: 'row', justifyContent: 'space-between', gap: 8},
  itemTitle: {flex: 1, color: colors.textPrimary, fontSize: 9, fontWeight: '900'},
  window: {color: colors.textMuted, fontSize: 7, fontWeight: '800'},
  detail: {color: colors.textSecondary, fontSize: 8, lineHeight: 12, marginTop: 2},
  codes: {color: colors.textMuted, fontSize: 7, fontWeight: '800', marginTop: 3},
});
