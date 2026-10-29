import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {assessFieldDiagnostics} from '../diagnostics/diagnosticHealth';
import {buildFieldChecklist} from '../diagnostics/fieldChecklist';
import {buildFieldTriagePlan} from '../diagnostics/triagePlan';
import {useFieldDiagnosticsReport} from '../diagnostics/useFieldDiagnosticsReport';
import {colors} from '../theme/colors';

export function FieldTriageCard(): React.JSX.Element {
  const [capturedAtMs, setCapturedAtMs] = useState(Date.now());
  const report = useFieldDiagnosticsReport(capturedAtMs);
  const health = useMemo(() => assessFieldDiagnostics(report), [report]);
  const checklist = useMemo(() => buildFieldChecklist(report, health), [health, report]);
  const triage = useMemo(() => buildFieldTriagePlan(checklist), [checklist]);
  const visibleSteps = triage.steps.slice(0, 4);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>FIX FIRST</Text>
          <Text style={styles.title}>
            {triage.ready ? 'Field configuration is not blocked' : 'Repair order for this snapshot'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => setCapturedAtMs(Date.now())}>
          <Text style={styles.refreshText}>REFRESH</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.summary}>{triage.summary}</Text>

      {visibleSteps.length === 0 ? (
        <Text style={styles.readyText}>
          No unresolved checklist items are visible. Hardware/field validation is still required before release.
        </Text>
      ) : (
        <View style={styles.steps}>
          {visibleSteps.map((step, index) => (
            <View key={step.id} style={styles.step}>
              <View
                style={[
                  styles.orderBadge,
                  step.priority === 'first'
                    ? styles.orderFirst
                    : step.priority === 'next'
                      ? styles.orderNext
                      : styles.orderLater,
                ]}>
                <Text style={styles.orderText}>{index + 1}</Text>
              </View>
              <View style={styles.stepCopy}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepWhy}>{step.why}</Text>
                <Text style={styles.stepAction}>{step.action}</Text>
                {step.blocks.length > 0 ? (
                  <Text style={styles.blocks}>
                    AFFECTS · {step.blocks.join(' · ')}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}

      {triage.steps.length > visibleSteps.length ? (
        <Text style={styles.moreText}>
          +{triage.steps.length - visibleSteps.length} lower-priority check{triage.steps.length - visibleSteps.length === 1 ? '' : 's'} remain.
        </Text>
      ) : null}
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
  eyebrow: {color: colors.warning, fontSize: 8, fontWeight: '900', letterSpacing: 1},
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
  readyText: {color: colors.success, fontSize: 9, fontWeight: '800', lineHeight: 13, marginTop: 10},
  steps: {gap: 10, marginTop: 11},
  step: {flexDirection: 'row', gap: 9},
  orderBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderFirst: {backgroundColor: colors.danger},
  orderNext: {backgroundColor: colors.warning},
  orderLater: {backgroundColor: colors.surfaceSoft},
  orderText: {color: colors.background, fontSize: 9, fontWeight: '900'},
  stepCopy: {flex: 1, minWidth: 0},
  stepTitle: {color: colors.textPrimary, fontSize: 10, fontWeight: '900'},
  stepWhy: {color: colors.textSecondary, fontSize: 8, lineHeight: 12, marginTop: 2},
  stepAction: {color: colors.accent, fontSize: 8, lineHeight: 12, fontWeight: '800', marginTop: 3},
  blocks: {color: colors.textMuted, fontSize: 7, lineHeight: 10, marginTop: 3},
  moreText: {color: colors.textMuted, fontSize: 8, marginTop: 10},
});
