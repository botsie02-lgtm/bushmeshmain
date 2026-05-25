import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {colors} from '../theme/colors';

export function MapScreen(): React.JSX.Element {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Map</Text>
      <Text style={styles.body}>
        Offline maps, convoy positions, heard nodes, and trail markers will come
        later.
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