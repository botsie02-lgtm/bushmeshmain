import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';

import {
  MESHCORE_DOCUMENTED_EXAMPLE,
  RegionCatalog,
  RadioProfileWithTx,
  assertReadBackMatches,
  compareRadioProfiles,
  loadLiveMeshCoreRegionCatalog,
  proposeRegionProfile,
  readCompleteDeviceProfile,
  validateProposedProfile,
} from '../device/regionProfiles';
import {devicePreferences} from '../device/devicePreferences';
import {deviceConnectionPhase} from '../device/deviceConnectionHealth';
import {nativeMeshCoreSessionCoordinator} from '../meshcore/NativeMeshCoreSessionCoordinator';
import {DevicePreferences} from '../device/devicePreferenceCodec';
import {MeshCoreSelfInfo} from '../meshcore/meshcoreSelfInfo';
import {formatMeshCoreRadioParams} from '../meshcore/meshcoreRadioSettings';
import {useRadioConnection} from '../state/RadioConnectionContext';
import {colors} from '../theme/colors';

type Draft = {
  frequencyMhz: string;
  bandwidthKhz: string;
  spreadingFactor: string;
  codingRate: string;
  txPowerDbm: string;
};

function toDraft(profile: RadioProfileWithTx): Draft {
  return {
    frequencyMhz: profile.frequencyMhz.toFixed(3),
    bandwidthKhz: String(profile.bandwidthKhz),
    spreadingFactor: String(profile.spreadingFactor),
    codingRate: String(profile.codingRate),
    txPowerDbm: String(profile.txPowerDbm),
  };
}

function requiredNumber(input: string, label: string): number {
  if (!input.trim()) throw new Error(label + ' is required.');
  const value = Number(input.trim());
  if (!Number.isFinite(value)) throw new Error(label + ' must be a finite number.');
  return value;
}

function parseManual(draft: Draft, maxTxPower: number): RadioProfileWithTx {
  return validateProposedProfile({
    frequencyMhz: requiredNumber(draft.frequencyMhz, 'Frequency'),
    bandwidthKhz: requiredNumber(draft.bandwidthKhz, 'Bandwidth'),
    spreadingFactor: requiredNumber(draft.spreadingFactor, 'Spreading factor'),
    codingRate: requiredNumber(draft.codingRate, 'Coding rate'),
    txPowerDbm: requiredNumber(draft.txPowerDbm, 'TX power'),
  }, maxTxPower);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Radio operation failed.';
}

function Action({
  title, onPress, disabled = false, primary = false,
}: {title: string; onPress: () => void; disabled?: boolean; primary?: boolean}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{disabled}}
      style={[styles.action, primary && styles.actionPrimary, disabled && styles.dim]}
      onPress={onPress}
      disabled={disabled}>
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}

