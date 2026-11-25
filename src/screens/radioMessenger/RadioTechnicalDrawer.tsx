import React, {useEffect, useRef, useState} from 'react';
import {
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import {colors} from '../../theme/colors';
import {meshCoreInboundDiagnostics} from '../../meshcore/meshcoreInboundDiagnostics';
import {nativeOutboundDiagnostics} from '../../meshcore/nativeOutboundDiagnostics';

/** Technical counters are intentionally opt-in and never presented as
 * delivery or membership proof. Snapshot only; no radio commands executed.
 */
export function RadioTechnicalDrawer({
  onClose,
}: {onClose: () => void}): React.JSX.Element {
  const [inbound, setInbound] = useState(() => meshCoreInboundDiagnostics.snapshot());
  const [outbound, setOutbound] = useState(() => nativeOutboundDiagnostics.snapshot());

  useEffect(() => {
    const u1 = meshCoreInboundDiagnostics.subscribe(() =>
      setInbound(meshCoreInboundDiagnostics.snapshot()));
    const u2 = nativeOutboundDiagnostics.subscribe(() =>
      setOutbound(nativeOutboundDiagnostics.snapshot()));
    return () => {u1(); u2();};
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Text style={styles.title}>Radio diagnostics</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close radio diagnostics"
          style={styles.close} onPress={onClose}>
          <Text style={styles.closeText}>Done</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Native outbound</Text>
        <Text style={styles.body}>
          Queued: {outbound.counts['command-queued'] ?? 0}{'\n'}
          Android write queued: {outbound.counts['native-write-queued'] ?? 0}{'\n'}
          GATT callback: {outbound.counts['gatt-write-confirmed'] ?? 0}{'\n'}
          Matched response: {outbound.counts['response-matched'] ?? 0}{'\n'}
          Response timeouts: {outbound.counts['response-timeout'] ?? 0}{'\n'}
          Firmware rejection: {outbound.counts['firmware-rejected'] ?? 0}
        </Text>
        <Text style={styles.heading}>Native inbound</Text>
        <Text style={styles.body}>
          Packet push: {inbound.counts['push-0x83'] ?? 0}{'\n'}
          Channel parsed: {inbound.counts['channel-parsed'] ?? 0}{'\n'}
          Persisted: {inbound.counts.persisted ?? 0}{'\n'}
          History visible: {inbound.counts['history-visible'] ?? 0}{'\n'}
          Storage error: {inbound.counts['persistence-error'] ?? 0}
        </Text>
        <Text style={styles.warning}>
          PACKET_OK confirms companion acceptance only, not peer delivery.
          Radio events and saved history are not proof of authenticated
          convoy membership or verified channel identity.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
  top: {minHeight: 65, paddingHorizontal: 18, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center'},
  title: {fontSize: 20, color: colors.textPrimary, fontWeight: '900'},
  close: {minHeight: 54, minWidth: 60, alignItems: 'center', justifyContent: 'center'},
  closeText: {color: colors.accent, fontSize: 15, fontWeight: '800'},
  content: {padding: 18, gap: 13},
  heading: {color: colors.textPrimary, fontSize: 15, fontWeight: '800'},
  body: {color: colors.textSecondary, fontSize: 14, lineHeight: 24,
    borderRadius: 14, backgroundColor: colors.surface, padding: 14},
  warning: {color: colors.warning, fontSize: 13, lineHeight: 20},
});
