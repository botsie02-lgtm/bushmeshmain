import React, {useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Device} from 'react-native-ble-plx';

import {AppRadioLogItem} from '../radio/AppRadioConnectionService';
import {useBushMesh} from '../state/BushMeshContext';
import {useRadioConnection} from '../state/RadioConnectionContext';
import {colors} from '../theme/colors';

function displayValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

export function DeviceScreen(): React.JSX.Element {
  const {channels: sharedChannels, activeChannelIndex} = useBushMesh();
  const {
    snapshot,
    nativeHandoffSupported,
    startScan,
    connectToDevice,
    handoffToAndroid,
    disconnect,
    runActiveStartupSync,
    getBatteryStatus,
    getDeviceTime,
    setDeviceTimeToPhone,
    syncContacts,
    sendAppStart,
    sendDeviceQuery,
    getChannel0,
    probeChannels,
  } = useRadioConnection();
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState(
    'Node settings are read from the active MeshCore session.',
  );

  const {
    status,
    statusDetail,
    devices,
    connectedDeviceAddress,
    connectedDeviceLabel,
    connectionOwner,
    meshCoreBle,
    txChunks,
    txFrames,
    rxLogs,
    isWriting,
    deviceInfo,
    selfInfo,
    deviceStatus,
    deviceTimeSeconds,
  } = snapshot;

  const hasConnectedRadio = connectedDeviceAddress !== null;
  const isScanning = status === 'Scanning';
  const isConnecting = status === 'Connecting';
  const namedChannels = sharedChannels.filter(
    channel => channel.channelName && channel.channelName !== 'Empty',
  );
  const canSendCommands =
    hasConnectedRadio &&
    !isWriting &&
    (connectionOwner === 'android-native' ||
      (connectionOwner === 'react-native' &&
        meshCoreBle?.serviceFound === true &&
        meshCoreBle.rxFound === true &&
        meshCoreBle.txFound === true));

  const getStatusColor = () => {
    if (status === 'Connected') return colors.success;
    if (status === 'Error') return colors.danger;
    if (status === 'Scanning' || status === 'Connecting') return colors.warning;
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
        onPress={() => {
          connectToDevice(item).catch(() => undefined);
        }}
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

  const renderLog = (log: AppRadioLogItem) => (
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

  const refreshNodeTime = async () => {
    try {
      const seconds = await getDeviceTime();
      setSettingsStatus(`Node time read successfully: ${new Date(seconds * 1000).toISOString()}`);
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : 'Node time read failed.');
    }
  };

  const updateNodeTime = async () => {
    try {
      const seconds = await setDeviceTimeToPhone();
      setSettingsStatus(`Node time updated and verified: ${new Date(seconds * 1000).toISOString()}`);
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : 'Node time update failed.');
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Device</Text>
        <Text style={styles.title}>Companion Node</Text>
        <Text style={styles.body}>
          Connect and sync through React Native, then hand ownership to Android
          for sticky reconnect and process-death recovery. The radio connection
          now belongs to the application runtime rather than this screen.
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
          onPress={() => {
            startScan().catch(() => undefined);
          }}
          disabled={isScanning || isConnecting || isWriting || hasConnectedRadio}>
          {isScanning ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.buttonText}>Scan for devices</Text>
          )}
        </TouchableOpacity>
        {hasConnectedRadio ? (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => {
              disconnect().catch(() => undefined);
            }}>
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
            onPress={() => {
              handoffToAndroid().catch(() => undefined);
            }}
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
            Android-native session. This ownership survives Device-screen
            navigation and remains independent of this UI lifecycle.
          </Text>
        </View>
      ) : null}

      {hasConnectedRadio ? (
        <View style={styles.nodeSettingsCard}>
          <Text style={styles.sectionTitleNoMargin}>Node Settings</Text>
          <Text style={styles.body}>
            Safe operational information from verified MeshCore companion commands.
            BushMesh does not expose or export this node's private identity key.
          </Text>

          <View style={styles.settingsGroup}>
            <Text style={styles.settingsHeading}>Identity</Text>
            <Text style={styles.settingText}>
              Node name: {displayValue(selfInfo?.deviceName ?? connectedDeviceLabel)}
            </Text>
            <Text style={styles.settingText}>
              Public identity ref: {displayValue(selfInfo?.bushMeshIdentityRef)}
            </Text>
            <Text style={styles.settingText}>
              Advert type: {displayValue(selfInfo?.advertisementType)}
            </Text>
          </View>

          <View style={styles.settingsGroup}>
            <Text style={styles.settingsHeading}>Firmware and capacity</Text>
            <Text style={styles.settingText}>
              Device model: {displayValue(deviceInfo?.model)}
            </Text>
            <Text style={styles.settingText}>
              Firmware: {displayValue(deviceInfo?.version)} · build {displayValue(deviceInfo?.firmwareBuild)}
            </Text>
            <Text style={styles.settingText}>
              Device-info protocol: {displayValue(deviceInfo?.firmwareVersion)}
            </Text>
            <Text style={styles.settingText}>
              Maximum channels: {displayValue(deviceInfo?.maxChannels)} · maximum contacts: {displayValue(deviceInfo?.maxContacts)}
            </Text>
            <Text style={styles.settingText}>
              BLE PIN: {deviceInfo?.blePin ? 'configured (not displayed)' : 'not reported'}
            </Text>
          </View>

          <View style={styles.settingsGroup}>
            <Text style={styles.settingsHeading}>Radio profile / capabilities</Text>
            <Text style={styles.settingText}>
              Frequency: {selfInfo?.frequencyMhz == null ? '—' : `${selfInfo.frequencyMhz.toFixed(3)} MHz`}
            </Text>
            <Text style={styles.settingText}>
              Bandwidth: {selfInfo?.bandwidthKhz == null ? '—' : `${selfInfo.bandwidthKhz.toFixed(1)} kHz`} · SF {displayValue(selfInfo?.spreadingFactor)} · CR {displayValue(selfInfo?.codingRate)}
            </Text>
            <Text style={styles.settingText}>
              TX power: {selfInfo?.txPower == null ? '—' : `${selfInfo.txPower} dBm`} · max {selfInfo?.maxTxPower == null ? '—' : `${selfInfo.maxTxPower} dBm`}
            </Text>
            <Text style={styles.settingText}>
              Client repeat: {displayValue(deviceInfo?.clientRepeat)} · path hash mode: {displayValue(deviceInfo?.pathHashMode)}
            </Text>
          </View>

          <View style={styles.settingsGroup}>
            <Text style={styles.settingsHeading}>Battery / storage</Text>
            <Text style={styles.settingText}>
              Battery: {deviceStatus ? `${deviceStatus.batteryVolts.toFixed(2)} V` : '—'}
            </Text>
            <Text style={styles.settingText}>
              Storage: {deviceStatus?.storagePercent == null ? '—' : `${deviceStatus.storagePercent}% used`} {deviceStatus?.usedStorageKb == null ? '' : `(${deviceStatus.usedStorageKb} / ${deviceStatus.totalStorageKb ?? '—'} KB)`}
            </Text>
            <TouchableOpacity
              style={[styles.commandButtonSecondary, !canSendCommands && styles.commandButtonDisabled]}
              onPress={() => getBatteryStatus().catch(() => undefined)}
              disabled={!canSendCommands}>
              <Text style={styles.commandButtonSecondaryText}>Refresh battery / storage</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.settingsGroup}>
            <Text style={styles.settingsHeading}>Device time</Text>
            <Text style={styles.settingText}>
              {deviceTimeSeconds == null
                ? 'Not read yet.'
                : new Date(deviceTimeSeconds * 1000).toISOString()}
            </Text>
            <View style={styles.settingsButtons}>
              <TouchableOpacity
                style={[styles.commandButtonSecondary, !canSendCommands && styles.commandButtonDisabled]}
                onPress={refreshNodeTime}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>Read time</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.commandButtonSecondary, !canSendCommands && styles.commandButtonDisabled]}
                onPress={updateNodeTime}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>Set from phone and verify</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.settingsGroup}>
            <Text style={styles.settingsHeading}>Channel carrier</Text>
            <Text style={styles.settingText}>
              Advertised slots: {displayValue(deviceInfo?.maxChannels)} · loaded: {sharedChannels.length} · active BushMesh slot: {displayValue(activeChannelIndex)}
            </Text>
            <Text style={styles.settingsHint}>
              Create/join/clear private carrier channels from the Channels screen.
              Secrets remain redacted here and in ordinary diagnostics.
            </Text>
          </View>

          <Text style={styles.settingsStatus}>{settingsStatus}</Text>
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
              onPress={() => {
                runActiveStartupSync().catch(() => undefined);
              }}
              disabled={!canSendCommands}>
              <Text style={styles.commandButtonText}>Run Startup Sync</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.commandButtonSecondary,
                !canSendCommands && styles.commandButtonDisabled,
              ]}
              onPress={() => {
                probeChannels().catch(() => undefined);
              }}
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
                <Text style={styles.channelSecret}>
                  Carrier secret: {channel.secret === 'Configured (redacted)' ? 'configured (redacted)' : channel.secret}
                </Text>
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
                onPress={() => sendAppStart().catch(() => undefined)}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>Send App Start</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.commandButtonSecondary, !canSendCommands && styles.commandButtonDisabled]}
                onPress={() => getBatteryStatus().catch(() => undefined)}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>Get Battery / Storage</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.commandButtonSecondary, !canSendCommands && styles.commandButtonDisabled]}
                onPress={() => syncContacts().catch(() => undefined)}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>Sync Contacts</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.commandButtonSecondary, !canSendCommands && styles.commandButtonDisabled]}
                onPress={() => sendDeviceQuery().catch(() => undefined)}
                disabled={!canSendCommands}>
                <Text style={styles.commandButtonSecondaryText}>Send Device Query</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.commandButtonSecondary, !canSendCommands && styles.commandButtonDisabled]}
                onPress={() => getChannel0().catch(() => undefined)}
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
  heroCard: {backgroundColor: colors.surface, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: colors.border},
  eyebrow: {color: colors.accent, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', marginBottom: 8},
  title: {color: colors.textPrimary, fontSize: 24, fontWeight: '900', marginBottom: 10},
  body: {color: colors.textSecondary, fontSize: 14, lineHeight: 21},
  statusCard: {marginTop: 16, backgroundColor: colors.surfaceSoft, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border},
  statusTopRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  statusTextWrap: {flex: 1},
  statusLabel: {color: colors.textMuted, fontSize: 13, fontWeight: '700', marginBottom: 4},
  statusValue: {fontSize: 20, fontWeight: '900'},
  statusDetail: {color: colors.textSecondary, fontSize: 14, marginTop: 8, lineHeight: 20},
  syncPill: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6},
  syncPillText: {color: colors.background, fontSize: 12, fontWeight: '900'},
  deviceNameBox: {marginTop: 12, backgroundColor: colors.background, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: colors.border},
  deviceNameLabel: {color: colors.textMuted, fontSize: 12, fontWeight: '800'},
  deviceNameValue: {color: colors.textPrimary, fontSize: 15, fontWeight: '900', marginTop: 4},
  deviceAddress: {color: colors.textMuted, fontSize: 10, marginTop: 4},
  ownerText: {color: colors.accent, fontSize: 10, fontWeight: '900', marginTop: 6, letterSpacing: 0.8},
  quickStatsRow: {flexDirection: 'row', gap: 10, marginTop: 16},
  quickStatCard: {flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: colors.border},
  quickStatNumber: {color: colors.textPrimary, fontSize: 18, fontWeight: '900'},
  quickStatLabel: {color: colors.textMuted, fontSize: 9, fontWeight: '800', marginTop: 4},
  actions: {flexDirection: 'row', gap: 12, marginTop: 16},
  button: {flex: 1, minHeight: 50, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16},
  buttonDisabled: {opacity: 0.6},
  buttonText: {color: colors.background, fontSize: 15, fontWeight: '900'},
  secondaryButton: {minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16},
  secondaryButtonText: {color: colors.textPrimary, fontSize: 15, fontWeight: '900'},
  handoffCard: {marginTop: 18, backgroundColor: colors.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.accent},
  nativeCard: {marginTop: 18, backgroundColor: colors.surfaceSoft, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.success},
  nativeTitle: {color: colors.success, fontSize: 12, fontWeight: '900', letterSpacing: 1},
  nodeSettingsCard: {marginTop: 18, backgroundColor: colors.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border},
  settingsGroup: {marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border},
  settingsHeading: {color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 0.7, marginBottom: 7},
  settingText: {color: colors.textSecondary, fontSize: 12, lineHeight: 19},
  settingsHint: {color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 5},
  settingsButtons: {gap: 8, marginTop: 9},
  settingsStatus: {color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 14},
  syncCard: {marginTop: 18, backgroundColor: colors.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border},
  commandButtons: {marginTop: 14, gap: 10},
  commandButton: {minHeight: 46, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 12},
  commandButtonSecondary: {minHeight: 46, borderRadius: 14, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16},
  commandButtonDisabled: {opacity: 0.4},
  commandButtonText: {color: colors.background, fontSize: 14, fontWeight: '900'},
  commandButtonSecondaryText: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  channelsSummaryCard: {marginTop: 18, backgroundColor: colors.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border},
  channelRow: {backgroundColor: colors.background, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, marginTop: 10},
  channelTitle: {color: colors.textPrimary, fontSize: 15, fontWeight: '900'},
  channelSecret: {color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 6},
  scanResultsCard: {marginTop: 18, backgroundColor: colors.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border},
  debugToggleCard: {marginTop: 18, backgroundColor: colors.surface, borderRadius: 18, padding: 12, borderWidth: 1, borderColor: colors.border},
  debugToggleButton: {minHeight: 44, borderRadius: 14, backgroundColor: colors.surfaceSoft, alignItems: 'center', justifyContent: 'center'},
  debugToggleText: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  debugSection: {marginTop: 4},
  txCard: {marginTop: 18, backgroundColor: colors.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border},
  txRow: {marginTop: 10, backgroundColor: colors.background, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: colors.border},
  txLabel: {color: colors.textPrimary, fontSize: 12, fontWeight: '900', marginBottom: 4},
  txDetail: {color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 6},
  txText: {color: colors.accent, fontSize: 12, fontWeight: '700', lineHeight: 18},
  parsedBox: {backgroundColor: colors.surfaceSoft, borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: colors.border},
  parsedText: {color: colors.textPrimary, fontSize: 12, fontWeight: '700', lineHeight: 18},
  sectionTitleNoMargin: {color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginBottom: 10},
  listContent: {paddingBottom: 4},
  deviceRow: {backgroundColor: colors.background, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12},
  deviceTextWrap: {flex: 1},
  deviceName: {color: colors.textPrimary, fontSize: 16, fontWeight: '900'},
  deviceId: {color: colors.textMuted, fontSize: 12, marginTop: 4},
  rssi: {color: colors.textSecondary, fontSize: 12, fontWeight: '700'},
  emptyText: {color: colors.textMuted, fontSize: 14, lineHeight: 21, marginTop: 10},
});