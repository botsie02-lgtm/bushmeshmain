import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {BleManager, Device} from 'react-native-ble-plx';

import {requestBlePermissions} from '../ble/blePermissions';
import {
  NativeMeshCoreOwnershipSnapshot,
  nativeMeshCoreSessionCoordinator,
} from '../meshcore/NativeMeshCoreSessionCoordinator';
import {NativeMeshCoreResponse} from '../meshcore/NativeMeshCoreSession';
import {nativeRadioService} from '../native/NativeRadioService';
import {
  BushMeshChannel,
  BushMeshContact,
  useBushMesh,
} from '../state/BushMeshContext';
import {colors} from '../theme/colors';

const initialOwnership: NativeMeshCoreOwnershipSnapshot =
  nativeMeshCoreSessionCoordinator.getSnapshot();

function lineValue(lines: string[] | undefined, prefix: string): string | null {
  const line = lines?.find(candidate => candidate.startsWith(prefix));
  if (!line) {
    return null;
  }
  const value = line.slice(prefix.length).trim();
  return value.length > 0 ? value : null;
}

function channelFromResponse(response: NativeMeshCoreResponse): BushMeshChannel | null {
  const lines = response.parsed?.lines;
  const channelIndex = lineValue(lines, 'Channel Index:');
  const channelName = lineValue(lines, 'Channel Name:');
  const secret = lineValue(lines, 'Secret:');

  if (channelIndex === null || channelName === null) {
    return null;
  }

  return {
    channelIndex,
    channelName,
    secret: secret ?? 'Unknown',
  };
}

function contactFromParsed(contact: {
  publicKey: string;
  publicKeyPrefix: string;
  type: number;
  flags: number;
  outPathLength: number;
  name: string;
  lastAdvert: number | null;
  latitude: number | null;
  longitude: number | null;
  lastModified: number | null;
}): BushMeshContact {
  return {...contact};
}

function deviceLabel(device: Device): string {
  return device.name ?? device.localName ?? 'Unnamed BLE device';
}

