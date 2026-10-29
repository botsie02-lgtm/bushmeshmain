import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {FieldSupportSnapshot} from '../components/FieldSupportSnapshot';
import {
  NativeMeshCoreOwnershipSnapshot,
  nativeMeshCoreSessionCoordinator,
} from '../meshcore/NativeMeshCoreSessionCoordinator';
import {FieldEventTraceProvider} from '../state/FieldEventTraceContext';
import {colors} from '../theme/colors';
import {DeviceScreen} from './DeviceScreen';
import {FieldDiagnosticsScreen} from './FieldDiagnosticsScreen';
import {NativeRadioSetupScreen} from './NativeRadioSetupScreen';

type DeviceMode = 'background' | 'legacy' | 'report';

export function DeviceHubScreen(): React.JSX.Element {
  const [mode, setMode] = useState<DeviceMode>('background');
  const [ownership, setOwnership] = useState<NativeMeshCoreOwnershipSnapshot>(
    nativeMeshCoreSessionCoordinator.getSnapshot(),
  );

  useEffect(() => {
    return nativeMeshCoreSessionCoordinator.subscribe(() => {
      setOwnership(nativeMeshCoreSessionCoordinator.getSnapshot());
    });
  }, []);

  const nativeOwnsRadio =
    ownership.state === 'active' ||
    ownership.state === 'taking-over' ||
    ownership.state === 'stopping';

  const selectLegacy = () => {
    if (nativeOwnsRadio) {
      return;
    }
    setMode('legacy');
  };

  return (
    <FieldEventTraceProvider>
      <View style={styles.screen}>
        <View style={styles.modeBar}>
          <TouchableOpacity
            style={[
              styles.modeButton,
              mode === 'background' && styles.modeButtonActive,
            ]}
            onPress={() => setMode('background')}>
            <Text
              style={[
                styles.modeText,
                mode === 'background' && styles.modeTextActive,
              ]}>
              Background Radio
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.modeButton,
              mode === 'report' && styles.modeButtonActive,
            ]}
            onPress={() => setMode('report')}>
            <Text
              style={[
                styles.modeText,
                mode === 'report' && styles.modeTextActive,
              ]}>
              Field Report
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.modeButton,
              mode === 'legacy' && styles.modeButtonActive,
              nativeOwnsRadio && styles.modeButtonDisabled,
            ]}
            onPress={selectLegacy}
            disabled={nativeOwnsRadio}>
            <Text
              style={[
                styles.modeText,
                mode === 'legacy' && styles.modeTextActive,
                nativeOwnsRadio && styles.modeTextDisabled,
              ]}>
              BLE Diagnostics
            </Text>
          </TouchableOpacity>
        </View>

        {nativeOwnsRadio && mode === 'background' ? (
          <View style={styles.ownershipNotice}>
            <Text style={styles.ownershipText}>
              Android radio ownership is {ownership.state}. Stop background radio
              before opening legacy BLE diagnostics.
            </Text>
          </View>
        ) : null}

        <View style={styles.content}>
          {mode === 'background' ? (
            <NativeRadioSetupScreen />
          ) : mode === 'report' ? (
            <View style={styles.reportMode}>
              <FieldSupportSnapshot />
              <View style={styles.reportDetails}>
                <FieldDiagnosticsScreen />
              </View>
            </View>
          ) : (
            <DeviceScreen />
          )}
        </View>
      </View>
    </FieldEventTraceProvider>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  modeBar: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: colors.background,
  },
  modeButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 4,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  modeButtonActive: {borderColor: colors.accent},
  modeButtonDisabled: {opacity: 0.45},
  modeText: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
  },
  modeTextActive: {color: colors.accent},
  modeTextDisabled: {color: colors.textMuted},
  ownershipNotice: {
    marginHorizontal: 12,
    marginBottom: 6,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 12,
    padding: 10,
  },
  ownershipText: {color: colors.textSecondary, fontSize: 11, lineHeight: 16},
  content: {flex: 1},
  reportMode: {flex: 1},
  reportDetails: {flex: 1},
});
