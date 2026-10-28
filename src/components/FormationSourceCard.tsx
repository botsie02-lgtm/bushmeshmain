import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {useConvoyFormation} from '../state/ConvoyFormationContext';
import {colors} from '../theme/colors';

function formatWhen(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString();
}

export function FormationSourceCard(): React.JSX.Element {
  const {formationSource, configured} = useConvoyFormation();

  let label = 'LOCAL FORMATION';
  let detail = 'This order was created or edited on this device.';
  let meta = '';
  let accent = colors.accent;

  if (!configured) {
    label = 'NO ACTIVE FORMATION';
    detail = 'Create or accept a formation before source provenance applies.';
    accent = colors.textMuted;
  } else if (formationSource.kind === 'accepted-remote') {
    label = 'ACCEPTED REMOTE FORMATION';
    detail =
      'This order was explicitly accepted after review. The sender reference is provenance, not signed authority.';
    meta = `sender ${formationSource.senderId.slice(-6)} · revision ${formationSource.revision} · accepted ${formatWhen(
      formationSource.acceptedAtMs,
    )}`;
    accent = colors.warning;
  } else if (formationSource.kind === 'legacy-unknown') {
    label = 'LEGACY SOURCE UNKNOWN';
    detail =
      'This formation was restored from an older Bushmesh snapshot that did not record whether the order was local or received.';
    meta = `migrated ${formatWhen(formationSource.migratedAtMs)}`;
    accent = colors.warning;
  } else {
    meta = `last local edit ${formatWhen(formationSource.updatedAtMs)}`;
  }

  return (
    <View style={styles.card}>
      <Text style={[styles.label, {color: accent}]}>{label}</Text>
      <Text style={styles.detail}>{detail}</Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 11,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
  },
  label: {fontSize: 8, fontWeight: '900', letterSpacing: 1},
  detail: {color: colors.textSecondary, fontSize: 9, lineHeight: 13, marginTop: 4},
  meta: {color: colors.textMuted, fontSize: 8, lineHeight: 11, marginTop: 4},
});
