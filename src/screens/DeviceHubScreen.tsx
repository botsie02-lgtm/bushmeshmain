import React, {useEffect, useState} from 'react';
import {
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';

import {FieldSupportSnapshot} from '../components/FieldSupportSnapshot';
import {MapPackCatalogPanel} from '../components/MapPackCatalogPanel';
import {PhoneRuntimeHealthCard} from '../components/PhoneRuntimeHealthCard';
import {deviceConnectionPhase} from '../device/deviceConnectionHealth';
import {devicePreferences} from '../device/devicePreferences';
import {DevicePreferences} from '../device/devicePreferenceCodec';
import {
  NativeMeshCoreOwnershipSnapshot,
  nativeMeshCoreSessionCoordinator,
} from '../meshcore/NativeMeshCoreSessionCoordinator';
import {useLocationSession} from '../state/LocationSessionContext';
import {useOfflineMaps} from '../state/OfflineMapContext';
import {useRadioConnection} from '../state/RadioConnectionContext';
import {FieldDiagnosticsCaptureProvider} from '../state/FieldDiagnosticsCaptureContext';
import {FieldEventTraceProvider} from '../state/FieldEventTraceContext';
import {colors} from '../theme/colors';
import {DeviceScreen} from './DeviceScreen';
import {FieldDiagnosticsScreen} from './FieldDiagnosticsScreen';
import {LocationScreen} from './LocationScreen';
import {NativeRadioSetupScreen} from './NativeRadioSetupScreen';
import {RadioSettingsScreen} from './RadioSettingsScreen';

type DeviceSection =
  | 'overview' | 'connection' | 'radio' | 'location'
  | 'storage' | 'diagnostics' | 'legacy';

const sections: ReadonlyArray<{id: DeviceSection; label: string}> = [
  {id: 'overview', label: 'Overview'},
  {id: 'connection', label: 'Background Radio'},
  {id: 'radio', label: 'Radio Profile'},
  {id: 'location', label: 'GPS'},
  {id: 'storage', label: 'Offline Maps'},
  {id: 'diagnostics', label: 'Diagnostics'},
  {id: 'legacy', label: 'BLE Tools'},
];

function Detail({label, value, warning = false}: {
  label: string; value: string; warning?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, warning && styles.warning]}>{value}</Text>
    </View>
  );
}

function Block({heading, children}: {heading: string; children: React.ReactNode}) {
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{heading}</Text>
      {children}
    </View>
  );
}

