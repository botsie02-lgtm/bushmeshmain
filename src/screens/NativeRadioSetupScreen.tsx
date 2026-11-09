import React, {useEffect, useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Device} from 'react-native-ble-plx';

import {RadioSettingsPanel} from '../components/RadioSettingsPanel';
import {
  NativeMeshCoreOwnershipSnapshot,
  nativeMeshCoreSessionCoordinator,
} from '../meshcore/NativeMeshCoreSessionCoordinator';
import {nativeRadioService, NativeRadioServiceStatus} from '../native/NativeRadioService';
import {useRadioConnection} from '../state/RadioConnectionContext';
import {colors} from '../theme/colors';

const initialOwnership: NativeMeshCoreOwnershipSnapshot =
  nativeMeshCoreSessionCoordinator.getSnapshot();

function deviceLabel(device: Device): string {
  return device.name ?? device.localName ?? 'Unnamed BLE device';
}

/**
 * Background-radio setup intentionally uses the application-lifetime scanner
 * owned by AppRadioConnectionService. This screen never creates a BleManager or
 * a JavaScript GATT connection. Selecting a discovered address first stops the
 * shared scan, then hands that address directly to the Android-native runtime.
 */
export function NativeRadioSetupScreen(): React.JSX.Element {
  const {
    snapshot,
    nativeHandoffSupported,
    startScan,
    stopScan,
    handoffDiscoveredDeviceToAndroid,
    disconnect,
    recoverNativeCommandSession,
  } = useRadioConnection();
  const [ownership, setOwnership] =
    useState<NativeMeshCoreOwnershipSnapshot>(initialOwnership);
  const [setupStatus, setSetupStatus] = useState(
    'Scan for a MeshCore companion node, then let Android own the radio connection.',
  );
  const [setupError, setSetupError] = useState<string | null>(null);
  const [androidStatus, setAndroidStatus] = useState<NativeRadioServiceStatus | null>(null);
  const [stopping, setStopping] = useState(false);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    return nativeMeshCoreSessionCoordinator.subscribe(() => {
      setOwnership(nativeMeshCoreSessionCoordinator.getSnapshot());
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    const readNativeOwnership = async () => {
      try {
        const status = await nativeRadioService.getStatus();
        if (mounted) setAndroidStatus(status);
      } catch {
        // A status read failure must not erase the last known Android owner.
      }
    };
    readNativeOwnership().catch(() => undefined);
    const timer = setInterval(() => {
      readNativeOwnership().catch(() => undefined);
    }, 1_500);
    return () => {mounted = false; clearInterval(timer);};
  }, []);

  const nativeBusy = ownership.state === 'stopping' || stopping || recovering;
  const takingOver = ownership.state === 'taking-over' || snapshot.status === 'Connecting';
  const nativeActive =
    ownership.state === 'active' ||
    Boolean(ownership.deviceAddress && ownership.state !== 'idle') ||
    snapshot.connectionOwner === 'android-native' ||
    androidStatus?.ownership === 'native-service' ||
    androidStatus?.persistedNativeTargetPresent === true ||
    Boolean(androidStatus?.nativeBleDeviceAddress);
  const commandSessionReady = nativeActive &&
    ownership.state === 'active' &&
    snapshot.connectionOwner === 'android-native' &&
    snapshot.status === 'Connected';
  const isScanning = snapshot.status === 'Scanning';

  const sortedDevices = useMemo(
    () =>
      [...snapshot.devices].sort((a, b) => {
        const aNamed = deviceLabel(a) === 'Unnamed BLE device' ? 1 : 0;
        const bNamed = deviceLabel(b) === 'Unnamed BLE device' ? 1 : 0;
        if (aNamed !== bNamed) {
          return aNamed - bNamed;
        }
        return deviceLabel(a).localeCompare(deviceLabel(b));
      }),
    [snapshot.devices],
  );

  const scan = async () => {
    if (!nativeHandoffSupported || nativeBusy || nativeActive || takingOver) {
      return;
    }

    setSetupError(null);
    setSetupStatus('Scanning for nearby Bluetooth devices…');
    try {
      await startScan();
    } catch (error) {
      setSetupError(
        error instanceof Error ? error.message : 'Bluetooth scan could not start.',
      );
    }
  };

  const startNativeRadio = async (device: Device) => {
    if (nativeBusy || nativeActive || takingOver) {
      return;
    }

    // Stop is synchronous from the JS scanner's perspective: it invalidates
    // callbacks/timers before Android is asked to open its GATT connection.
    stopScan();
    setSetupError(null);
    setSetupStatus(`Handing ${deviceLabel(device)} to the Android radio service…`);

    try {
      await handoffDiscoveredDeviceToAndroid(device);
    } catch (error) {
      setSetupError(
        error instanceof Error
          ? error.message
          : 'Android background radio setup failed.',
      );
    }
  };

  const stopNativeRadio = async () => {
    if (nativeBusy) return;
    setStopping(true);
    setSetupError(null);
    setSetupStatus('Stopping Android-owned MeshCore session…');
    try {
      await disconnect();
      setSetupStatus('Background radio stopped. You can scan for another node.');
    } catch (error) {
      setSetupError(
        error instanceof Error
          ? error.message
          : 'Background radio could not be stopped cleanly.',
      );
    } finally {
      setStopping(false);
      setAndroidStatus(await nativeRadioService.getStatus().catch(() => null));
    }
  };

  const recoverNativeSession = async () => {
    if (nativeBusy || !nativeActive) return;
    setRecovering(true);
    setSetupError(null);
    try {
      const recovered = await recoverNativeCommandSession();
      setSetupStatus(recovered
        ? 'Native command session recovered. Radio sending may resume.'
        : 'Android ownership is unavailable; use Stop before reconnecting.');
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Native command session recovery failed.');
    } finally {
      setRecovering(false);
    }
  };

  const displayedError =
    ownership.errorMessage ??
    setupError ??
    (snapshot.status === 'Error' ? snapshot.statusDetail : null);
  const displayedStatus = ownership.statusMessage ?? snapshot.statusDetail ?? setupStatus;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>ANDROID RADIO OWNERSHIP</Text>
        <Text style={styles.title}>Background MeshCore radio</Text>
        <Text style={styles.body}>
          This mode lets Android own the Heltec BLE connection instead of the
          React Native screen. It is the foundation for radio reconnect,
          store-and-forward and inbound Bushmesh capture while the app UI is not
          running.
        </Text>
      </View>

      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Ownership</Text>
          <Text style={nativeActive ? styles.ready : styles.value}>
            {nativeActive && ownership.state === 'idle'
              ? 'ANDROID OWNS RADIO / APP STATE STALE'
              : ownership.state.toUpperCase()}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Radio</Text>
          <Text style={styles.value}>
            {ownership.deviceLabel ??
              ownership.deviceAddress ??
              snapshot.connectedDeviceLabel ??
              androidStatus?.nativeBleDeviceLabel ??
              androidStatus?.nativeBleDeviceAddress ??
              'None'}
          </Text>
        </View>
        <Text style={styles.statusText}>{displayedStatus}</Text>
        {displayedError ? (
          <Text style={styles.errorText}>{displayedError}</Text>
        ) : null}
      </View>

      {commandSessionReady ? <RadioSettingsPanel /> : null}
      {nativeActive && !commandSessionReady ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>Native command session needs recovery</Text>
          <Text style={styles.body}>
            Android may still own BLE and receive messages. Sending requires a verified
            command session; native BLE readiness alone is not sufficient.
          </Text>
          <TouchableOpacity style={[styles.button, styles.primaryButton]}
            accessibilityLabel="Recover native command session"
            onPress={recoverNativeSession} disabled={nativeBusy}>
            <Text style={styles.primaryButtonText}>Recover command session</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {nativeActive ? (
        <TouchableOpacity
          style={[styles.button, styles.stopButton]}
          onPress={stopNativeRadio}
          disabled={nativeBusy}>
          <Text style={styles.stopButtonText}>Stop background radio</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={scan}
          disabled={!nativeHandoffSupported || nativeBusy || takingOver || isScanning}>
          <Text style={styles.primaryButtonText}>
            {isScanning ? 'Scanning…' : 'Scan for MeshCore radio'}
          </Text>
        </TouchableOpacity>
      )}

      {!nativeHandoffSupported ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>Android native runtime unavailable</Text>
          <Text style={styles.body}>
            Background BLE ownership is currently Android-only. BLE diagnostics
            remain available in the other Device mode.
          </Text>
        </View>
      ) : null}

      {!nativeActive && sortedDevices.length > 0 ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Nearby devices</Text>
          <Text style={styles.sectionHint}>
            Choose your MeshCore companion node. Android will connect directly;
            the application scanner does not open a competing BLE-PLX GATT
            connection.
          </Text>
          {sortedDevices.map(device => (
            <TouchableOpacity
              key={device.id}
              style={styles.deviceRow}
              onPress={() => {
                startNativeRadio(device).catch(() => undefined);
              }}
              disabled={nativeBusy}>
              <View style={styles.deviceCopy}>
                <Text style={styles.deviceName}>{deviceLabel(device)}</Text>
                <Text style={styles.deviceId}>{device.id}</Text>
              </View>
              <Text style={styles.connectText}>USE</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={styles.noticeCard}>
        <Text style={styles.noticeTitle}>Current validation state</Text>
        <Text style={styles.body}>
          Android-native ownership uses the same application-lifetime discovery
          service as BLE diagnostics. Radio acceptance still means MeshCore
          accepted a packet for transmission; it does not prove peer delivery.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 36, gap: 12},
  heroCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 18,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 25,
    fontWeight: '900',
    marginTop: 5,
  },
  body: {color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 8},
  statusCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {color: colors.textMuted, fontSize: 11, fontWeight: '800'},
  value: {color: colors.textPrimary, fontSize: 12, fontWeight: '900'},
  ready: {color: colors.success, fontSize: 12, fontWeight: '900'},
  statusText: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4},
  errorText: {color: colors.danger, fontSize: 12, lineHeight: 18, marginTop: 8},
  button: {borderRadius: 16, paddingVertical: 14, alignItems: 'center'},
  primaryButton: {backgroundColor: colors.accent},
  primaryButtonText: {color: colors.background, fontWeight: '900'},
  stopButton: {backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger},
  stopButtonText: {color: colors.danger, fontWeight: '900'},
  warningCard: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 18,
    padding: 16,
  },
  warningTitle: {color: colors.warning, fontSize: 14, fontWeight: '900'},
  sectionCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 14,
  },
  sectionTitle: {color: colors.textPrimary, fontSize: 16, fontWeight: '900'},
  sectionHint: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 8},
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  deviceCopy: {flex: 1, marginRight: 12},
  deviceName: {color: colors.textPrimary, fontSize: 14, fontWeight: '800'},
  deviceId: {color: colors.textMuted, fontSize: 10, marginTop: 3},
  connectText: {color: colors.accent, fontSize: 11, fontWeight: '900'},
  noticeCard: {backgroundColor: colors.surfaceSoft, borderRadius: 18, padding: 16},
  noticeTitle: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
});