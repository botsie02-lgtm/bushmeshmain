import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {
  FieldScenarioResult,
  evaluateFieldScenarios,
} from '../diagnostics/fieldScenarios';
import {useFieldEventTrace} from '../state/FieldEventTraceContext';
import {colors} from '../theme/colors';

function stateLabel(state: FieldScenarioResult['state']): string {
  switch (state) {
    case 'not-started':
      return 'NOT STARTED';
    case 'in-progress':
      return 'IN PROGRESS';
    case 'evidence-complete':
      return 'EVIDENCE COMPLETE';
    case 'incomplete':
      return 'INCOMPLETE';
  }
}

export function FieldScenarioCard(): React.JSX.Element {
  const {events} = useFieldEventTrace();
  const scenarios = useMemo(() => evaluateFieldScenarios(events), [events]);

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>FIELD DRILLS</Text>
      <Text style={styles.title}>Repeatable evidence windows</Text>
      <Text style={styles.body}>
        These checks only confirm that expected trace evidence was observed. They do not declare the hardware or feature passed.
      </Text>

      <View style={styles.items}>
        {scenarios.map(scenario => (
          <View key={scenario.id} style={styles.item}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemTitle}>{scenario.title}</Text>
              <Text
                style={[
                  styles.state,
                  scenario.state === 'evidence-complete'
                    ? styles.stateComplete
                    : scenario.state === 'in-progress'
                      ? styles.stateProgress
                      : scenario.state === 'incomplete'
                        ? styles.stateIncomplete
                        : styles.stateIdle,
                ]}>
                {stateLabel(scenario.state)}
              </Text>
            </View>
            <Text style={styles.detail}>{scenario.detail}</Text>
            {scenario.missingEvidence.length > 0 ? (
              <Text style={styles.missing}>
                MISSING · {scenario.missingEvidence.join(' · ')}
              </Text>
            ) : null}
            {scenario.evidenceCodes.length > 0 ? (
              <Text style={styles.evidence}>
                EVIDENCE · {scenario.evidenceCodes.join(' · ')}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
  },
  eyebrow: {color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1},
  title: {color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 2},
  body: {color: colors.textSecondary, fontSize: 8, lineHeight: 12, marginTop: 6},
  items: {gap: 9, marginTop: 11},
  item: {borderRadius: 13, backgroundColor: colors.surfaceSoft, padding: 10},
  itemHeader: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8},
  itemTitle: {flex: 1, color: colors.textPrimary, fontSize: 9, fontWeight: '900'},
  state: {fontSize: 7, fontWeight: '900'},
  stateComplete: {color: colors.success},
  stateProgress: {color: colors.accent},
  stateIncomplete: {color: colors.danger},
  stateIdle: {color: colors.textMuted},
  detail: {color: colors.textSecondary, fontSize: 8, lineHeight: 12, marginTop: 4},
  missing: {color: colors.warning, fontSize: 7, fontWeight: '800', lineHeight: 10, marginTop: 4},
  evidence: {color: colors.textMuted, fontSize: 7, lineHeight: 10, marginTop: 3},
});
