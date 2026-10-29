import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {assessFieldDiagnostics} from '../diagnostics/diagnosticHealth';
import {buildFieldChecklist} from '../diagnostics/fieldChecklist';
import {fieldReportSupportCode} from '../diagnostics/supportCode';
import {useFieldDiagnosticsReport} from '../diagnostics/useFieldDiagnosticsReport';
import {colors} from '../theme/colors';

export function FieldSupportSnapshot(): React.JSX.Element {
  const [capturedAtMs, setCapturedAtMs] = useState(Date.now());
  const report = useFieldDiagnosticsReport(capturedAtMs);
  const health = useMemo(() => assessFieldDiagnostics(report), [report]);
  const checklist = useMemo(() => buildFieldChecklist(report, health), [health, report]);
  const supportCode = useMemo(() => fieldReportSupportCode(report), [report]);
  const blocked = checklist.items.filter(item => item.state === 'blocked').slice(0, 3);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>SUPPORT SNAPSHOT</Text>
          <Text style={styles.code}>{supportCode}</Text>
        </View>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => setCapturedAtMs(Date.now())}>
          <Text style={styles.refreshText}>REFRESH</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.countRow}>
        <View style={styles.countBox}>
          <Text style={[styles.countValue, styles.passText]}>{checklist.passCount}</Text>
          <Text style={styles.countLabel}>PASS</Text>
        </View>
        <View style={styles.countBox}>
          <Text style={[styles.countValue, styles.checkText]}>{checklist.checkCount}</Text>
          <Text style={styles.countLabel}>CHECK</Text>
        </View>
        <View style={styles.countBox}>
          <Text style={[styles.countValue, styles.blockedText]}>{checklist.blockedCount}</Text>
          <Text style={styles.countLabel}>BLOCKED</Text>
        </View>
      </View>

      <Text style={styles.summary}>{health.summary}</Text>

      {blocked.length > 0 ? (
        <View style={styles.blockedList}>
          {blocked.map(item => (
            <View key={item.id} style={styles.blockedRow}>
              <View style={styles.blockedDot} />
              <View style={styles.blockedCopy}>
                <Text style={styles.blockedTitle}>{item.title}</Text>
                {item.nextAction ? (
                  <Text style={styles.blockedDetail}>{item.nextAction}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.readyText}>
          No BLOCKED checklist items are visible in this capture.
        </Text>
      )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {flex: 1, minWidth: 0},
  eyebrow: {color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1},
  code: {color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 2},
  refreshButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  refreshText: {color: colors.textSecondary, fontSize: 8, fontWeight: '900'},
  countRow: {flexDirection: 'row', gap: 8, marginTop: 11},
  countBox: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  countValue: {fontSize: 18, fontWeight: '900'},
  passText: {color: colors.success},
  checkText: {color: colors.warning},
  blockedText: {color: colors.danger},
  countLabel: {color: colors.textMuted, fontSize: 7, fontWeight: '900', marginTop: 1},
  summary: {color: colors.textSecondary, fontSize: 9, lineHeight: 13, marginTop: 10},
  blockedList: {gap: 8, marginTop: 10},
  blockedRow: {flexDirection: 'row', gap: 8},
  blockedDot: {width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger, marginTop: 4},
  blockedCopy: {flex: 1, minWidth: 0},
  blockedTitle: {color: colors.textPrimary, fontSize: 9, fontWeight: '900'},
  blockedDetail: {color: colors.textSecondary, fontSize: 8, lineHeight: 12, marginTop: 2},
  readyText: {color: colors.success, fontSize: 9, fontWeight: '800', marginTop: 10},
});
