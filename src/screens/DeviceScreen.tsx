import React, {useEffect, useMemo, useRef, useState} from 'react';
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

import {requestBlePermissions} from '../ble/blePermissions';
import {MeshCoreClient, MeshCoreLogItem} from '../meshcore/MeshCoreClient';
import {
  MeshCoreBleDiscovery,
  discoverMeshCoreBle,
} from '../meshcore/meshcoreBle';
import {
  NativeMeshCoreResponse,
  NativeMeshCoreSession,
} from '../meshcore/NativeMeshCoreSession';
import {nativeMeshCoreSessionCoordinator} from '../meshcore/NativeMeshCoreSessionCoordinator';
import {nativeRadioService} from '../native/NativeRadioService';
import {BushMeshChannel, useBushMesh} from '../state/BushMeshContext';
import {colors} from '../theme/colors';

type ConnectionStatus =
  | 'Disconnected'
  | 'Requesting permissions'
  | 'Scanning'
  | 'Connecting'
  | 'Connected'
  | 'Error';

type ConnectionOwner = 'none' | 'react-native' | 'android-native';

type UiLogItem = MeshCoreLogItem & {
  id: string;
};

function channelFromParsedLines(lines?: string[]): BushMeshChannel | null {
  if (!lines?.length) {
    return null;
  }

  const read = (prefix: string, fallback = 'Unknown') =>
    lines
      .find(line => line.startsWith(prefix))
      ?.replace(prefix, '')
      .trim() ?? fallback;

  return {
    channelIndex: read('Channel Index:'),
    channelName: read('Channel Name:'),
    secret: read('Secret:'),
  };
}

function nativeResponseLog(response: NativeMeshCoreResponse): MeshCoreLogItem {
  return {
    label: response.label,
    value: response.bytes
      .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
      .join(' '),
    rawBytes: [...response.bytes],
    parsedLines: response.parsed?.lines,
    batteryInfo: response.parsed?.batteryInfo,
    contactInfo: response.parsed?.contactInfo,
    channelMessage: response.parsed?.channelMessage,
    contactMessage: response.parsed?.contactMessage,
    contactsStartCount: response.parsed?.contactsStartCount,
    contactsEndLastModified: response.parsed?.contactsEndLastModified,
    deviceInfo: response.deviceInfo ?? undefined,
    selfInfo: response.selfInfo ?? undefined,
    channelData: response.channelData ?? undefined,
    bushMeshMessage: response.bushMeshMessage ?? undefined,
    detail: `${response.bytes.length} byte Android-native MeshCore frame`,
  };
}