export function RadioSettingsPanel(): React.JSX.Element {
  const {
    snapshot, refreshRadioSettings, applyAndVerifyRadioSettings,
  } = useRadioConnection();
  const [catalog, setCatalog] = useState<RegionCatalog>(MESHCORE_DOCUMENTED_EXAMPLE);
  const [nativeState, setNativeState] = useState(
    nativeMeshCoreSessionCoordinator.getSnapshot().state,
  );
  useEffect(() => nativeMeshCoreSessionCoordinator.subscribe(() => {
    setNativeState(nativeMeshCoreSessionCoordinator.getSnapshot().state);
  }), []);
  const [catalogState, setCatalogState] = useState('Checking the MeshCore app API…');
  const [stored, setStored] = useState<DevicePreferences>(devicePreferences.getSnapshot());
  const [currentRead, setCurrentRead] = useState<MeshCoreSelfInfo | null>(null);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Read the connected node before applying any radio settings.');
  const [advancedVisible, setAdvancedVisible] = useState(false);
  const connectionKey = snapshot.connectionOwner + ':' + (snapshot.connectedDeviceAddress ?? '');
  const connectionKeyRef = useRef(connectionKey);
  connectionKeyRef.current = connectionKey;

  useEffect(() => {
    let active = true;
    const unsubscribe = devicePreferences.subscribe(() => {
      if (active) setStored(devicePreferences.getSnapshot());
    });
    devicePreferences.initialize().catch(() => undefined);
    return () => { active = false; unsubscribe(); };
  }, []);

  const loadCatalog = async () => {
    setCatalogState('Loading current community presets from MeshCore…');
    try {
      const next = await loadLiveMeshCoreRegionCatalog();
      setCatalog(next);
      setCatalogState(
        'Live MeshCore API · ' + next.profiles.length + ' complete presets · rev ' +
        next.revision + (next.rejectedEntries ? ' · ' + next.rejectedEntries + ' invalid entries excluded' : ''),
      );
    } catch (error) {
      setCatalog(MESHCORE_DOCUMENTED_EXAMPLE);
      setCatalogState('Offline example only: ' + errorText(error));
    }
  };

  useEffect(() => {
    let active = true;
    loadLiveMeshCoreRegionCatalog().then(next => {
      if (!active) return;
      setCatalog(next);
      setCatalogState('Live MeshCore API · ' + next.profiles.length + ' presets · rev ' + next.revision);
    }).catch(error => {
      if (active) setCatalogState('Offline documentation example, NOT live: ' + errorText(error));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    // Never carry a verified read across reconnect, handoff or a different node.
    setCurrentRead(null);
    setDraft(null);
    setManual(false);
    setStatus('Read this connected node before reviewing or applying settings.');
  }, [connectionKey]);

  const ready = deviceConnectionPhase(snapshot, nativeState) === 'ready' && !busy;
  const current = useMemo(() => {
    if (!currentRead) return null;
    try { return readCompleteDeviceProfile(currentRead); }
    catch { return null; }
  }, [currentRead]);

  const selected = catalog.profiles.find(p => p.id === stored.selectedPresetId) ?? null;
  const proposal = useMemo(() => {
    if (!currentRead || !current) {
      return {profile: null, error: 'Refresh the physical node profile first.'};
    }
    try {
      if (!manual) {
        if (!selected) return {profile: null, error: 'Select a regional preset first.'};
        return {profile: proposeRegionProfile(selected, currentRead), error: null};
      }
      if (!draft) return {profile: null, error: 'Load current settings into the manual editor first.'};
      return {profile: parseManual(draft, currentRead.maxTxPower), error: null};
    } catch (error) {
      return {profile: null, error: errorText(error)};
    }
  }, [current, currentRead, manual, selected, draft]);

  const comparison = current && proposal.profile
    ? compareRadioProfiles(current, proposal.profile) : [];
  const changed = comparison.some(row => row.changed);
  const applicable = ready && current !== null && proposal.profile !== null && changed &&
    (manual || catalog.source === 'meshcore-api');
  const beforeDisplay = stored.previousVerified?.nodeIdentityRef ===
    snapshot.selfInfo?.bushMeshIdentityRef ? stored.previousVerified : null;

  const refresh = async () => {
    if (!ready) return;
    setBusy(true);
    setStatus('Reading SELF_INFO and DEVICE_INFO from the active session…');
    const startedConnection = connectionKey;
    try {
      const result = await refreshRadioSettings();
      const profile = readCompleteDeviceProfile(result.selfInfo);
      if (connectionKeyRef.current !== startedConnection) {
        throw new Error('Radio owner changed during the refresh. Read again.');
      }
      setCurrentRead(result.selfInfo);
      setDraft(toDraft(profile));
      setStatus('Node profile read. Choose a regional preset or manual override.');
    } catch (error) {
      setCurrentRead(null);
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!applicable || !currentRead || !current || !proposal.profile) return;
    const proposed = {...proposal.profile};
    const previous = {...current};
    const nodeIdentityRef = currentRead.bushMeshIdentityRef;
    const startedConnection = connectionKey;
    setBusy(true);
    setStatus('Applying radio parameters and verifying physical read-back…');
    try {
      // Radio connection service owns both Android and legacy sessions. Never
      // open BLE or stop/start the native service from this UI.
      const result = await applyAndVerifyRadioSettings(proposed);
      assertReadBackMatches(proposed, result.selfInfo);
      if (result.selfInfo.bushMeshIdentityRef !== nodeIdentityRef ||
          connectionKeyRef.current !== startedConnection) {
        throw new Error('Node identity/owner changed during apply; refresh before retrying.');
      }
      setCurrentRead(result.selfInfo);
      setDraft(toDraft(proposed));
      setStatus('VERIFIED by device read-back: ' +
        formatMeshCoreRadioParams(proposed) + ' · TX ' + proposed.txPowerDbm + ' dBm.');
      // Only record non-secret physical RF values, scoped to the public node ref.
      try {
        await devicePreferences.update({previousVerified: {
          nodeIdentityRef, profile: previous, verifiedAt: new Date().toISOString(),
        }});
      } catch {
        setStatus('Device profile verified, but the previous-profile preference could not be saved.');
      }
    } catch (error) {
      // On a failed write, the actual physical state may be unknown. Force a
      // new read rather than presenting the stale snapshot as verified.
      setCurrentRead(null);
      setStatus('Apply/verify failed: ' + errorText(error) +
        ' Refresh the node before any further write.');
    } finally {
      setBusy(false);
    }
  };

  const selectPreset = (id: string) => {
    setManual(false);
    setStatus('Review all five resulting radio parameters before applying.');
    devicePreferences.update({selectedPresetId: id}).catch(error => {
      setStatus('Preset selected locally; saving preference failed: ' + errorText(error));
    });
  };

  const setManualField = (key: keyof Draft, value: string) => {
    setDraft(prev => prev ? {...prev, [key]: value} : null);
    setStatus('Review the exact resulting values before applying manual changes.');
  };

  const deviceInfo = snapshot.deviceInfo;
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>DEVICE / RADIO CONFIGURATION</Text>
      <Text style={styles.title}>LoRa profile</Text>
      <Text style={styles.body}>
        Uses the existing MeshCore session and verified read-back. Switching
        frequency may disconnect you from your convoy until every node is configured.
      </Text>

      <View style={styles.subCard}>
        <Text style={styles.heading}>Physical node (reported)</Text>
        <Text style={styles.value}>
          {snapshot.selfInfo?.frequencyMhz != null &&
           snapshot.selfInfo?.bandwidthKhz != null &&
           snapshot.selfInfo?.spreadingFactor != null &&
           snapshot.selfInfo?.codingRate != null
            ? formatMeshCoreRadioParams({
                frequencyMhz: snapshot.selfInfo.frequencyMhz,
                bandwidthKhz: snapshot.selfInfo.bandwidthKhz,
                spreadingFactor: snapshot.selfInfo.spreadingFactor,
                codingRate: snapshot.selfInfo.codingRate,
              })
            : 'No complete SELF_INFO available'}
        </Text>
        <Text style={styles.value}>TX {snapshot.selfInfo?.txPower ?? '—'} dBm · hardware max {snapshot.selfInfo?.maxTxPower ?? '—'} dBm</Text>
        <Text style={styles.value}>Protocol v{deviceInfo?.firmwareVersion ?? '—'} · repeat {deviceInfo?.clientRepeat === 1 ? 'on' : deviceInfo?.clientRepeat === 0 ? 'off' : 'unknown'}</Text>
        <Text style={styles.value}>Device read-back: {currentRead && current ? 'fresh for this session' : 'required before apply'}</Text>
        <Action title={busy ? 'READING / WRITING…' : 'READ CURRENT DEVICE PROFILE'} onPress={() => {refresh().catch(() => undefined);}} disabled={!ready} />
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Choose a regional preset</Text>
        <Text style={styles.body}>{catalog.info}</Text>
        <Text style={styles.meta}>{catalogState}</Text>
        <Text style={styles.meta}>Source: {catalog.sourceUrl}</Text>
        <Action title="REFRESH MESHCORE PRESETS" onPress={() => {loadCatalog().catch(() => undefined);}} />
        <ScrollView style={styles.presetList} nestedScrollEnabled>
          {catalog.profiles.map(p => (
            <TouchableOpacity
              accessibilityRole="button"
              key={p.id}
              onPress={() => selectPreset(p.id)}
              style={[styles.presetRow, !manual && p.id === selected?.id && styles.presetSelected]}>
              <Text style={styles.presetName}>{!manual && p.id === selected?.id ? '● ' : '○ '}{p.label}</Text>
              <Text style={styles.meta}>
                {formatMeshCoreRadioParams(p.settings)} · TX retain node setting
              </Text>
              {p.pathHashSize !== null ? (
                <Text style={styles.warning}>Also suggests {p.pathHashSize}-byte path hashes (not changed here).</Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={styles.warning}>
          MeshCore community presets are suggestions, not proof of local
          compliance. Australia: check the ACMA LIPD Class Licence 2025,
          equipment/antenna EIRP and any radio-quiet zone restrictions. GPS never changes RF automatically.
        </Text>
      </View>

      <View style={styles.section}>
        <Action
          title={advancedVisible ? 'HIDE ADVANCED / MANUAL' : 'SHOW ADVANCED / MANUAL'}
          onPress={() => setAdvancedVisible(value => !value)}
        />
        {advancedVisible ? (
          <>
            <Action
              title={manual ? 'MANUAL OVERRIDE ACTIVE' : 'EDIT COMPLETE PROFILE MANUALLY'}
              onPress={() => {
                if (!current) return;
                setManual(true);
                setDraft(toDraft(current));
                setStatus('Manual radio settings are active. Check the exact comparison.');
              }}
              disabled={!current || busy}
            />
            {manual && draft ? (
              <>
                {([
                  ['frequencyMhz', 'Frequency (MHz)'],
                  ['bandwidthKhz', 'Bandwidth (kHz)'],
                  ['spreadingFactor', 'Spreading factor'],
                  ['codingRate', 'Coding rate (5–8)'],
                  ['txPowerDbm', 'TX power (dBm)'],
                ] as Array<[keyof Draft, string]>).map(([key, label]) => (
                  <View key={key}>
                    <Text style={styles.inputLabel}>{label}</Text>
                    <TextInput
                      style={styles.input}
                      value={draft[key]}
                      keyboardType="numbers-and-punctuation"
                      onChangeText={value => setManualField(key, value)}
                      placeholderTextColor={colors.textMuted}
                    />
                  </View>
                ))}
              </>
            ) : null}
            <Text style={styles.warning}>
              Hardware max TX limits are checked here. Antenna gain, amplifier
              output, EIRP, duty-cycle and local spectrum compliance still need
              independent verification.
            </Text>
          </>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Exact proposed change</Text>
        <Text style={styles.meta}>
          {manual ? 'MANUAL OVERRIDE' : selected
            ? selected.label + ' · ' + selected.sourceRevision : 'NO PRESET SELECTED'}
        </Text>
        {proposal.profile && current ? (
          <>
            <View style={styles.compareHead}>
              <Text style={[styles.compareLabel, styles.compareTitle]}>Parameter</Text>
              <Text style={[styles.compareValue, styles.compareTitle]}>Current</Text>
              <Text style={[styles.compareValue, styles.compareTitle]}>Proposed</Text>
            </View>
            {comparison.map(row => (
              <View key={row.label} style={styles.compareHead}>
                <Text style={styles.compareLabel}>{row.label}</Text>
                <Text style={styles.compareValue}>{row.current}</Text>
                <Text style={[styles.compareValue, row.changed && styles.changed]}>{row.proposed}</Text>
              </View>
            ))}
            <Text style={styles.meta}>
              TX from current node unless manually overridden. Client-repeat,
              channel PSKs, identity and convoy membership remain untouched.
            </Text>
          </>
        ) : (
          <Text style={styles.warning}>{proposal.error}</Text>
        )}
        <Action title={busy ? 'VERIFYING…' : 'APPLY AND VERIFY ON DEVICE'}
          onPress={() => {apply().catch(() => undefined);}}
          primary disabled={!applicable} />
        {!manual && catalog.source !== 'meshcore-api' ? (
          <Text style={styles.warning}>
            Offline documentation examples are not live presets: load the official catalog
            or explicitly enter and verify a manual profile before writing.
          </Text>
        ) : null}
        {!changed && proposal.profile ? <Text style={styles.meta}>No RF changes proposed.</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Previous verified profile</Text>
        {beforeDisplay ? (
          <>
            <Text style={styles.value}>{formatMeshCoreRadioParams(beforeDisplay.profile)} · TX {beforeDisplay.profile.txPowerDbm} dBm</Text>
            <Text style={styles.meta}>Read from this node before the last verified update · {beforeDisplay.verifiedAt}</Text>
            <Text style={styles.meta}>For comparison only; never auto-restored.</Text>
          </>
        ) : (
          <Text style={styles.body}>No previous verified profile for this connected device.</Text>
        )}
      </View>
      <Text accessibilityRole="alert" style={styles.status}>{status}</Text>
      {devicePreferences.getError() ? <Text style={styles.warning}>{devicePreferences.getError()}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: 18, padding: 16, gap: 14},
  eyebrow: {fontSize: 10, fontWeight: '900', color: colors.accent, letterSpacing: 1},
  title: {fontSize: 22, fontWeight: '900', color: colors.textPrimary},
  body: {fontSize: 12, lineHeight: 18, color: colors.textSecondary},
  heading: {fontSize: 15, fontWeight: '800', color: colors.textPrimary, marginBottom: 6},
  subCard: {backgroundColor: colors.surfaceSoft, padding: 12, borderRadius: 12, gap: 7},
  value: {fontSize: 12, color: colors.textSecondary, lineHeight: 18},
  section: {borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 12, gap: 8},
  meta: {color: colors.textMuted, fontSize: 10, lineHeight: 15},
  warning: {color: colors.warning, fontSize: 11, lineHeight: 17},
  action: {padding: 12, borderColor: colors.border, borderWidth: 1, borderRadius: 10,
    alignItems: 'center', marginTop: 4},
  actionPrimary: {backgroundColor: colors.accent, borderColor: colors.accent},
  actionText: {fontSize: 10, fontWeight: '900', color: colors.textPrimary},
  actionTextPrimary: {color: colors.background},
  dim: {opacity: 0.35},
  presetList: {maxHeight: 290},
  presetRow: {borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 10, marginVertical: 3},
  presetSelected: {borderColor: colors.accent, backgroundColor: colors.surfaceSoft},
  presetName: {fontSize: 12, color: colors.textPrimary, fontWeight: '800'},
  inputLabel: {fontSize: 11, color: colors.textSecondary, marginTop: 6},
  input: {height: 42, borderWidth: 1, borderColor: colors.border, borderRadius: 9,
    paddingHorizontal: 12, color: colors.textPrimary},
  compareHead: {flexDirection: 'row', gap: 5, borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 6},
  compareLabel: {flex: 1.2, fontSize: 10, color: colors.textSecondary},
  compareValue: {flex: 1, fontSize: 10, color: colors.textSecondary},
  compareTitle: {fontWeight: '900', color: colors.textPrimary},
  changed: {fontWeight: '900', color: colors.accent},
  status: {fontSize: 11, lineHeight: 17, color: colors.textPrimary},
});
