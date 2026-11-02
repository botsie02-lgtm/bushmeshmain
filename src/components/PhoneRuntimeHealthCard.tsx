import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {
  assessPhoneRuntimeHealth,
  thermalStatusLabel,
} from '../diagnostics/phoneRuntimeHealth';
import {
  SupportRuntimeMetadata,
  loadSupportRuntimeMetadata,
} from '../diagnostics/runtimeMetadata';
import {colors} from '../theme/colors';

function booleanLabel(value: boolean | null): string {
  return value === null ? 'UNKNOWN' : value ? 'YES' : 'NO';
}

export function PhoneRuntimeHealthCard(): React.JSX.Element {
  const [runtime, setRuntime] = useState<SupportRuntimeMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadSupportRuntimeMetadata();
      setRuntime(next);
      setError(null);
      setUpdatedAtMs(Date.now());
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Phone runtime metadata could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
    const timer = setInterval(() => {
      refresh().catch(() => undefined);
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const health = useMemo(() => assessPhoneRuntimeHealth(runtime), [runtime]);

  return (
    <View
      style={[
        styles.card,
        health.severity === 'action'
          ? styles.cardAction
          : health.severity === 'watch'
            ? styles.cardWatch
            : styles.cardOk,
      ]}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>PHONE RUNTIME</Text>
          <Text style={styles.title}>
            {health.severity === 'action'
              ? 'Handset needs attention'
              : health.severity === 'watch'
                ? 'Monitor handset conditions'
                : 'Handset conditions look suitable'}
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshButton} onPress={() => refresh().catch(() => undefined)}>
          <Text style={styles.refreshText}>{loading ? 'READING…' : 'REFRESH'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.summary}>{health.summary}</Text>

      {runtime ? (
        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>
              {runtime.phoneBatteryPercent === null
                ? '—'
                : `${runtime.phoneBatteryPercent}%`}
            </Text>
            <Text style={styles.metricLabel}>PHONE BATTERY</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{booleanLabel(runtime.charging)}</Text>
            <Text style={styles.metricLabel}>CHARGING</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{booleanLabel(runtime.powerSaveMode)}</Text>
            <Text style={styles.metricLabel}>BATTERY SAVER</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>
              {thermalStatusLabel(runtime.thermalStatus)}
            </Text>
            <Text style={styles.metricLabel}>THERMAL</Text>
          </View>
        </View>
      ) : null}

      {runtime ? (
        <Text style={styles.buildText}>
          Bushmesh {runtime.appVersion ?? 'unknown'} · build {runtime.buildNumber ?? '—'} · Android API {runtime.platformApiLevel ?? '—'} · {runtime.architecture ?? 'unknown ABI'}
          {runtime.debugBuild === true ? ' · DEBUG BUILD' : ''}
        </Text>
      ) : null}

      {health.issues.map(issue => (
        <View key={issue.code} style={styles.issueRow}>
          <View
            style={[
              styles.issueDot,
              issue.severity === 'action'
                ? styles.issueDotAction
                : styles.issueDotWatch,
            ]}
          />
          <View style={styles.issueCopy}>
            <Text style={styles.issueTitle}>{issue.title}</Text>
            <Text style={styles.issueDetail}>{issue.detail}</Text>
          </View>
        </View>
      ))}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {updatedAtMs !== null ? (
        <Text style={styles.updatedText}>
          Updated {new Date(updatedAtMs).toLocaleTimeString()}. No device identifier is collected.
        </Text>
      ) : null}
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
  cardAction: {borderColor: colors.danger},
  cardWatch: {borderColor: colors.warning},
  cardOk: {borderColor: colors.success},
  header: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10},
  headerCopy: {flex: 1, minWidth: 0},
  eyebrow: {color: colors.textMuted, fontSize: 8, fontWeight: '900', letterSpacing: 1},
  title: {color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 2},
  refreshButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  refreshText: {color: colors.textSecondary, fontSize: 8, fontWeight: '900'},
  summary: {color: colors.textSecondary, fontSize: 9, lineHeight: 13, marginTop: 8},
  metrics: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10},
  metric: {width: '47%', borderRadius: 12, backgroundColor: colors.surfaceSoft, padding: 9},
  metricValue: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  metricLabel: {color: colors.textMuted, fontSize: 7, fontWeight: '900', marginTop: 2},
  buildText: {color: colors.textMuted, fontSize: 8, lineHeight: 12, marginTop: 9},
  issueRow: {flexDirection: 'row', gap: 8, marginTop: 9},
  issueDot: {width: 7, height: 7, borderRadius: 4, marginTop: 3},
  issueDotAction: {backgroundColor: colors.danger},
  issueDotWatch: {backgroundColor: colors.warning},
  issueCopy: {flex: 1, minWidth: 0},
  issueTitle: {color: colors.textPrimary, fontSize: 9, fontWeight: '900'},
  issueDetail: {color: colors.textSecondary, fontSize: 8, lineHeight: 12, marginTop: 2},
  errorText: {color: colors.danger, fontSize: 8, lineHeight: 12, marginTop: 8},
  updatedText: {color: colors.textMuted, fontSize: 7, marginTop: 8},
});
