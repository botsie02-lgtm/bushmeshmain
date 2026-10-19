import React from 'react';
import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {BushMeshPeerSummary} from '../state/BushMeshContext';
import {colors} from '../theme/colors';

export type BushMeshPeerTargetSelectorProps = {
  peers: BushMeshPeerSummary[];
  selectedNodeId: number | null;
  onSelect: (nodeId: number | null) => void;
};

function nodeLabel(nodeId: number): string {
  return nodeId.toString(16).padStart(8, '0').toUpperCase();
}

export function BushMeshPeerTargetSelector({
  peers,
  selectedNodeId,
  onSelect,
}: BushMeshPeerTargetSelectorProps): React.JSX.Element {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Routed destination</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}>
        <TouchableOpacity
          style={[
            styles.target,
            selectedNodeId === null && styles.targetActive,
          ]}
          onPress={() => onSelect(null)}>
          <Text
            style={[
              styles.targetTitle,
              selectedNodeId === null && styles.targetTitleActive,
            ]}>
            Broadcast
          </Text>
          <Text style={styles.targetDetail}>All compatible nodes</Text>
        </TouchableOpacity>

        {peers.map(peer => {
          const active = selectedNodeId === peer.nodeId;
          return (
            <TouchableOpacity
              key={peer.nodeId}
              style={[styles.target, active && styles.targetActive]}
              onPress={() => onSelect(peer.nodeId)}>
              <Text
                style={[
                  styles.targetTitle,
                  active && styles.targetTitleActive,
                ]}>
                {nodeLabel(peer.nodeId)}
              </Text>
              <Text style={styles.targetDetail}>
                {peer.batteryPercent === undefined
                  ? 'Battery ?'
                  : `Battery ${peer.batteryPercent}%`}
              </Text>
              <Text style={styles.targetDetail}>
                Seen {new Date(peer.lastSeenAt).toLocaleTimeString()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  row: {
    gap: 8,
    paddingRight: 6,
  },
  target: {
    minWidth: 128,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.background,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  targetActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceSoft,
  },
  targetTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '900',
  },
  targetTitleActive: {
    color: colors.accent,
  },
  targetDetail: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 3,
  },
});
