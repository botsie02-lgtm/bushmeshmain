import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {colors} from '../../theme/colors';
import type {FieldPulseItem, FieldPulseKind} from './fieldPulseModel';

export type FieldPulseStripProps = {
  items: readonly FieldPulseItem[];
  onOpen: (section: FieldPulseKind) => void;
  compact?: boolean;
};

const SYMBOLS: Record<FieldPulseKind, string> = {
  radio: '≋',
  gps: '⌖',
  maps: '▧',
  convoy: '◈',
};

const STATE_LABELS = {
  ready: 'AVAILABLE',
  attention: 'CHECK',
  unavailable: 'UNAVAILABLE',
};

function accentFor(state: FieldPulseItem['state']): string {
  return state === 'ready' ? colors.success
    : state === 'attention' ? colors.warning : colors.textSecondary;
}

/** Four single-tap, read-only links, no accidental radio/GPS side effects. */
export function FieldPulseStrip({
  items, onOpen, compact = false,
}: FieldPulseStripProps): React.JSX.Element {
  return (
    <View style={styles.container} accessibilityLabel="BushMesh field status">
      <View style={styles.headingRow}>
        <Text style={styles.heading}>FIELD STATUS</Text>
        <Text style={styles.hint}>Tap for details · check while stopped</Text>
      </View>
      <View style={styles.row}>
        {items.map(item => (
          <TouchableOpacity
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={
              'Open ' + item.label + ': ' + item.headline + '. ' + item.detail
            }
            accessibilityHint="Opens the existing detail screen; no data is transmitted."
            onPress={() => onOpen(item.key)}
            activeOpacity={0.8}
            style={[styles.tile, compact && styles.compactTile]}>
            <View style={styles.tileHeader}>
              <Text style={styles.symbol} accessible={false}>
                {SYMBOLS[item.key]}
              </Text>
              <Text style={[styles.state, {color: accentFor(item.state)}]}>
                {STATE_LABELS[item.state]}
              </Text>
            </View>
            <Text style={styles.name}>{item.label}</Text>
            <Text style={styles.headline} numberOfLines={2}>{item.headline}</Text>
            {!compact ? (
              <Text style={styles.detail}>{item.detail}</Text>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 13,
    gap: 10,
    backgroundColor: colors.background,
  },
  headingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  heading: {
    color: colors.textPrimary, fontSize: 13, fontWeight: '900',
    letterSpacing: 1.2,
  },
  hint: {color: colors.textSecondary, fontSize: 12},
  row: {flexDirection: 'row', gap: 8},
  tile: {
    flex: 1, minWidth: 0, minHeight: 124,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 10, gap: 3,
  },
  compactTile: {minHeight: 94},
  tileHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', gap: 3,
  },
  symbol: {color: colors.accent, fontSize: 18, fontWeight: '800'},
  state: {fontSize: 8, fontWeight: '900', flexShrink: 1},
  name: {color: colors.textSecondary, fontSize: 11, fontWeight: '800'},
  headline: {color: colors.textPrimary, fontSize: 13, fontWeight: '900'},
  detail: {color: colors.textSecondary, fontSize: 11, lineHeight: 15},
});
