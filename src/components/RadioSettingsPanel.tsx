import React, {useEffect, useMemo, useState} from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  MESHCORE_RECOMMENDED_REGION_PROFILES,
  formatBandwidth,
  formatMeshCoreRadioParams,
  validateMeshCoreRadioParams,
  validateMeshCoreTxPower,
} from '../meshcore/meshcoreRadioSettings';
import {useBushMesh} from '../state/BushMeshContext';
import {useRadioConnection} from '../state/RadioConnectionContext';
import {colors} from '../theme/colors';

function finiteField(value: string, label: string): number {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid number.`);
  return parsed;
}

export function RadioSettingsPanel(): React.JSX.Element {
  const {activeChannelIndex} = useBushMesh();
  const {
    snapshot,
    refreshRadioSettings,
    applyAndVerifyRadioSettings,
  } = useRadioConnection();
  const {selfInfo, deviceInfo, isWriting} = snapshot;

  const [frequency, setFrequency] = useState('');
  const [bandwidth, setBandwidth] = useState('');
  const [spreadingFactor, setSpreadingFactor] = useState('');
  const [codingRate, setCodingRate] = useState('');
  const [txPower, setTxPower] = useState('');
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(
    'Load the current node profile before making manual RF changes.',
  );

  useEffect(() => {
    if (!selfInfo || dirty) return;
    setFrequency(
      selfInfo.frequencyMhz === null ? '' : selfInfo.frequencyMhz.toFixed(3),
    );
    setBandwidth(
      selfInfo.bandwidthKhz === null ? '' : String(selfInfo.bandwidthKhz),
    );
    setSpreadingFactor(
      selfInfo.spreadingFactor === null ? '' : String(selfInfo.spreadingFactor),
    );
    setCodingRate(
      selfInfo.codingRate === null ? '' : String(selfInfo.codingRate),
    );
    setTxPower(String(selfInfo.txPower));
  }, [selfInfo, dirty]);

  const preview = useMemo(() => {
    try {
      const params = validateMeshCoreRadioParams({
        frequencyMhz: finiteField(frequency, 'Frequency'),
        bandwidthKhz: finiteField(bandwidth, 'Bandwidth'),
        spreadingFactor: finiteField(spreadingFactor, 'Spreading factor'),
        codingRate: finiteField(codingRate, 'Coding rate'),
      });
      const txPowerDbm = validateMeshCoreTxPower(
        finiteField(txPower, 'TX power'),
        selfInfo?.maxTxPower,
      );
      return {params, txPowerDbm, error: null};
    } catch (error) {
      return {
        params: null,
        txPowerDbm: null,
        error: error instanceof Error ? error.message : 'Radio profile is invalid.',
      };
    }
  }, [frequency, bandwidth, spreadingFactor, codingRate, txPower, selfInfo?.maxTxPower]);

  const markDirty = (setter: (value: string) => void) => (value: string) => {
    setDirty(true);
    setStatus('Review the complete resulting profile below before applying.');
    setter(value);
  };

  const refresh = async () => {
    setStatus('Reading SELF_INFO and DEVICE_INFO from the connected node…');
    try {
      const result = await refreshRadioSettings();
      setDirty(false);
      setFrequency(result.selfInfo.frequencyMhz?.toFixed(3) ?? '');
      setBandwidth(
        result.selfInfo.bandwidthKhz === null
          ? ''
          : String(result.selfInfo.bandwidthKhz),
      );
      setSpreadingFactor(
        result.selfInfo.spreadingFactor === null
          ? ''
          : String(result.selfInfo.spreadingFactor),
      );
      setCodingRate(
        result.selfInfo.codingRate === null
          ? ''
          : String(result.selfInfo.codingRate),
      );
      setTxPower(String(result.selfInfo.txPower));
      setStatus(`Radio profile refreshed: ${result.summary}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Radio profile refresh failed.');
    }
  };

  const apply = async () => {
    if (!preview.params || preview.txPowerDbm === null) {
      setStatus(preview.error ?? 'Radio profile is invalid.');
      return;
    }
    setStatus('Applying physical radio parameters, then reading them back…');
    try {
      const result = await applyAndVerifyRadioSettings({
        frequencyMhz: preview.params.frequencyMhz,
        bandwidthKhz: preview.params.bandwidthKhz,
        spreadingFactor: preview.params.spreadingFactor,
        codingRate: preview.params.codingRate,
        txPowerDbm: preview.txPowerDbm,
      });
      setDirty(false);
      setFrequency(result.selfInfo.frequencyMhz?.toFixed(3) ?? '');
      setBandwidth(
        result.selfInfo.bandwidthKhz === null
          ? ''
          : String(result.selfInfo.bandwidthKhz),
      );
      setSpreadingFactor(
        result.selfInfo.spreadingFactor === null
          ? ''
          : String(result.selfInfo.spreadingFactor),
      );
      setCodingRate(
        result.selfInfo.codingRate === null
          ? ''
          : String(result.selfInfo.codingRate),
      );
      setTxPower(String(result.selfInfo.txPower));
      setStatus(
        `Radio profile verified: ${result.summary} · TX ${result.selfInfo.txPower} dBm`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Radio profile update failed.');
    }
  };

  const repeatLabel =
    deviceInfo?.clientRepeat === 1
      ? 'enabled'
      : deviceInfo?.clientRepeat === 0
        ? 'disabled'
        : 'not reported';

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>RADIO SETTINGS</Text>
      <Text style={styles.title}>Physical LoRa profile</Text>
      <Text style={styles.body}>
        Changes here affect the MeshCore physical radio only. Private channels,
        the active convoy carrier PSK, convoy membership and BushMesh Security v1
        material are not rewritten.
      </Text>

      <View style={styles.currentBox}>
        <Text style={styles.heading}>Current node profile</Text>
        <Text style={styles.value}>
          Frequency: {selfInfo?.frequencyMhz == null ? '—' : `${selfInfo.frequencyMhz.toFixed(3)} MHz`}
        </Text>
        <Text style={styles.value}>
          Bandwidth: {selfInfo?.bandwidthKhz == null ? '—' : `${formatBandwidth(selfInfo.bandwidthKhz)} kHz`}
        </Text>
        <Text style={styles.value}>
          SF: {selfInfo?.spreadingFactor ?? '—'} · CR: {selfInfo?.codingRate ?? '—'}
        </Text>
        <Text style={styles.value}>
          TX: {selfInfo ? `${selfInfo.txPower} dBm` : '—'} · maximum {selfInfo ? `${selfInfo.maxTxPower} dBm` : '—'}
        </Text>
        <Text style={styles.value}>
          Companion protocol: {deviceInfo?.firmwareVersion ?? '—'} · client repeat: {repeatLabel}
        </Text>
        <Text style={styles.value}>
          Active BushMesh carrier slot: {activeChannelIndex ?? 'none'}
        </Text>
        <TouchableOpacity
          style={[styles.secondaryButton, isWriting && styles.disabled]}
          disabled={isWriting}
          onPress={() => refresh().catch(() => undefined)}>
          <Text style={styles.secondaryButtonText}>REFRESH RADIO PROFILE</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Recommended region profile</Text>
        <Text style={styles.bodyCompact}>
          Region support is modeled as complete, versioned profiles including
          frequency, bandwidth, SF, CR and TX guidance. No country-to-single-frequency
          preset is hard-coded in this hardware-validation build.
        </Text>
        <Text style={styles.meta}>
          Available presets: {MESHCORE_RECOMMENDED_REGION_PROFILES.length}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Advanced / Manual radio profile</Text>
        <Text style={styles.warning}>
          Manual RF settings can break interoperability and may be subject to regional
          spectrum and power rules. Confirm the profile is appropriate for your hardware
          and operating location.
        </Text>

        <Text style={styles.inputLabel}>Frequency MHz</Text>
        <TextInput
          style={styles.input}
          value={frequency}
          onChangeText={markDirty(setFrequency)}
          keyboardType="decimal-pad"
          placeholder="916.580"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.inputLabel}>Bandwidth kHz</Text>
        <TextInput
          style={styles.input}
          value={bandwidth}
          onChangeText={markDirty(setBandwidth)}
          keyboardType="decimal-pad"
          placeholder="62.5"
          placeholderTextColor={colors.textMuted}
        />
        <View style={styles.row}>
          <View style={styles.half}>
            <Text style={styles.inputLabel}>Spreading Factor</Text>
            <TextInput
              style={styles.input}
              value={spreadingFactor}
              onChangeText={markDirty(setSpreadingFactor)}
              keyboardType="number-pad"
              placeholder="8"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={styles.half}>
            <Text style={styles.inputLabel}>Coding Rate</Text>
            <TextInput
              style={styles.input}
              value={codingRate}
              onChangeText={markDirty(setCodingRate)}
              keyboardType="number-pad"
              placeholder="5"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </View>
        <Text style={styles.inputLabel}>TX power dBm</Text>
        <TextInput
          style={styles.input}
          value={txPower}
          onChangeText={markDirty(setTxPower)}
          keyboardType="numbers-and-punctuation"
          placeholder="TX dBm"
          placeholderTextColor={colors.textMuted}
        />

        <View style={styles.previewBox}>
          <Text style={styles.previewLabel}>COMPLETE RESULTING PROFILE</Text>
          {preview.params && preview.txPowerDbm !== null ? (
            <Text style={styles.previewValue}>
              {formatMeshCoreRadioParams(preview.params)} · TX {preview.txPowerDbm} dBm
            </Text>
          ) : (
            <Text style={styles.error}>{preview.error}</Text>
          )}
          <Text style={styles.meta}>
            Client repeat will remain {repeatLabel}; BushMesh does not toggle it as a side effect.
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.primaryButton,
            (isWriting || !preview.params || preview.txPowerDbm === null) &&
              styles.disabled,
          ]}
          disabled={isWriting || !preview.params || preview.txPowerDbm === null}
          onPress={() => apply().catch(() => undefined)}>
          <Text style={styles.primaryButtonText}>APPLY AND VERIFY</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.status}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  eyebrow: {color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.1},
  title: {color: colors.textPrimary, fontSize: 20, fontWeight: '900'},
  heading: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  body: {color: colors.textSecondary, fontSize: 12, lineHeight: 18},
  bodyCompact: {color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 6},
  currentBox: {backgroundColor: colors.surfaceSoft, borderRadius: 14, padding: 12},
  section: {borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12},
  value: {color: colors.textSecondary, fontSize: 11, marginTop: 5},
  meta: {color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 7},
  warning: {color: colors.warning, fontSize: 11, lineHeight: 17, marginTop: 6},
  inputLabel: {color: colors.textMuted, fontSize: 10, fontWeight: '800', marginTop: 9},
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    marginTop: 4,
  },
  row: {flexDirection: 'row', gap: 10},
  half: {flex: 1},
  previewBox: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 13,
    padding: 11,
  },
  previewLabel: {color: colors.accent, fontSize: 9, fontWeight: '900'},
  previewValue: {color: colors.textPrimary, fontSize: 12, lineHeight: 18, marginTop: 5, fontWeight: '800'},
  error: {color: colors.danger, fontSize: 11, lineHeight: 16, marginTop: 5},
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 13,
    marginTop: 10,
  },
  primaryButtonText: {color: colors.background, fontWeight: '900', fontSize: 12},
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 10,
  },
  secondaryButtonText: {color: colors.textSecondary, fontWeight: '900', fontSize: 10},
  disabled: {opacity: 0.4},
  status: {color: colors.textSecondary, fontSize: 11, lineHeight: 17},
});
