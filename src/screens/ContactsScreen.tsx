import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {colors} from '../theme/colors';

export function ContactsScreen(): React.JSX.Element {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Contacts</Text>
      <Text style={styles.body}>
        MeshCore contacts, direct messages, and known nodes will appear here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 20,
    backgroundColor: colors.background,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
});