function DeviceOverview({onOpen}: {onOpen: (section: DeviceSection) => void}) {
  const {snapshot, getBatteryStatus} = useRadioConnection();
  const [ownership, setOwnership] = useState<NativeMeshCoreOwnershipSnapshot>(
    nativeMeshCoreSessionCoordinator.getSnapshot(),
  );
  const [prefs, setPrefs] = useState<DevicePreferences>(devicePreferences.getSnapshot());
  const {status: gpsStatus, latestFix, nativeGpsSupported} = useLocationSession();
  const {packCatalog, mapPersistenceStatus, mapPackInstallSupported} = useOfflineMaps();
  const [batteryPending, setBatteryPending] = useState(false);
  const [batteryMessage, setBatteryMessage] = useState<string | null>(null);

  useEffect(() => nativeMeshCoreSessionCoordinator.subscribe(() => {
    setOwnership(nativeMeshCoreSessionCoordinator.getSnapshot());
  }), []);
  useEffect(() => {
    const unsubscribe = devicePreferences.subscribe(() => {
      setPrefs(devicePreferences.getSnapshot());
    });
    devicePreferences.initialize().catch(() => undefined);
    return unsubscribe;
  }, []);

  const phase = deviceConnectionPhase(snapshot, ownership.state);
  const connected = phase === 'ready';
  const node = snapshot.selfInfo;
  const info = snapshot.deviceInfo;
  const battery = snapshot.deviceStatus;
  const quality = snapshot.meshCoreBle;
  const owner = snapshot.connectionOwner === 'android-native'
    ? 'Android Background Radio'
    : snapshot.connectionOwner === 'react-native'
      ? 'Legacy React Native BLE' : 'No BLE owner';

  const updateBattery = async () => {
    setBatteryPending(true);
    setBatteryMessage(null);
    try {
      await getBatteryStatus();
      setBatteryMessage('Battery/telemetry request sent to the active node.');
    } catch (error) {
      setBatteryMessage(error instanceof Error ? error.message : 'Battery read failed.');
    } finally {
      setBatteryPending(false);
    }
  };

  const meters = latestFix?.accuracyMeters;
  const accuracy = typeof meters === 'number'
    ? prefs.distanceUnit === 'imperial'
      ? (meters * 3.28084).toFixed(0) + ' ft'
      : meters.toFixed(0) + ' m'
    : 'Unavailable';

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.overviewContent}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>BUSHMESH / DEVICE</Text>
        <Text style={styles.heroTitle}>Ready for the road?</Text>
        <Text style={styles.body}>
          One place for the phone, connected LoRa node, regional settings,
          offline resources and field troubleshooting.
        </Text>
        <Text style={[styles.phase, phase === 'error' && styles.warning]}>
          {phase.toUpperCase()} · {owner}
        </Text>
        <Text style={styles.body}>{snapshot.statusDetail}</Text>
      </View>

      <Block heading="Connected LoRa hardware">
        <Detail label="Node" value={snapshot.connectedDeviceLabel ?? ownership.deviceLabel ?? 'Not connected'} />
        <Detail label="Connection state" value={snapshot.status} warning={phase === 'error'} />
        <Detail label="BLE ownership" value={owner} />
        <Detail label="Android session" value={ownership.state.toUpperCase()} />
        <Detail label="Radio address" value={snapshot.connectedDeviceAddress ?? '—'} />
        <Detail label="Identity (public reference)" value={node?.bushMeshIdentityRef ?? '—'} />
        <Detail label="Hardware name" value={node?.deviceName ?? '—'} />
        <Detail label="Model" value={info?.model ?? 'Not reported'} />
        <Detail label="Firmware" value={info?.version ?? info?.firmwareBuild ?? 'Not reported'} />
        <Detail label="Companion protocol" value={info ? 'v' + info.firmwareVersion : '—'} />
        <Detail label="Contact capacity" value={info?.maxContacts == null ? '—' : String(info.maxContacts)} />
        <Detail label="Channel capacity" value={info?.maxChannels == null ? '—' : String(info.maxChannels)} />
        <Detail label="TX capability" value={node ? 'Maximum ' + node.maxTxPower + ' dBm' : '—'} />
        {quality ? <Detail label="GATT characteristics" value={
          quality.serviceFound && quality.rxFound && quality.txFound ? 'Ready' : 'Partial discovery'
        } /> : null}
        {ownership.errorMessage ? (
          <Text style={styles.warning}>{ownership.errorMessage}</Text>
        ) : null}
        <TouchableOpacity style={styles.action} onPress={() => onOpen('connection')}>
          <Text style={styles.actionText}>MANAGE BACKGROUND RADIO / BLE</Text>
        </TouchableOpacity>
      </Block>

      <Block heading="Battery & telemetry">
        <Detail label="Node battery" value={
          battery ? battery.batteryVolts.toFixed(2) + ' V (' + battery.batteryMv + ' mV)'
          : 'Not read'
        } />
        <Detail label="Node storage used" value={
          battery?.storagePercent == null ? 'Not reported' : battery.storagePercent + '%'
        } />
        <Detail label="Device storage" value={
          battery?.usedStorageKb == null || battery.totalStorageKb == null
            ? 'Not reported'
            : battery.usedStorageKb + ' / ' + battery.totalStorageKb + ' KB'
        } />
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.action, (!connected || batteryPending || snapshot.isWriting) && styles.dim]}
          disabled={!connected || batteryPending || snapshot.isWriting}
          onPress={() => {updateBattery().catch(() => undefined);}}>
          <Text style={styles.actionText}>{batteryPending ? 'READING…' : 'READ NODE TELEMETRY'}</Text>
        </TouchableOpacity>
        {batteryMessage ? <Text style={styles.body}>{batteryMessage}</Text> : null}
      </Block>

      <Block heading="Location / GPS">
        <Detail label="Location session" value={gpsStatus} />
        <Detail label="Android native GPS" value={nativeGpsSupported ? 'Supported' : 'Unavailable'} />
        <Detail label="Last fix accuracy" value={accuracy} />
        <Text style={styles.label}>Distance units (Device readouts)</Text>
        <View style={styles.buttonRow}>
          {(['metric', 'imperial'] as const).map(unit => (
            <TouchableOpacity
              key={unit}
              accessibilityRole="button"
              onPress={() => devicePreferences.update({distanceUnit: unit}).catch(() => undefined)}
              style={[styles.unitButton, prefs.distanceUnit === unit && styles.unitActive]}>
              <Text style={[styles.unitText, prefs.distanceUnit === unit && styles.unitTextActive]}>
                {unit === 'metric' ? 'Metric' : 'Imperial'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.body}>GPS starts only when you explicitly request it. Your location will never auto-select a radio frequency.</Text>
        <TouchableOpacity style={styles.action} onPress={() => onOpen('location')}>
          <Text style={styles.actionText}>OPEN GPS SETTINGS / CONTROLS</Text>
        </TouchableOpacity>
      </Block>

      <Block heading="Offline storage">
        <Detail label="Verified map packs" value={String(packCatalog.filter(p => p.installState === 'ready').length)} />
        <Detail label="Map-state persistence" value={mapPersistenceStatus} />
        <Detail label="Native map installer" value={mapPackInstallSupported ? 'Available' : 'Unavailable'} />
        <TouchableOpacity style={styles.action} onPress={() => onOpen('storage')}>
          <Text style={styles.actionText}>MANAGE OFFLINE MAP PACKS</Text>
        </TouchableOpacity>
      </Block>

      <Block heading="Radio & troubleshooting">
        <Text style={styles.body}>Review the region catalog, compare exact RF parameters and verify every write against the active MeshCore node.</Text>
        <TouchableOpacity style={styles.action} onPress={() => onOpen('radio')}>
          <Text style={styles.actionText}>REGIONAL / ADVANCED RADIO SETTINGS</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.action} onPress={() => onOpen('diagnostics')}>
          <Text style={styles.actionText}>FIELD REPORT & PHONE DIAGNOSTICS</Text>
        </TouchableOpacity>
      </Block>

      {!devicePreferences.isSupported() ? (
        <Text style={styles.warning}>
          Device preferences are temporary on this platform; Android persistence API not available.
        </Text>
      ) : devicePreferences.getError() ? (
        <Text style={styles.warning}>{devicePreferences.getError()}</Text>
      ) : null}
    </ScrollView>
  );
}

