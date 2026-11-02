import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {
  FieldTestMarker,
  useFieldEventTrace,
} from '../state/FieldEventTraceContext';
import {colors} from '../theme/colors';

const markers: Array<{marker: FieldTestMarker; label: string}> = [
  {marker: 'test-start', label: 'TEST START'},
  {marker: 'airplane-mode-on', label: 'AIRPLANE ON'},
  {marker: 'airplane-mode-off', label: 'AIRPLANE OFF'},
  {marker: 'radio-handoff', label: 'RADIO HANDOFF'},
  {marker: 'node-power-cycle', label: 'NODE POWER CYCLE'},
  {marker: 'test-end', label: 'TEST END'},
];

export function FieldTestMarkersCard(): React.JSX.Element {
  const {addTestMarker} = useFieldEventTrace();

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>FIELD TEST MARKERS</Text>
      <Text style={styles.title}>Mark what you deliberately changed</Text>
      <Text style={styles.body}>
        These buttons only add standardized timestamps to the diagnostic trace. They do not change airplane mode, radio ownership or node power themselves.
      </Text>
      <View style={styles.buttons}>
        {markers.map(item => (
          <TouchableOpacity
            key={item.marker}
            style={styles.button}
            onPress={() => addTestMarker(item.marker)}>
            <Text style={styles.buttonText}>{item.label}</Text>
          </TouchableOpacity>
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
  buttons: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10},
  button: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  buttonText: {color: colors.textSecondary, fontSize: 8, fontWeight: '900'},
});
