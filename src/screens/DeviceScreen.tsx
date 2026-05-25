import React, {useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {BleManager, Device} from 'react-native-ble-plx';

import {BushMeshChannel, useBushMesh} from '../state/BushMeshContext';
import {requestBlePermissions} from '../ble/blePermissions';
import {
  MeshCoreClient,
  MeshCoreLogItem,
} from '../meshcore/MeshCoreClient';
import {
  MeshCoreBleDiscovery,
  discoverMeshCoreBle,
} from '../meshcore/meshcoreBle';
import {colors} from '../theme/colors';

type ConnectionStatus =
  | 'Disconnected'
  | 'Requesting permissions'
  | 'Scanning'
  | 'Connecting'
  | 'Connected'
  | 'Error';

type UiLogItem = MeshCoreLogItem & {
  id: string;
};

type ChannelProbeResult = BushMeshChannel;

export function DeviceScreen(): React.JSX.Element {
  const manager = useMemo(() => new BleManager(), []);
  const meshCoreClientRef = useRef<MeshCoreClient | null>(null);

  const {
    channels: sharedChannels,
    setChannels: setSharedChannels,
    setConnectionStatus: setSharedConnectionStatus,
    setConnectedDeviceName,
    setSendChannelMessageHandler,
    setDeviceStatus,
    setContacts,
    clearContacts,
    clearChannels,
  } = useBushMesh();

  const [status, setStatus] = useState<ConnectionStatus>('Disconnected');
  const [statusDetail, setStatusDetail] = useState<string>(
    'No MeshCore device connected.',
  );
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [meshCoreBle, setMeshCoreBle] = useState<MeshCoreBleDiscovery | null>(
    null,
  );
  const [txChunks, setTxChunks] = useState<UiLogItem[]>([]);
  const [txFrames, setTxFrames] = useState<UiLogItem[]>([]);
  const [rxLogs, setRxLogs] = useState<UiLogItem[]>([]);
  const [isWriting, setIsWriting] = useState(false);
  const [showDebugLogs, setShowDebugLogs] = useState(false);

  const channelProbeResults = sharedChannels;
  const getBatteryStatus = async () => {
  try {
    setIsWriting(true);

    const result = await meshCoreClientRef.current?.getBatteryStatus();

    if (result?.batteryInfo) {
      setDeviceStatus(result.batteryInfo);
      setStatusDetail(
        `Battery ${result.batteryInfo.batteryVolts.toFixed(2)} V. Storage ${
          result.batteryInfo.storagePercent ?? 0
        }% used.`,
      );
    } else {
      setStatusDetail('Battery response received, but no battery info parsed.');
    }
  } catch (error) {
    setStatus('Error');
    setStatusDetail(
      error instanceof Error ? error.message : 'Failed to get battery status.',
    );
  } finally {
    setIsWriting(false);
  }
};
  const isScanning = status === 'Scanning';
  const isConnecting = status === 'Connecting';

  const namedChannels = sharedChannels.filter(
    channel => channel.channelName && channel.channelName !== 'Empty',
  );

  const canSendCommands =
    connectedDevice !== null &&
    meshCoreBle?.serviceFound === true &&
    meshCoreBle?.rxFound === true &&
    meshCoreBle?.txFound === true &&
    !isWriting;

  const makeLogItem = (log: MeshCoreLogItem): UiLogItem => ({
    ...log,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  });

  const addTxChunk = (log: MeshCoreLogItem) => {
    if (log.label === 'RX_WRITE') {
      setRxLogs(currentLogs => [makeLogItem(log), ...currentLogs.slice(0, 39)]);
      return;
    }

    setTxChunks(currentLogs => [makeLogItem(log), ...currentLogs.slice(0, 39)]);
  };

  const addTxFrame = (log: MeshCoreLogItem) => {
    setTxFrames(currentLogs => [makeLogItem(log), ...currentLogs.slice(0, 39)]);
  };

  const extractChannelProbeResult = (
    log: MeshCoreLogItem,
  ): ChannelProbeResult | null => {
    if (!log.parsedLines?.length) {
      return null;
    }

    const channelIndex =
      log.parsedLines
        .find(line => line.startsWith('Channel Index:'))
        ?.replace('Channel Index:', '')
        .trim() ?? 'Unknown';

    const channelName =
      log.parsedLines
        .find(line => line.startsWith('Channel Name:'))
        ?.replace('Channel Name:', '')
        .trim() ?? 'Unknown';

    const secret =
      log.parsedLines
        .find(line => line.startsWith('Secret:'))
        ?.replace('Secret:', '')
        .trim() ?? 'Unknown';

    return {
      channelIndex,
      channelName,
      secret,
    };
  };

  const upsertDevice = (device: Device) => {
    if (!device.name && !device.localName) {
      return;
    }

    setDevices(currentDevices => {
      const alreadyExists = currentDevices.some(item => item.id === device.id);

      if (alreadyExists) {
        return currentDevices.map(item =>
          item.id === device.id ? device : item,
        );
      }

      return [...currentDevices, device];
    });
  };

  const startScan = async () => {
    setStatus('Requesting permissions');
    setStatusDetail('Checking Bluetooth permissions...');

    const hasPermissions = await requestBlePermissions();

    if (!hasPermissions) {
      setStatus('Error');
      setStatusDetail('Bluetooth permissions were not granted.');
      return;
    }

    setDevices([]);
    setStatus('Scanning');
    setStatusDetail('Scanning for nearby BLE devices...');

    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        setStatus('Error');
        setStatusDetail(error.message);
        manager.stopDeviceScan();
        return;
      }

      if (device) {
        upsertDevice(device);
      }
    });

    setTimeout(() => {
      manager.stopDeviceScan();

      setStatus(currentStatus =>
        currentStatus === 'Scanning' ? 'Disconnected' : currentStatus,
      );

      setStatusDetail(currentDetail =>
        currentDetail === 'Scanning for nearby BLE devices...'
          ? 'Scan finished. Select a device to connect.'
          : currentDetail,
      );
    }, 10000);
  };

  const runStartupSync = async (client: MeshCoreClient) => {
    try {
      setIsWriting(true);
      setSharedChannels([]);

      setStatusDetail('Startup sync: sending App Start...');
      await client.sendAppStart('BushMesh');

      setStatusDetail('Startup sync: querying device info...');
      await client.sendDeviceQuery();

      setStatusDetail('Startup sync: probing channels 0–39...');
      const results = await client.probeChannels(40);

      const parsedResults =
        results
          .map(result => extractChannelProbeResult(result))
          .filter((result): result is ChannelProbeResult => result !== null) ??
        [];

      setSharedChannels(parsedResults);

      const loadedNamedChannels = parsedResults.filter(
        channel => channel.channelName && channel.channelName !== 'Empty',
      );

      setStatusDetail(
        `Startup sync complete. Loaded ${loadedNamedChannels.length} named channel(s) from ${parsedResults.length} slots.`,
      );
    } catch (error) {
      setStatus('Error');
      setStatusDetail(
        error instanceof Error ? error.message : 'Startup sync failed.',
      );
    } finally {
      setIsWriting(false);
    }
  };

  const connectToDevice = async (device: Device) => {
    try {
      manager.stopDeviceScan();
      setStatus('Connecting');
      setStatusDetail(`Connecting to ${device.name ?? device.localName}...`);

      const connected = await manager.connectToDevice(device.id);
      const readyDevice =
        await connected.discoverAllServicesAndCharacteristics();

      const discovery = await discoverMeshCoreBle(readyDevice);
      const deviceName = readyDevice.name ?? readyDevice.localName ?? 'Unknown device';

      setConnectedDevice(readyDevice);
      setMeshCoreBle(discovery);
      setTxChunks([]);
      setTxFrames([]);
      setRxLogs([]);
      clearChannels();
      clearContacts();
      setSharedConnectionStatus('Connected');
      setConnectedDeviceName(deviceName);
      setStatus('Connected');

      if (discovery.serviceFound && discovery.rxFound && discovery.txFound) {
        const client = new MeshCoreClient(manager, readyDevice, {
          onTxChunk: addTxChunk,
          onTxFrame: addTxFrame,
          onStatus: setStatusDetail,
          onError: message => {
            setStatus('Error');
            setStatusDetail(message);
          },
        });

        meshCoreClientRef.current = client;
        client.start();

        setSendChannelMessageHandler(async (channelIndex, message) => {
          await client.sendChannelMessage(channelIndex, message);
        });
        setStatusDetail(`Connected to ${deviceName}. Starting sync...`);

        await runStartupSync(client);
      } else {
        setStatusDetail(
          `Connected to ${deviceName}, but MeshCore UART service was not fully found.`,
        );
      }
    } catch (error) {
      setStatus('Error');
      setStatusDetail(
        error instanceof Error ? error.message : 'Failed to connect.',
      );
    }
  };

  const disconnect = async () => {
    meshCoreClientRef.current?.stop();
    meshCoreClientRef.current = null;
    setSendChannelMessageHandler(null);

    if (connectedDevice) {
      try {
        await manager.cancelDeviceConnection(connectedDevice.id);
      } catch {
        // Ignore disconnect errors for now.
      }
    }

    setConnectedDevice(null);
    setMeshCoreBle(null);
    setTxChunks([]);
    setTxFrames([]);
    setRxLogs([]);
    clearChannels();
    clearContacts();
    setSharedConnectionStatus('Disconnected');
    setConnectedDeviceName(null);
    setStatus('Disconnected');
    setStatusDetail('Device disconnected.');
  };

  const sendAppStart = async () => {
    try {
      setIsWriting(true);
      await meshCoreClientRef.current?.sendAppStart('BushMesh');
    } catch (error) {
      setStatus('Error');
      setStatusDetail(
        error instanceof Error ? error.message : 'Failed to send App Start.',
      );
    } finally {
      setIsWriting(false);
    }
  };
  const syncContacts = async () => {
    try {
      setIsWriting(true);

      const contacts = await meshCoreClientRef.current?.syncContacts();

      setContacts(
        contacts?.map(contact => ({
          publicKey: contact.publicKey,
          publicKeyPrefix: contact.publicKeyPrefix,
          name: contact.name,
          type: contact.type,
          flags: contact.flags,
          outPathLength: contact.outPathLength,
          lastAdvert: contact.lastAdvert,
          latitude: contact.latitude,
          longitude: contact.longitude,
          lastModified: contact.lastModified,
        })) ?? [],
      );

      setStatusDetail(`Contacts sync complete. Loaded ${contacts?.length ?? 0} contact(s).`);
    } catch (error) {
      setStatus('Error');
      setStatusDetail(
        error instanceof Error ? error.message : 'Failed to sync contacts.',
      );
    } finally {
      setIsWriting(false);
    }
  };
  const sendDeviceQuery = async () => {
    try {
      setIsWriting(true);
      await meshCoreClientRef.current?.sendDeviceQuery();
    } catch (error) {
      setStatus('Error');
      setStatusDetail(
        error instanceof Error ? error.message : 'Failed to send Device Query.',
      );
    } finally {
      setIsWriting(false);
    }
  };

  const getChannel0 = async () => {
    try {
      setIsWriting(true);
      const result = await meshCoreClientRef.current?.getChannel(0);
      const parsed = result ? extractChannelProbeResult(result) : null;

      if (parsed) {
        setSharedChannels([parsed]);
      }
    } catch (error) {
      setStatus('Error');
      setStatusDetail(
        error instanceof Error ? error.message : 'Failed to get Channel 0.',
      );
    } finally {
      setIsWriting(false);
    }
  };

  const probeChannels = async () => {
    try {
      setIsWriting(true);
      setSharedChannels([]);

      const results = await meshCoreClientRef.current?.probeChannels(40);

      const parsedResults =
        results
          ?.map(result => extractChannelProbeResult(result))
          .filter((result): result is ChannelProbeResult => result !== null) ??
        [];

      setSharedChannels(parsedResults);
    } catch (error) {
      setStatus('Error');
      setStatusDetail(
        error instanceof Error ? error.message : 'Failed to probe channels.',
      );
    } finally {
      setIsWriting(false);
    }
  };

  const getStatusColor = () => {
    if (status === 'Connected') {
      return colors.success;
    }

    if (status === 'Error') {
      return colors.danger;
    }

    if (status === 'Scanning' || status === 'Connecting') {
      return colors.warning;
    }

    return colors.textSecondary;
  };

  const renderDevice = ({item}: {item: Device}) => {
    const displayName = item.name ?? item.localName ?? 'Unnamed BLE device';

    return (
      <TouchableOpacity
        style={styles.deviceRow}
        onPress={() => connectToDevice(item)}
        disabled={isConnecting || isWriting}>
        <View style={styles.deviceTextWrap}>
          <Text style={styles.deviceName}>{displayName}</Text>
          <Text style={styles.deviceId}>{item.id}</Text>
        </View>

        <Text style={styles.rssi}>
          {typeof item.rssi === 'number' ? `${item.rssi} dBm` : 'RSSI --'}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderLog = (log: UiLogItem) => (
    <View key={log.id} style={styles.txRow}>
      <Text style={styles.txLabel}>{log.label}</Text>

      {log.detail ? <Text style={styles.txDetail}>{log.detail}</Text> : null}

      {log.parsedLines?.length ? (
        <View style={styles.parsedBox}>
          {log.parsedLines.map((line, index) => (
            <Text key={`${log.id}-parsed-${index}`} style={styles.parsedText}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.txText}>{log.value}</Text>
    </View>
  );

  const connectedDeviceName =
    connectedDevice?.name ?? connectedDevice?.localName ?? null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Device</Text>
        <Text style={styles.title}>Companion Node</Text>
        <Text style={styles.body}>
          Connect to your MeshCore companion node. BushMesh will sync device info
          and channels automatically.
        </Text>
      </View>

      <View style={styles.statusCard}>
        <View style={styles.statusTopRow}>
          <View style={styles.statusTextWrap}>
            <Text style={styles.statusLabel}>Connection Status</Text>
            <Text style={[styles.statusValue, {color: getStatusColor()}]}>
              {status}
            </Text>
          </View>

          {isWriting ? (
            <View style={styles.syncPill}>
              <ActivityIndicator color={colors.background} size="small" />
              <Text style={styles.syncPillText}>Syncing</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.statusDetail}>{statusDetail}</Text>

        {connectedDeviceName ? (
          <View style={styles.deviceNameBox}>
            <Text style={styles.deviceNameLabel}>Connected Node</Text>
            <Text style={styles.deviceNameValue}>{connectedDeviceName}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.quickStatsRow}>
        <View style={styles.quickStatCard}>
          <Text style={styles.quickStatNumber}>{sharedChannels.length}</Text>
          <Text style={styles.quickStatLabel}>Slots Loaded</Text>
        </View>

        <View style={styles.quickStatCard}>
          <Text style={styles.quickStatNumber}>{namedChannels.length}</Text>
          <Text style={styles.quickStatLabel}>Named Channels</Text>
        </View>

        <View style={styles.quickStatCard}>
          <Text style={styles.quickStatNumber}>
            {meshCoreBle?.serviceFound ? 'OK' : '--'}
          </Text>
          <Text style={styles.quickStatLabel}>UART</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, isScanning && styles.buttonDisabled]}
          onPress={startScan}
          disabled={isScanning || isConnecting || isWriting}>
          {isScanning ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.buttonText}>Scan for devices</Text>
          )}
        </TouchableOpacity>

        {connectedDevice ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={disconnect}>
            <Text style={styles.secondaryButtonText}>Disconnect</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {connectedDevice ? (
        <View style={styles.syncCard}>
          <Text style={styles.sectionTitleNoMargin}>Startup Sync</Text>
          <Text style={styles.body}>
            Auto-sync runs after connection. Use these buttons only for testing
            or refreshing data.
          </Text>

          <View style={styles.commandButtons}>
            <TouchableOpacity
              style={[
                styles.commandButton,
                !canSendCommands && styles.commandButtonDisabled,
              ]}
              onPress={() => {
                if (meshCoreClientRef.current) {
                  runStartupSync(meshCoreClientRef.current);
                }
              }}
              disabled={!canSendCommands}>
              <Text style={styles.commandButtonText}>Run Startup Sync</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.commandButtonSecondary,
                !canSendCommands && styles.commandButtonDisabled,
              ]}
              onPress={probeChannels}
              disabled={!canSendCommands}>
              <Text style={styles.commandButtonSecondaryText}>
                Refresh Channels
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {channelProbeResults.length > 0 ? (
        <View style={styles.channelsSummaryCard}>
          <Text style={styles.sectionTitleNoMargin}>Loaded Channels</Text>

          {namedChannels.length > 0 ? (
            namedChannels.map(channel => (
              <View key={channel.channelIndex} style={styles.channelRow}>
                <Text style={styles.channelTitle}>
                  Channel {channel.channelIndex}: {channel.channelName}
                </Text>
                <Text style={styles.channelSecret}>Secret: {channel.secret}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>
              Channel sync complete, but no named channels were found.
            </Text>
          )}
        </View>
      ) : null}

      {devices.length > 0 && !connectedDevice ? (
        <View style={styles.scanResultsCard}>
          <Text style={styles.sectionTitleNoMargin}>Nearby Devices</Text>

          <FlatList
            data={devices}
            keyExtractor={item => item.id}
            renderItem={renderDevice}
            scrollEnabled={false}
            contentContainerStyle={styles.listContent}
          />
        </View>
      ) : null}

      {!connectedDevice && devices.length === 0 ? (
        <View style={styles.scanResultsCard}>
          <Text style={styles.sectionTitleNoMargin}>Nearby Devices</Text>
          <Text style={styles.emptyText}>
            No devices found yet. Tap scan while your MeshCore node is powered
            on.
          </Text>
        </View>
      ) : null}

      {connectedDevice ? (
        <View style={styles.debugToggleCard}>
          <TouchableOpacity
            style={styles.debugToggleButton}
            onPress={() => setShowDebugLogs(current => !current)}>
            <Text style={styles.debugToggleText}>
              {showDebugLogs ? 'Hide Debug Logs' : 'Show Debug Logs'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {connectedDevice && showDebugLogs ? (
        <View style={styles.debugSection}>
          <View style={styles.txCard}>
            <Text style={styles.sectionTitleNoMargin}>Manual Debug Commands</Text>
            <Text style={styles.body}>
              Low-level command buttons kept for protocol testing.
            </Text>

            <View style={styles.commandButtons}>
              <TouchableOpacity
                style={[
                  styles.commandButtonSecondary,
                  !canSendCommands && styles.commandButtonDisabled,
                ]}
                onPress={sendAppStart}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>
                  Send App Start
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.commandButtonSecondary,
                  !canSendCommands && styles.commandButtonDisabled,
                ]}
                onPress={getBatteryStatus}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>
                  Get Battery / Storage
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.commandButtonSecondary,
                  !canSendCommands && styles.commandButtonDisabled,
                ]}
                onPress={syncContacts}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>
                  Sync Contacts
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.commandButtonSecondary,
                  !canSendCommands && styles.commandButtonDisabled,
                ]}
                onPress={sendDeviceQuery}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>
                  Send Device Query
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.commandButtonSecondary,
                  !canSendCommands && styles.commandButtonDisabled,
                ]}
                onPress={getChannel0}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>
                  Get Channel 0
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.txCard}>
            <Text style={styles.sectionTitleNoMargin}>RX Writes</Text>
            <Text style={styles.body}>Commands sent from BushMesh to device.</Text>

            {rxLogs.length === 0 ? (
              <Text style={styles.emptyText}>No commands sent yet.</Text>
            ) : (
              rxLogs.map(renderLog)
            )}
          </View>

          <View style={styles.txCard}>
            <Text style={styles.sectionTitleNoMargin}>Assembled TX Frames</Text>
            <Text style={styles.body}>
              BLE chunks joined together, then parsed into readable fields.
            </Text>

            {txFrames.length === 0 ? (
              <Text style={styles.emptyText}>
                No assembled frames yet. Send a command first.
              </Text>
            ) : (
              txFrames.map(renderLog)
            )}
          </View>

          <View style={styles.txCard}>
            <Text style={styles.sectionTitleNoMargin}>Raw TX Chunks</Text>
            <Text style={styles.body}>
              Individual BLE notification chunks, kept for debugging.
            </Text>

            {txChunks.length === 0 ? (
              <Text style={styles.emptyText}>
                Listening, but no TX chunks received yet.
              </Text>
            ) : (
              txChunks.map(renderLog)
            )}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 10,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  statusCard: {
    marginTop: 16,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusTextWrap: {
    flex: 1,
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  statusDetail: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
  },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  syncPillText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: '900',
  },
  deviceNameBox: {
    marginTop: 12,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  deviceNameLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  deviceNameValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  quickStatsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  quickStatCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickStatNumber: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
  },
  quickStatLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  button: {
    flex: 1,
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonDisabled: {
    opacity: 0.8,
  },
  buttonText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  syncCard: {
    marginTop: 18,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  commandButtons: {
    marginTop: 14,
    gap: 10,
  },
  commandButton: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  commandButtonSecondary: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  commandButtonDisabled: {
    opacity: 0.4,
  },
  commandButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '900',
  },
  commandButtonSecondaryText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  channelsSummaryCard: {
    marginTop: 18,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  channelRow: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 10,
  },
  channelTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  channelSecret: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  scanResultsCard: {
    marginTop: 18,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  debugToggleCard: {
    marginTop: 18,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  debugToggleButton: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  debugToggleText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  debugSection: {
    marginTop: 4,
  },
  txCard: {
    marginTop: 18,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  txRow: {
    marginTop: 10,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  txLabel: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 4,
  },
  txDetail: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  txText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  parsedBox: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  parsedText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  sectionTitleNoMargin: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 10,
  },
  listContent: {
    paddingBottom: 4,
  },
  deviceRow: {
    backgroundColor: colors.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  deviceTextWrap: {
    flex: 1,
  },
  deviceName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  deviceId: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  rssi: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
});