export function DeviceScreen(): React.JSX.Element {
  const manager = useMemo(() => new BleManager(), []);
  const meshCoreClientRef = useRef<MeshCoreClient | null>(null);
  const nativeSessionRef = useRef<NativeMeshCoreSession | null>(null);

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
  const [statusDetail, setStatusDetail] = useState(
    'No MeshCore device connected.',
  );
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [connectedDeviceAddress, setConnectedDeviceAddress] = useState<
    string | null
  >(null);
  const [connectedDeviceLabel, setConnectedDeviceLabel] = useState<string | null>(
    null,
  );
  const [meshCoreBle, setMeshCoreBle] = useState<MeshCoreBleDiscovery | null>(
    null,
  );
  const [connectionOwner, setConnectionOwner] =
    useState<ConnectionOwner>('none');
  const [txChunks, setTxChunks] = useState<UiLogItem[]>([]);
  const [txFrames, setTxFrames] = useState<UiLogItem[]>([]);
  const [rxLogs, setRxLogs] = useState<UiLogItem[]>([]);
  const [isWriting, setIsWriting] = useState(false);
  const [showDebugLogs, setShowDebugLogs] = useState(false);

  const nativeHandoffSupported = nativeRadioService.isSupported();
  const hasConnectedRadio = connectedDeviceAddress !== null;
  const isScanning = status === 'Scanning';
  const isConnecting = status === 'Connecting';
  const namedChannels = sharedChannels.filter(
    channel => channel.channelName && channel.channelName !== 'Empty',
  );

  const canSendCommands =
    hasConnectedRadio &&
    !isWriting &&
    (connectionOwner === 'android-native'
      ? nativeSessionRef.current !== null
      : connectionOwner === 'react-native' &&
        meshCoreBle?.serviceFound === true &&
        meshCoreBle.rxFound === true &&
        meshCoreBle.txFound === true);

  const makeLogItem = (log: MeshCoreLogItem): UiLogItem => ({
    ...log,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  });

  const addTxChunk = (log: MeshCoreLogItem) => {
    if (log.label === 'RX_WRITE') {
      setRxLogs(current => [makeLogItem(log), ...current.slice(0, 39)]);
      return;
    }
    setTxChunks(current => [makeLogItem(log), ...current.slice(0, 39)]);
  };

  const addTxFrame = (log: MeshCoreLogItem) => {
    setTxFrames(current => [makeLogItem(log), ...current.slice(0, 39)]);
  };

  const addNativeFrame = (response: NativeMeshCoreResponse) => {
    addTxFrame(nativeResponseLog(response));
  };

  const setChannelsFromLines = (responses: Array<{parsedLines?: string[]}>) => {
    const channels = responses
      .map(response => channelFromParsedLines(response.parsedLines))
      .filter((channel): channel is BushMeshChannel => channel !== null);
    setSharedChannels(channels);
    return channels;
  };

  const setChannelsFromNative = (responses: NativeMeshCoreResponse[]) => {
    const channels = responses
      .map(response => channelFromParsedLines(response.parsed?.lines))
      .filter((channel): channel is BushMeshChannel => channel !== null);
    setSharedChannels(channels);
    return channels;
  };

  const upsertDevice = (device: Device) => {
    if (!device.name && !device.localName) {
      return;
    }

    setDevices(current => {
      const found = current.some(item => item.id === device.id);
      return found
        ? current.map(item => (item.id === device.id ? device : item))
        : [...current, device];
    });
  };

  const startScan = async () => {
    setStatus('Requesting permissions');
    setStatusDetail('Checking Bluetooth permissions...');

    const allowed = await requestBlePermissions();
    if (!allowed) {
      setStatus('Error');
      setStatusDetail('Bluetooth permissions were not granted.');
      return;
    }

    setDevices([]);
    setStatus('Scanning');
    setStatusDetail('Scanning for nearby BLE devices...');

    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        manager.stopDeviceScan();
        setStatus('Error');
        setStatusDetail(error.message);
        return;
      }
      if (device) {
        upsertDevice(device);
      }
    });

    setTimeout(() => {
      manager.stopDeviceScan();
      setStatus(current => (current === 'Scanning' ? 'Disconnected' : current));
      setStatusDetail(current =>
        current === 'Scanning for nearby BLE devices...'
          ? 'Scan finished. Select a device to connect.'
          : current,
      );
    }, 10_000);
  };

  const runReactNativeStartupSync = async (client: MeshCoreClient) => {
    setIsWriting(true);
    setSharedChannels([]);
    try {
      setStatusDetail('Startup sync: sending App Start...');
      await client.sendAppStart('BushMesh');
      setStatusDetail('Startup sync: querying device info...');
      await client.sendDeviceQuery();
      setStatusDetail('Startup sync: loading configured channels...');
      const results = await client.probeChannels();
      const channels = setChannelsFromLines(
        results.map(result => ({parsedLines: result.parsedLines})),
      );
      const named = channels.filter(channel => channel.channelName !== 'Empty');
      setStatusDetail(
        `Startup sync complete. Loaded ${named.length} named channel(s) from ${channels.length} slot(s).`,
      );
    } finally {
      setIsWriting(false);
    }
  };

  const runNativeStartupSync = async (session: NativeMeshCoreSession) => {
    setIsWriting(true);
    setSharedChannels([]);
    try {
      setStatusDetail('Android session: loading configured channels...');
      const responses = await session.probeChannels();
      const channels = setChannelsFromNative(responses);
      const named = channels.filter(channel => channel.channelName !== 'Empty');
      setStatusDetail(
        `Android owns the radio. Loaded ${named.length} named channel(s) from ${channels.length} slot(s).`,
      );
    } finally {
      setIsWriting(false);
    }
  };

  useEffect(() => {
    if (!nativeHandoffSupported) {
      return;
    }

    let active = true;

    const recoverNativeOwner = async () => {
      try {
        const nativeStatus = await nativeRadioService.getStatus();
        const address = nativeStatus.nativeBleDeviceAddress?.trim() ?? '';
        if (nativeStatus.ownership !== 'native-service' || !address) {
          return;
        }

        const label =
          nativeStatus.nativeBleDeviceLabel ??
          nativeStatus.deviceLabel ??
          'MeshCore radio';

        if (!active) {
          return;
        }

        setStatus('Connecting');
        setStatusDetail('Recovering Android-owned MeshCore radio session...');
        setConnectedDevice(null);
        setConnectedDeviceAddress(address);
        setConnectedDeviceLabel(label);
        setMeshCoreBle(null);
        setConnectionOwner('android-native');
        setSharedConnectionStatus('Connecting');
        setConnectedDeviceName(label);

        const session = await nativeMeshCoreSessionCoordinator.start(address, label, {
          onStatus: message => {
            if (active) {
              setStatusDetail(message);
            }
          },
          onError: message => {
            if (active) {
              setStatus('Error');
              setStatusDetail(message);
            }
          },
          onFrame: response => {
            if (active) {
              setTxFrames(current => [
                makeLogItem(nativeResponseLog(response)),
                ...current.slice(0, 39),
              ]);
            }
          },
        });

        if (!active) {
          return;
        }

        nativeSessionRef.current = session;
        setSendChannelMessageHandler(async (channelIndex, message) => {
          await session.sendChannelMessage(channelIndex, message);
        });
        setSharedConnectionStatus('Connected');
        setStatus('Connected');

        const responses = await session.probeChannels();
        if (!active) {
          return;
        }
        const channels = responses
          .map(response => channelFromParsedLines(response.parsed?.lines))
          .filter((channel): channel is BushMeshChannel => channel !== null);
        setSharedChannels(channels);
        const named = channels.filter(channel => channel.channelName !== 'Empty');
        setStatusDetail(
          `Recovered Android-owned radio. Loaded ${named.length} named channel(s) from ${channels.length} slot(s).`,
        );
      } catch (error) {
        if (!active) {
          return;
        }
        nativeSessionRef.current = null;
        setConnectionOwner('none');
        setConnectedDeviceAddress(null);
        setConnectedDeviceLabel(null);
        setSharedConnectionStatus('Disconnected');
        setConnectedDeviceName(null);
        setSendChannelMessageHandler(null);
        setStatus('Error');
        setStatusDetail(
          error instanceof Error
            ? `Native radio recovery failed: ${error.message}`
            : 'Native radio recovery failed.',
        );
      }
    };

    recoverNativeOwner().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    nativeHandoffSupported,
    setConnectedDeviceName,
    setSendChannelMessageHandler,
    setSharedChannels,
    setSharedConnectionStatus,
  ]);

  const connectToDevice = async (device: Device) => {
    try {
      manager.stopDeviceScan();
      setStatus('Connecting');
      setStatusDetail(`Connecting to ${device.name ?? device.localName}...`);

      const connected = await manager.connectToDevice(device.id);
      const readyDevice = await connected.discoverAllServicesAndCharacteristics();
      const discovery = await discoverMeshCoreBle(readyDevice);
      const deviceName =
        readyDevice.name ?? readyDevice.localName ?? 'Unknown device';

      setConnectedDevice(readyDevice);
      setConnectedDeviceAddress(readyDevice.id);
      setConnectedDeviceLabel(deviceName);
      setMeshCoreBle(discovery);
      setConnectionOwner('react-native');
      setTxChunks([]);
      setTxFrames([]);
      setRxLogs([]);
      clearChannels();
      clearContacts();
      setSharedConnectionStatus('Connected');
      setConnectedDeviceName(deviceName);
      setStatus('Connected');

      if (!discovery.serviceFound || !discovery.rxFound || !discovery.txFound) {
        setStatusDetail(
          `Connected to ${deviceName}, but the MeshCore UART service was not fully found.`,
        );
        return;
      }

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

      await runReactNativeStartupSync(client);
    } catch (error) {
      setStatus('Error');
      setStatusDetail(
        error instanceof Error ? error.message : 'Failed to connect.',
      );
    }
  };

  const handoffToAndroid = async () => {
    if (!connectedDeviceAddress) {
      return;
    }
    if (!nativeHandoffSupported) {
      setStatus('Error');
      setStatusDetail('Android native radio ownership is unavailable in this build.');
      return;
    }
    if (connectionOwner === 'android-native') {
      return;
    }

    const address = connectedDeviceAddress;
    const label = connectedDeviceLabel ?? 'MeshCore radio';

    setIsWriting(true);
    setStatusDetail('Handing MeshCore BLE ownership to Android...');
    try {
      setSendChannelMessageHandler(null);
      meshCoreClientRef.current?.stop();
      meshCoreClientRef.current = null;

      try {
        await manager.cancelDeviceConnection(address);
      } catch {
        // Android can still claim the target if BLE-PLX already considers it gone.
      }

      const session = await nativeMeshCoreSessionCoordinator.start(address, label, {
        onStatus: setStatusDetail,
        onError: message => {
          setStatus('Error');
          setStatusDetail(message);
        },
        onFrame: addNativeFrame,
      });

      nativeSessionRef.current = session;
      setConnectedDevice(null);
      setConnectionOwner('android-native');
      setSharedConnectionStatus('Connected');
      setConnectedDeviceName(label);
      setStatus('Connected');
      setSendChannelMessageHandler(async (channelIndex, message) => {
        await session.sendChannelMessage(channelIndex, message);
      });

      await runNativeStartupSync(session);
    } catch (error) {
      nativeSessionRef.current = null;
      setConnectedDevice(null);
      setConnectionOwner('none');
      setConnectedDeviceAddress(null);
      setConnectedDeviceLabel(null);
      setSharedConnectionStatus('Disconnected');
      setConnectedDeviceName(null);
      setSendChannelMessageHandler(null);
      setStatus('Error');
      setStatusDetail(
        error instanceof Error
          ? `Android radio handoff failed: ${error.message}`
          : 'Android radio handoff failed.',
      );
    } finally {
      setIsWriting(false);
    }
  };

  const disconnect = async () => {
    setIsWriting(true);
    setSendChannelMessageHandler(null);
    try {
      if (connectionOwner === 'android-native') {
        await nativeMeshCoreSessionCoordinator.stop();
        nativeSessionRef.current = null;
      } else {
        meshCoreClientRef.current?.stop();
        meshCoreClientRef.current = null;
        if (connectedDevice) {
          try {
            await manager.cancelDeviceConnection(connectedDevice.id);
          } catch {
            // Connection may already be gone.
          }
        }
      }
    } finally {
      setConnectedDevice(null);
      setConnectedDeviceAddress(null);
      setConnectedDeviceLabel(null);
      setMeshCoreBle(null);
      setConnectionOwner('none');
      setTxChunks([]);
      setTxFrames([]);
      setRxLogs([]);
      clearChannels();
      clearContacts();
      setSharedConnectionStatus('Disconnected');
      setConnectedDeviceName(null);
      setStatus('Disconnected');
      setStatusDetail('Device disconnected.');
      setIsWriting(false);
    }
  };

  const runActiveStartupSync = async () => {
    try {
      if (connectionOwner === 'android-native' && nativeSessionRef.current) {
        setIsWriting(true);
        await nativeSessionRef.current.sendAppStart('BushMesh');
        await nativeSessionRef.current.sendDeviceQuery();
        await runNativeStartupSync(nativeSessionRef.current);
        return;
      }
      if (meshCoreClientRef.current) {
        await runReactNativeStartupSync(meshCoreClientRef.current);
      }
    } catch (error) {
      setStatus('Error');
      setStatusDetail(
        error instanceof Error ? error.message : 'Startup sync failed.',
      );
      setIsWriting(false);
    }
  };

  const getBatteryStatus = async () => {
    try {
      setIsWriting(true);
      const battery =
        connectionOwner === 'android-native'
          ? (await nativeSessionRef.current?.getBatteryStatus())?.parsed?.batteryInfo
          : (await meshCoreClientRef.current?.getBatteryStatus())?.batteryInfo;

      if (battery) {
        setDeviceStatus(battery);
        setStatusDetail(
          `Battery ${battery.batteryVolts.toFixed(2)} V. Storage ${battery.storagePercent ?? 0}% used.`,
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

  const syncContacts = async () => {
    try {
      setIsWriting(true);
      const contacts =
        connectionOwner === 'android-native'
          ? await nativeSessionRef.current?.syncContacts()
          : await meshCoreClientRef.current?.syncContacts();

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
      setStatusDetail(
        `Contacts sync complete. Loaded ${contacts?.length ?? 0} contact(s).`,
      );
    } catch (error) {
      setStatus('Error');
      setStatusDetail(
        error instanceof Error ? error.message : 'Failed to sync contacts.',
      );
    } finally {
      setIsWriting(false);
    }
  };

  const sendAppStart = async () => {
    try {
      setIsWriting(true);
      if (connectionOwner === 'android-native') {
        await nativeSessionRef.current?.sendAppStart('BushMesh');
      } else {
        await meshCoreClientRef.current?.sendAppStart('BushMesh');
      }
    } catch (error) {
      setStatus('Error');
      setStatusDetail(error instanceof Error ? error.message : 'App Start failed.');
    } finally {
      setIsWriting(false);
    }
  };

  const sendDeviceQuery = async () => {
    try {
      setIsWriting(true);
      if (connectionOwner === 'android-native') {
        await nativeSessionRef.current?.sendDeviceQuery();
      } else {
        await meshCoreClientRef.current?.sendDeviceQuery();
      }
    } catch (error) {
      setStatus('Error');
      setStatusDetail(
        error instanceof Error ? error.message : 'Device Query failed.',
      );
    } finally {
      setIsWriting(false);
    }
  };

  const getChannel0 = async () => {
    try {
      setIsWriting(true);
      const channel =
        connectionOwner === 'android-native'
          ? channelFromParsedLines(
              (await nativeSessionRef.current?.getChannel(0))?.parsed?.lines,
            )
          : channelFromParsedLines(
              (await meshCoreClientRef.current?.getChannel(0))?.parsedLines,
            );
      if (channel) {
        setSharedChannels([channel]);
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
      if (connectionOwner === 'android-native' && nativeSessionRef.current) {
        setChannelsFromNative(await nativeSessionRef.current.probeChannels());
      } else if (meshCoreClientRef.current) {
        const results = await meshCoreClientRef.current.probeChannels();
        setChannelsFromLines(
          results.map(result => ({parsedLines: result.parsedLines})),
        );
      }
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

  const ownerLabel =
    connectionOwner === 'android-native'
      ? 'ANDROID NATIVE'
      : connectionOwner === 'react-native'
        ? 'REACT NATIVE'
        : 'NO OWNER';

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
            <Text key={`${log.id}-${index}`} style={styles.parsedText}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={styles.txText}>{log.value}</Text>
    </View>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Device</Text>
        <Text style={styles.title}>Companion Node</Text>
        <Text style={styles.body}>
          Connect and sync through React Native, then hand ownership to Android
          for sticky reconnect and process-death recovery. A returning app also
          re-adopts an Android-owned radio automatically.
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
              <Text style={styles.syncPillText}>Working</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.statusDetail}>{statusDetail}</Text>
        {connectedDeviceAddress ? (
          <View style={styles.deviceNameBox}>
            <Text style={styles.deviceNameLabel}>Connected Node</Text>
            <Text style={styles.deviceNameValue}>
              {connectedDeviceLabel ?? 'MeshCore radio'}
            </Text>
            <Text style={styles.deviceAddress}>{connectedDeviceAddress}</Text>
            <Text style={styles.ownerText}>{ownerLabel}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.quickStatsRow}>
        <View style={styles.quickStatCard}>
          <Text style={styles.quickStatNumber}>{sharedChannels.length}</Text>
          <Text style={styles.quickStatLabel}>SLOTS LOADED</Text>
        </View>
        <View style={styles.quickStatCard}>
          <Text style={styles.quickStatNumber}>{namedChannels.length}</Text>
          <Text style={styles.quickStatLabel}>NAMED CHANNELS</Text>
        </View>
        <View style={styles.quickStatCard}>
          <Text style={styles.quickStatNumber}>
            {connectionOwner === 'android-native'
              ? 'NATIVE'
              : meshCoreBle?.serviceFound
                ? 'UART'
                : '--'}
          </Text>
          <Text style={styles.quickStatLabel}>RADIO OWNER</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, isScanning && styles.buttonDisabled]}
          onPress={startScan}
          disabled={isScanning || isConnecting || isWriting || hasConnectedRadio}>
          {isScanning ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.buttonText}>Scan for devices</Text>
          )}
        </TouchableOpacity>
        {hasConnectedRadio ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={disconnect}>
            <Text style={styles.secondaryButtonText}>Disconnect</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {hasConnectedRadio && connectionOwner === 'react-native' ? (
        <View style={styles.handoffCard}>
          <Text style={styles.sectionTitleNoMargin}>Android radio ownership</Text>
          <Text style={styles.body}>
            Hand this node to the native foreground service after startup sync.
            Android will own GATT reconnect and can recover the encrypted radio
            queue after the React Native process is killed.
          </Text>
          <TouchableOpacity
            style={[
              styles.commandButton,
              (!nativeHandoffSupported || isWriting) && styles.commandButtonDisabled,
            ]}
            onPress={handoffToAndroid}
            disabled={!nativeHandoffSupported || isWriting}>
            <Text style={styles.commandButtonText}>
              {nativeHandoffSupported
                ? 'Hand off to Android'
                : 'Native handoff unavailable'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {hasConnectedRadio && connectionOwner === 'android-native' ? (
        <View style={styles.nativeCard}>
          <Text style={styles.nativeTitle}>ANDROID OWNS THIS RADIO</Text>
          <Text style={styles.body}>
            MeshCore commands, Bushmesh datagrams and reconnects run through the
            Android-native session. This ownership survives React Native process
            death until you explicitly disconnect the target.
          </Text>
        </View>
      ) : null}

      {hasConnectedRadio ? (
        <View style={styles.syncCard}>
          <Text style={styles.sectionTitleNoMargin}>Radio Sync</Text>
          <Text style={styles.body}>
            Refresh identity, capabilities and channels through the active radio
            owner.
          </Text>
          <View style={styles.commandButtons}>
            <TouchableOpacity
              style={[
                styles.commandButton,
                !canSendCommands && styles.commandButtonDisabled,
              ]}
              onPress={runActiveStartupSync}
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
              <Text style={styles.commandButtonSecondaryText}>Refresh Channels</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {sharedChannels.length > 0 ? (
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
              Channel sync completed, but no named channels were found.
            </Text>
          )}
        </View>
      ) : null}

      {devices.length > 0 && !hasConnectedRadio ? (
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

      {!hasConnectedRadio && devices.length === 0 ? (
        <View style={styles.scanResultsCard}>
          <Text style={styles.sectionTitleNoMargin}>Nearby Devices</Text>
          <Text style={styles.emptyText}>
            No devices found yet. Tap scan while your MeshCore node is powered on.
          </Text>
        </View>
      ) : null}

      {hasConnectedRadio ? (
        <View style={styles.debugToggleCard}>
          <TouchableOpacity
            style={styles.debugToggleButton}
            onPress={() => setShowDebugLogs(current => !current)}>
            <Text style={styles.debugToggleText}>
              {showDebugLogs ? 'Hide Debug Tools' : 'Show Debug Tools'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {hasConnectedRadio && showDebugLogs ? (
        <View style={styles.debugSection}>
          <View style={styles.txCard}>
            <Text style={styles.sectionTitleNoMargin}>Manual Commands</Text>
            <View style={styles.commandButtons}>
              <TouchableOpacity
                style={[styles.commandButtonSecondary, !canSendCommands && styles.commandButtonDisabled]}
                onPress={sendAppStart}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>Send App Start</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.commandButtonSecondary, !canSendCommands && styles.commandButtonDisabled]}
                onPress={getBatteryStatus}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>Get Battery / Storage</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.commandButtonSecondary, !canSendCommands && styles.commandButtonDisabled]}
                onPress={syncContacts}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>Sync Contacts</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.commandButtonSecondary, !canSendCommands && styles.commandButtonDisabled]}
                onPress={sendDeviceQuery}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>Send Device Query</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.commandButtonSecondary, !canSendCommands && styles.commandButtonDisabled]}
                onPress={getChannel0}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>Get Channel 0</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.txCard}>
            <Text style={styles.sectionTitleNoMargin}>Protocol Frames</Text>
            <Text style={styles.body}>
              Frames from the active owner. Native ownership intentionally does
              not expose lower-level BLE notification chunks.
            </Text>
            {txFrames.length === 0 ? (
              <Text style={styles.emptyText}>No parsed frames captured yet.</Text>
            ) : (
              txFrames.map(renderLog)
            )}
          </View>

          {connectionOwner === 'react-native' ? (
            <>
              <View style={styles.txCard}>
                <Text style={styles.sectionTitleNoMargin}>RX Writes</Text>
                {rxLogs.length === 0 ? (
                  <Text style={styles.emptyText}>No commands sent yet.</Text>
                ) : (
                  rxLogs.map(renderLog)
                )}
              </View>
              <View style={styles.txCard}>
                <Text style={styles.sectionTitleNoMargin}>Raw BLE Notifications</Text>
                {txChunks.length === 0 ? (
                  <Text style={styles.emptyText}>No notifications captured yet.</Text>
                ) : (
                  txChunks.map(renderLog)
                )}
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 20, paddingBottom: 40},
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
  title: {color: colors.textPrimary, fontSize: 24, fontWeight: '900', marginBottom: 10},
  body: {color: colors.textSecondary, fontSize: 14, lineHeight: 21},
  statusCard: {
    marginTop: 16,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusTopRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  statusTextWrap: {flex: 1},
  statusLabel: {color: colors.textMuted, fontSize: 13, fontWeight: '700', marginBottom: 4},
  statusValue: {fontSize: 20, fontWeight: '900'},
  statusDetail: {color: colors.textSecondary, fontSize: 14, marginTop: 8, lineHeight: 20},
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  syncPillText: {color: colors.background, fontSize: 12, fontWeight: '900'},
  deviceNameBox: {
    marginTop: 12,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  deviceNameLabel: {color: colors.textMuted, fontSize: 12, fontWeight: '800'},
  deviceNameValue: {color: colors.textPrimary, fontSize: 15, fontWeight: '900', marginTop: 4},
  deviceAddress: {color: colors.textMuted, fontSize: 10, marginTop: 4},
  ownerText: {color: colors.accent, fontSize: 10, fontWeight: '900', marginTop: 6, letterSpacing: 0.8},
  quickStatsRow: {flexDirection: 'row', gap: 10, marginTop: 16},
  quickStatCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickStatNumber: {color: colors.textPrimary, fontSize: 18, fontWeight: '900'},
  quickStatLabel: {color: colors.textMuted, fontSize: 9, fontWeight: '800', marginTop: 4},
  actions: {flexDirection: 'row', gap: 12, marginTop: 16},
  button: {
    flex: 1,
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonDisabled: {opacity: 0.6},
  buttonText: {color: colors.background, fontSize: 15, fontWeight: '900'},
  secondaryButton: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryButtonText: {color: colors.textPrimary, fontSize: 15, fontWeight: '900'},
  handoffCard: {
    marginTop: 18,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  nativeCard: {
    marginTop: 18,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.success,
  },
  nativeTitle: {color: colors.success, fontSize: 12, fontWeight: '900', letterSpacing: 1},
  syncCard: {
    marginTop: 18,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  commandButtons: {marginTop: 14, gap: 10},
  commandButton: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 12,
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
  commandButtonDisabled: {opacity: 0.4},
  commandButtonText: {color: colors.background, fontSize: 14, fontWeight: '900'},
  commandButtonSecondaryText: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
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
  channelTitle: {color: colors.textPrimary, fontSize: 15, fontWeight: '900'},
  channelSecret: {color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 6},
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
  debugToggleText: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  debugSection: {marginTop: 4},
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
  txLabel: {color: colors.textPrimary, fontSize: 12, fontWeight: '900', marginBottom: 4},
  txDetail: {color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 6},
  txText: {color: colors.accent, fontSize: 12, fontWeight: '700', lineHeight: 18},
  parsedBox: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  parsedText: {color: colors.textPrimary, fontSize: 12, fontWeight: '700', lineHeight: 18},
  sectionTitleNoMargin: {color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginBottom: 10},
  listContent: {paddingBottom: 4},
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
  deviceTextWrap: {flex: 1},
  deviceName: {color: colors.textPrimary, fontSize: 16, fontWeight: '900'},
  deviceId: {color: colors.textMuted, fontSize: 12, marginTop: 4},
  rssi: {color: colors.textSecondary, fontSize: 12, fontWeight: '700'},
  emptyText: {color: colors.textMuted, fontSize: 14, lineHeight: 21, marginTop: 10},
});
