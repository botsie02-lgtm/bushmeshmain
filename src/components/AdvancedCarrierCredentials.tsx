import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {
  ActiveConvoyCarrierProfile,
  buildCarrierCredentialDetails,
  MESHCORE_CARRIER_PSK_DISTINCTION,
  normalizeCarrierPskHex,
} from '../convoy/carrierCredentials';
import {sensitiveClipboard} from '../native/SensitiveClipboard';
import {useRadioConnection} from '../state/RadioConnectionContext';
import {useRadioSession} from '../state/RadioSessionContext';
import {colors} from '../theme/colors';

function CredentialRow({label, value}: {label: string; value: string}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

export function AdvancedCarrierCredentials({
  profile,
}: {
  profile: ActiveConvoyCarrierProfile;
}): React.JSX.Element {
  const {snapshot, revealChannelSecret} = useRadioConnection();
  const {snapshot: radioSession} = useRadioSession();
  const [revealedPsk, setRevealedPsk] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const details = useMemo(
    () => buildCarrierCredentialDetails(profile, radioSession.radioProfile),
    [profile, radioSession.radioProfile],
  );

  useEffect(() => {
    setRevealedPsk(null);
    setStatus(null);
  }, [profile.channelIndex, profile.channelName, profile.convoyId]);

  const reveal = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const configured = snapshot.channels.find(channel =>
        channel.channelIndex === String(profile.channelIndex) &&
        channel.channelName === profile.channelName &&
        channel.secret === 'Configured (redacted)',
      );
      if (!configured) {
        throw new Error('Configured channel changed. Refresh the radio channels before revealing a secret.');
      }
      const secretHex = normalizeCarrierPskHex(
        await revealChannelSecret(profile.channelIndex, profile.channelName),
      );
      setRevealedPsk(secretHex);
      setStatus('Carrier PSK revealed for this verified MeshCore channel slot.');
    } catch (error) {
      setRevealedPsk(null);
      setStatus(
        error instanceof Error ? error.message : 'Carrier PSK reveal failed.',
      );
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!revealedPsk) return;
    setBusy(true);
    try {
      await sensitiveClipboard.copy(revealedPsk);
      setStatus(
        'Carrier PSK copied to the system clipboard. Treat clipboard contents as sensitive.',
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Carrier PSK copy failed.',
      );
    } finally {
      setBusy(false);
    }
  };

  const hide = () => {
    setRevealedPsk(null);
    setStatus('Carrier PSK hidden.');
  };

  const canReveal = snapshot.status === 'Connected' && !snapshot.isWriting && !busy;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>ADVANCED CARRIER CREDENTIALS</Text>
      <Text style={styles.title}>Hardware / manual-node setup</Text>
      <Text style={styles.warning}>{MESHCORE_CARRIER_PSK_DISTINCTION}</Text>
      {profile.origin === 'recovered' ? (
        <Text style={styles.warning}>
          Read-only carrier recovery does not verify BushMesh convoy enrollment or Security v1 group membership.
        </Text>
      ) : null}

      <View style={styles.details}>
        <CredentialRow label="Convoy name" value={details.convoyName} />
        <CredentialRow label="MeshCore carrier" value={details.channelName} />
        <CredentialRow label="Channel slot" value={String(details.channelIndex)} />
        <CredentialRow label="Privacy" value={details.privacy} />
        <CredentialRow label="Carrier secret status" value={details.secretStatus} />
        <CredentialRow label="Radio frequency" value={details.frequency} />
        <CredentialRow label="Bandwidth" value={details.bandwidth} />
        <CredentialRow label="Spreading factor" value={details.spreadingFactor} />
        <CredentialRow label="Coding rate" value={details.codingRate} />
        <CredentialRow label="TX power" value={details.txPower} />
      </View>

      {revealedPsk ? (
        <View style={styles.secretBox}>
          <Text style={styles.secretLabel}>16-byte MeshCore carrier PSK</Text>
          <Text style={styles.secretHint}>32 hexadecimal characters</Text>
          <Text selectable style={styles.secretValue}>
            {revealedPsk}
          </Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.actionButton, busy && styles.disabled]}
              disabled={busy}
              onPress={() => {
                copy().catch(() => undefined);
              }}>
              <Text style={styles.actionButtonText}>COPY PSK</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={hide}>
              <Text style={styles.secondaryButtonText}>HIDE PSK</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.revealButton, !canReveal && styles.disabled]}
          disabled={!canReveal}
          onPress={() => {
            reveal().catch(() => undefined);
          }}>
          <Text style={styles.revealButtonText}>
            {busy ? 'READING CARRIER…' : 'REVEAL CARRIER PSK'}
          </Text>
        </TouchableOpacity>
      )}

      {snapshot.status !== 'Connected' ? (
        <Text style={styles.status}>
          Reconnect the verified MeshCore node to reveal its carrier PSK.
        </Text>
      ) : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 14,
    padding: 12,
  },
  eyebrow: {
    color: colors.warning,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {color: colors.textPrimary, fontSize: 15, fontWeight: '900', marginTop: 4},
  warning: {color: colors.warning, fontSize: 11, lineHeight: 17, marginTop: 8, fontWeight: '800'},
  details: {marginTop: 10, gap: 7},
  row: {flexDirection: 'row', gap: 10, alignItems: 'flex-start'},
  label: {flex: 1, color: colors.textMuted, fontSize: 10, fontWeight: '700'},
  value: {flex: 1, color: colors.textPrimary, fontSize: 10, fontWeight: '800', textAlign: 'right'},
  revealButton: {
    marginTop: 13,
    minHeight: 46,
    borderRadius: 13,
    backgroundColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revealButtonText: {color: colors.background, fontSize: 12, fontWeight: '900'},
  secretBox: {
    marginTop: 13,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 12,
    padding: 11,
  },
  secretLabel: {color: colors.warning, fontSize: 11, fontWeight: '900'},
  secretHint: {color: colors.textMuted, fontSize: 10, marginTop: 2},
  secretValue: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: 0.7,
    fontWeight: '900',
    marginTop: 9,
  },
  buttonRow: {flexDirection: 'row', gap: 8, marginTop: 11},
  actionButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {color: colors.background, fontSize: 11, fontWeight: '900'},
  secondaryButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {color: colors.textSecondary, fontSize: 11, fontWeight: '900'},
  status: {color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 9},
  disabled: {opacity: 0.45},
});