export function DeviceHubScreen(): React.JSX.Element {
  const [section, setSection] = useState<DeviceSection>('overview');
  const {snapshot} = useRadioConnection();
  const [ownership, setOwnership] = useState(
    nativeMeshCoreSessionCoordinator.getSnapshot(),
  );

  useEffect(() => nativeMeshCoreSessionCoordinator.subscribe(() => {
    setOwnership(nativeMeshCoreSessionCoordinator.getSnapshot());
  }), []);

  const nativeOwnsRadio =
    ownership.state === 'active' ||
    ownership.state === 'taking-over' ||
    ownership.state === 'stopping' ||
    snapshot.connectionOwner === 'android-native';

  return (
    <FieldEventTraceProvider>
      <FieldDiagnosticsCaptureProvider>
        <View style={styles.screen}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={styles.navScroll} contentContainerStyle={styles.navContent}>
            {sections.map(item => {
              const disabled = item.id === 'legacy' && nativeOwnsRadio;
              return (
                <TouchableOpacity key={item.id} accessibilityRole="button"
                  accessibilityState={{selected: section === item.id, disabled}}
                  style={[styles.navItem, section === item.id && styles.navActive,
                    disabled && styles.dim]}
                  disabled={disabled}
                  onPress={() => setSection(item.id)}>
                  <Text style={[styles.navText, section === item.id && styles.navTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {section === 'legacy' && nativeOwnsRadio ? (
            <Text style={styles.warning}>
              Android currently owns the radio; stop it in Background Radio before using legacy JS BLE tools.
            </Text>
          ) : null}
          <View style={styles.bodyContainer}>
            {section === 'overview' ? (
              <DeviceOverview onOpen={setSection} />
            ) : section === 'connection' ? (
              <NativeRadioSetupScreen />
            ) : section === 'radio' ? (
              <RadioSettingsScreen />
            ) : section === 'location' ? (
              <LocationScreen />
            ) : section === 'storage' ? (
              <ScrollView style={styles.scroll} contentContainerStyle={styles.overviewContent}>
                <Text style={styles.heroTitle}>Offline maps & storage</Text>
                <Text style={styles.body}>
                  Download and verify offline map packs using BushMesh’s existing map installer.
                  This screen does not start or stop any radio session.
                </Text>
                <MapPackCatalogPanel />
              </ScrollView>
            ) : section === 'diagnostics' ? (
              <ScrollView style={styles.scroll} contentContainerStyle={styles.overviewContent}>
                <Text style={styles.heroTitle}>Device diagnostics</Text>
                <PhoneRuntimeHealthCard />
                <FieldSupportSnapshot />
                <View style={styles.reportContainer}><FieldDiagnosticsScreen /></View>
              </ScrollView>
            ) : nativeOwnsRadio ? (
              <DeviceOverview onOpen={setSection} />
            ) : (
              <DeviceScreen />
            )}
          </View>
        </View>
      </FieldDiagnosticsCaptureProvider>
    </FieldEventTraceProvider>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  navScroll: {flexGrow: 0, backgroundColor: colors.background},
  navContent: {paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12, gap: 7},
  navItem: {backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: 12, minHeight: 40, justifyContent: 'center', paddingHorizontal: 13},
  navActive: {backgroundColor: colors.accent, borderColor: colors.accent},
  navText: {fontSize: 11, fontWeight: '800', color: colors.textSecondary},
  navTextActive: {color: colors.background},
  dim: {opacity: 0.4},
  bodyContainer: {flex: 1},
  scroll: {flex: 1},
  overviewContent: {padding: 14, paddingBottom: 40, gap: 13},
  hero: {backgroundColor: colors.surfaceSoft, padding: 18, borderRadius: 18, gap: 7},
  eyebrow: {fontSize: 10, fontWeight: '900', color: colors.accent, letterSpacing: 1},
  heroTitle: {fontSize: 22, fontWeight: '900', color: colors.textPrimary},
  phase: {fontSize: 12, fontWeight: '900', color: colors.success, marginTop: 5},
  body: {fontSize: 11, lineHeight: 17, color: colors.textSecondary, marginTop: 4},
  card: {backgroundColor: colors.surface, borderColor: colors.border,
    borderWidth: 1, borderRadius: 16, padding: 14, gap: 4},
  heading: {fontSize: 15, fontWeight: '900', color: colors.textPrimary, marginBottom: 6},
  detailRow: {flexDirection: 'row', gap: 12, borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 7},
  detailLabel: {flex: 1, fontSize: 11, color: colors.textMuted},
  detailValue: {flex: 1, fontSize: 11, textAlign: 'right', color: colors.textPrimary},
  warning: {color: colors.warning, fontSize: 11, lineHeight: 17, paddingHorizontal: 8},
  action: {borderColor: colors.border, borderWidth: 1, borderRadius: 11,
    alignItems: 'center', padding: 12, marginTop: 9},
  actionText: {fontSize: 10, fontWeight: '900', color: colors.accent},
  label: {fontSize: 11, color: colors.textSecondary, marginTop: 7},
  buttonRow: {flexDirection: 'row', gap: 8, marginTop: 6},
  unitButton: {flex: 1, padding: 10, borderRadius: 9, borderColor: colors.border,
    borderWidth: 1, alignItems: 'center'},
  unitActive: {backgroundColor: colors.accent, borderColor: colors.accent},
  unitText: {color: colors.textSecondary, fontSize: 11},
  unitTextActive: {color: colors.background, fontWeight: '900'},
  reportContainer: {height: 900},
});
