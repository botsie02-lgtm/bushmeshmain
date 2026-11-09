import React, {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';

import {RadioSettingsPanel} from '../components/RadioSettingsPanel';
import {deviceConnectionPhase} from '../device/deviceConnectionHealth';
import {nativeMeshCoreSessionCoordinator} from '../meshcore/NativeMeshCoreSessionCoordinator';
import {useRadioConnection} from '../state/RadioConnectionContext';
import {colors} from '../theme/colors';

export function RadioSettingsScreen(): React.JSX.Element {
  const {snapshot} = useRadioConnection();
  const [nativeState, setNativeState] = useState(
    nativeMeshCoreSessionCoordinator.getSnapshot().state,
  );
  useEffect(() => nativeMeshCoreSessionCoordinator.subscribe(() => {
    setNativeState(nativeMeshCoreSessionCoordinator.getSnapshot().state);
  }), []);
  const phase = deviceConnectionPhase(snapshot, nativeState);
  const connected =
    snapshot.status === 'Connected' && snapshot.connectionOwner !== 'none';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {connected ? (
        <>
          {phase !== 'ready' ? (
            <View style={styles.emptyCard}>
              <Text style={styles.eyebrow}>SESSION {phase.toUpperCase()}</Text>
              <Text style={styles.body}>
                Profile writes are unavailable until the active connection is ready.
                Android Background Radio remains the sole native BLE owner.
              </Text>
            </View>
          ) : null}
          <RadioSettingsPanel />
        </>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.eyebrow}>DEVICE / RADIO SETTINGS</Text>
          <Text style={styles.title}>
            {phase === 'error' ? 'Radio connection needs attention'
              : phase === 'connecting' ? 'Connecting to your LoRa node…'
              : phase === 'busy' ? 'Radio service is busy'
              : 'Connect a MeshCore node first'}
          </Text>
          <Text style={styles.body}>
            Open Device → Background Radio to use Android-native ownership.
            BLE Tools is the legacy diagnostic path and cannot run concurrently
            with Android ownership. Neither this panel nor its lifecycle starts,
            stops, or creates a radio connection.
          </Text>
          <Text style={styles.note}>{snapshot.statusDetail}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 40, gap: 12},
  emptyCard: {backgroundColor: colors.surface, borderWidth: 1,
    borderColor: colors.border, borderRadius: 18, padding: 18},
  eyebrow: {color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.1},
  title: {color: colors.textPrimary, fontSize: 20, fontWeight: '900', marginTop: 5},
  body: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 8},
  note: {color: colors.warning, fontSize: 11, lineHeight: 16, marginTop: 10},
});
