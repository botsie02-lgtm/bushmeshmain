import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';

import {RadioSettingsPanel} from '../components/RadioSettingsPanel';
import {useRadioConnection} from '../state/RadioConnectionContext';
import {colors} from '../theme/colors';

export function RadioSettingsScreen(): React.JSX.Element {
  const {snapshot} = useRadioConnection();
  const connected =
    snapshot.status === 'Connected' && snapshot.connectionOwner !== 'none';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {connected ? (
        <RadioSettingsPanel />
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.eyebrow}>RADIO SETTINGS</Text>
          <Text style={styles.title}>Connect a MeshCore radio first</Text>
          <Text style={styles.body}>
            Use Device → Background Radio for Android-native ownership, or BLE
            Diagnostics for the legacy JS-GATT path. Radio profile changes reuse
            whichever session already owns the node; this screen never opens a
            second BLE connection.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 36},
  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 18,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 5,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
});