export function NativeRadioSetupScreen(): React.JSX.Element {
  const managerRef = useRef<BleManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = new BleManager();
  }

  const {
    channels,
    setConnectionStatus,
    setConnectedDeviceName,
    setChannels,
    setSendChannelMessageHandler,
    setSyncContactsHandler,
    setDeviceStatus,
    setContacts,
    addLocalChannelMessage,
  } = useBushMesh();

  const channelsRef = useRef(channels);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  const [ownership, setOwnership] =
    useState<NativeMeshCoreOwnershipSnapshot>(initialOwnership);
  const [devices, setDevices] = useState<Device[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [setupStatus, setSetupStatus] = useState(
    'Scan for a MeshCore companion node, then let Android own the radio connection.',
  );
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    return nativeMeshCoreSessionCoordinator.subscribe(() => {
      setOwnership(nativeMeshCoreSessionCoordinator.getSnapshot());
    });
  }, []);

  useEffect(() => {
    return () => {
      managerRef.current?.stopDeviceScan();
      managerRef.current?.destroy();
      managerRef.current = null;
    };
  }, []);

  const nativeSupported = nativeRadioService.isSupported();
  const nativeBusy =
    ownership.state === 'taking-over' || ownership.state === 'stopping' || isStarting;
  const nativeActive = ownership.state === 'active';

  const sortedDevices = useMemo(
    () =>
      [...devices].sort((a, b) => {
        const aNamed = deviceLabel(a) === 'Unnamed BLE device' ? 1 : 0;
        const bNamed = deviceLabel(b) === 'Unnamed BLE device' ? 1 : 0;
        if (aNamed !== bNamed) {
          return aNamed - bNamed;
        }
        return deviceLabel(a).localeCompare(deviceLabel(b));
      }),
    [devices],
  );

  const stopScan = () => {
    managerRef.current?.stopDeviceScan();
    setIsScanning(false);
  };

  const scan = async () => {
    if (!nativeSupported || nativeBusy || nativeActive) {
      return;
    }

    setSetupError(null);
    const granted = await requestBlePermissions();
    if (!granted) {
      setSetupError('Bluetooth scan/connect permissions are required.');
      return;
    }

    const manager = managerRef.current;
    if (!manager) {
      setSetupError('Bluetooth manager is unavailable.');
      return;
    }

    setDevices([]);
    setIsScanning(true);
    setSetupStatus('Scanning for nearby Bluetooth devices…');

    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        stopScan();
        setSetupError(error.message);
        return;
      }
      if (!device) {
        return;
      }

      setDevices(current => {
        const existing = current.find(item => item.id === device.id);
        return existing
          ? current.map(item => (item.id === device.id ? device : item))
          : [...current, device];
      });
    });

    setTimeout(() => {
      manager.stopDeviceScan();
      setIsScanning(false);
    }, 12_000);
  };

  const handleNativeFrame = (response: NativeMeshCoreResponse) => {
    if (response.parsed?.batteryInfo) {
      setDeviceStatus(response.parsed.batteryInfo);
    }

    const incoming = response.parsed?.channelMessage;
    if (incoming) {
      const channel = channelsRef.current.find(
        item => item.channelIndex === incoming.channelIndex,
      );
      addLocalChannelMessage({
        channelIndex: incoming.channelIndex,
        channelName: channel?.channelName ?? `Channel ${incoming.channelIndex}`,
        text: incoming.text,
        direction: 'received',
        status: 'confirmed',
      });
    }
  };

  const startNativeRadio = async (device: Device) => {
    if (nativeBusy || nativeActive) {
      return;
    }

    stopScan();
    setIsStarting(true);
    setSetupError(null);
    setSetupStatus(`Handing ${deviceLabel(device)} to the Android radio service…`);

    try {
      const session = await nativeMeshCoreSessionCoordinator.start(
        device.id,
        deviceLabel(device),
        {
          onStatus: message => setSetupStatus(message),
          onError: message => setSetupError(message),
          onFrame: handleNativeFrame,
        },
      );

      const battery = await session.getBatteryStatus();
      if (battery.parsed?.batteryInfo) {
        setDeviceStatus(battery.parsed.batteryInfo);
      }

      const channelResponses = await session.probeChannels();
      const loadedChannels = channelResponses
        .map(channelFromResponse)
        .filter((channel): channel is BushMeshChannel => channel !== null);
      setChannels(loadedChannels);

      const loadedContacts = (await session.syncContacts()).map(contactFromParsed);
      setContacts(loadedContacts);

      setSendChannelMessageHandler(async (channelIndex, message) => {
        await session.sendChannelMessage(channelIndex, message);
      });
      setSyncContactsHandler(async () => {
        const refreshed = (await session.syncContacts()).map(contactFromParsed);
        setContacts(refreshed);
        return refreshed;
      });

      const queued = await session.syncQueuedMessages(20);
      queued.forEach(handleNativeFrame);

      setConnectedDeviceName(deviceLabel(device));
      setConnectionStatus('Connected');
      setSetupStatus(
        'Android owns the MeshCore link. The foreground service can reconnect and recover queued Bushmesh traffic after a JS process restart.',
      );
    } catch (error) {
      setConnectionStatus('Disconnected');
      setSendChannelMessageHandler(null);
      setSyncContactsHandler(null);
      setSetupError(
        error instanceof Error
          ? error.message
          : 'Android background radio setup failed.',
      );
    } finally {
      setIsStarting(false);
    }
  };

  const stopNativeRadio = async () => {
    if (nativeBusy) {
      return;
    }

    setSetupError(null);
    setSetupStatus('Stopping Android-owned MeshCore session…');
    try {
      await nativeMeshCoreSessionCoordinator.stop();
      setSendChannelMessageHandler(null);
      setSyncContactsHandler(null);
      setConnectionStatus('Disconnected');
      setConnectedDeviceName(null);
      setDeviceStatus(null);
      setSetupStatus('Background radio stopped. You can scan for another node.');
    } catch (error) {
      setSetupError(
        error instanceof Error
          ? error.message
          : 'Background radio could not be stopped cleanly.',
      );
    }
  };

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
            {ownership.state.toUpperCase()}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Radio</Text>
          <Text style={styles.value}>
            {ownership.deviceLabel ?? ownership.deviceAddress ?? 'None'}
          </Text>
        </View>
        <Text style={styles.statusText}>
          {ownership.statusMessage ?? setupStatus}
        </Text>
        {ownership.errorMessage || setupError ? (
          <Text style={styles.errorText}>{ownership.errorMessage ?? setupError}</Text>
        ) : null}
      </View>

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
          disabled={!nativeSupported || nativeBusy}>
          <Text style={styles.primaryButtonText}>
            {isScanning ? 'Scanning…' : 'Scan for MeshCore radio'}
          </Text>
        </TouchableOpacity>
      )}

      {!nativeSupported ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>Android native runtime unavailable</Text>
          <Text style={styles.body}>
            Background BLE ownership is currently Android-only. Legacy BLE
            diagnostics remain available in the other Device mode.
          </Text>
        </View>
      ) : null}

      {!nativeActive && sortedDevices.length > 0 ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Nearby devices</Text>
          <Text style={styles.sectionHint}>
            Choose your MeshCore companion node. Android will connect directly;
            this scanner does not open a competing BLE-PLX GATT connection.
          </Text>
          {sortedDevices.map(device => (
            <TouchableOpacity
              key={device.id}
              style={styles.deviceRow}
              onPress={() => startNativeRadio(device)}
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
          The ownership path is implemented, but it has not yet been field-tested
          against your Heltec hardware. Radio acceptance still means MeshCore
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
