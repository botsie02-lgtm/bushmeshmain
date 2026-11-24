import React, {useEffect, useRef, useState} from 'react';
import {AppState, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {useBushMesh} from '../../state/BushMeshContext';
import {useLocationSession} from '../../state/LocationSessionContext';
import {appRadioConnectionService} from '../../radio/AppRadioConnectionService';
import {colors} from '../../theme/colors';
import {ChannelFieldLocationSession, CHANNEL_FIELD_PRIVACY_WARNING,
  type ChannelFieldSnapshot} from './ChannelFieldLocationSession';
import {createExistingMeshCoreChannelPort, readRealAndroidLocation} from './existingPorts';
import {projectExplicitChannelMarkers} from './mapProjection';
import type {FieldChannelPosition} from '../../maps/fieldChannelPositionAdapter';

/** Foreground Map screen only. Consent is never persisted. No ownership changes. */
export function ConnectedChannelFieldLocation({onPositions}: {
  onPositions: (positions: FieldChannelPosition[]) => void;
}): React.JSX.Element {
  const location = useLocationSession();
  const {activeChannel} = useBushMesh();
  const latest = useRef({location, activeChannel});
  latest.current = {location, activeChannel};
  const [consent, setConsent] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [snapshot, setSnapshot] = useState<ChannelFieldSnapshot | null>(null);
  const running = useRef<{session: ChannelFieldLocationSession; unsubscribe: () => void} | null>(null);
  const mounted = useRef(true);
  const enabled = snapshot?.sharingEnabled === true;
  const usable = activeChannel?.secret === 'Configured (redacted)' &&
    location.providerLabel === 'Android GPS' &&
    (location.status === 'tracking' || location.status === 'tracking-no-link');

  function stop(message: string) {
    const prior = running.current;
    running.current = null;
    prior?.unsubscribe();
    prior?.session.dispose();
    if (mounted.current) {
      setSnapshot(null);
      setConsent(false);
      setBusy(false);
      setNotice(message);
      onPositions([]);
    }
  }

  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') stop('Stopped: app left the foreground. New consent required.');
    });
    return () => {
      mounted.current = false;
      sub.remove();
      const prior = running.current;
      running.current = null;
      prior?.unsubscribe();
      prior?.session.dispose();
    };
    // Screen lifetime only; onPositions is the stable MapScreen state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (running.current && !usable) stop('Stopped: GPS or private channel is unavailable.');
    // Never start/restart here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable]);

  async function start() {
    if (!consent || running.current || !usable || !activeChannel ||
        !/^[A-Za-z0-9_-]{1,12}$/.test(label) || AppState.currentState !== 'active') return;
    const target = appRadioConnectionService.getSnapshot();
    const channelIndex = Number(activeChannel.channelIndex);
    const channelName = activeChannel.channelName;
    const base = createExistingMeshCoreChannelPort();
    if (!target.connectedDeviceAddress || !base.isConnected() ||
        !base.isPrivateChannel(channelIndex) ||
        !target.channels.some(c => c.channelIndex === String(channelIndex) &&
          c.channelName === channelName && c.secret === 'Configured (redacted)')) {
      setConsent(false);
      setNotice('No matching ready private-channel radio session. Check Radio first.');
      return;
    }
    const scopeMatches = () => {
      const now = appRadioConnectionService.getSnapshot();
      const selected = latest.current.activeChannel;
      return AppState.currentState === 'active' && base.isConnected() &&
        now.connectedDeviceAddress === target.connectedDeviceAddress &&
        now.connectionOwner === target.connectionOwner &&
        selected?.channelIndex === String(channelIndex) &&
        selected?.channelName === channelName &&
        selected?.secret === 'Configured (redacted)' &&
        now.channels.some(c => c.channelIndex === String(channelIndex) &&
          c.channelName === channelName && c.secret === 'Configured (redacted)');
    };
    const session = new ChannelFieldLocationSession({
      ...base,
      isConnected: scopeMatches,
      isPrivateChannel: index => index === channelIndex && scopeMatches() && base.isPrivateChannel(index),
      sendChannelMessage: async (index, text) => {
        if (index !== channelIndex || !scopeMatches()) throw new Error('Field channel scope changed');
        await base.sendChannelMessage(index, text);
      },
    }, () => readRealAndroidLocation(latest.current.location));
    const record = {session, unsubscribe: () => {}};
    running.current = record;
    setBusy(true);
    setNotice('');
    record.unsubscribe = session.subscribe(() => {
      if (running.current !== record || !mounted.current) return;
      const next = session.snapshot();
      setSnapshot(next);
      onPositions(projectExplicitChannelMarkers(next.remoteMarkers, Date.now()));
      // start() first calls stop(); do not cancel the initial asynchronous setup.
      if (!next.sharingEnabled && !scopeMatches()) {
        stop('Stopped: radio/channel changed. New consent required.');
      }
    });
    const started = await session.start({
      channelIndex, claimedLabel: label, privacyWarningAccepted: true,
    }).catch(() => false);
    if (running.current !== record || !mounted.current) return;
    if (!started) {
      stop('Sharing unavailable: no verified local carrier readiness or random source.');
      return;
    }
    setBusy(false);
    setConsent(false);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>OPTIONAL CHANNEL-ONLY FIELD TEST · {enabled ? 'ON' : 'OFF'}</Text>
      <Text style={styles.warning}>{CHANNEL_FIELD_PRIVACY_WARNING}</Text>
      <Text style={styles.body}>Received coordinate text may be retained in ordinary encrypted Radio History. Labels are claims, not identities. Stop cannot recall commands already submitted to the radio. Leaving this map, backgrounding the app, or losing the radio stops sharing; reconnect never restarts it.</Text>
      <Text style={styles.body}>Selected carrier: {activeChannel?.channelName ?? 'None'} · {activeChannel?.channelIndex ?? '—'}. Start Android GPS manually in Device first. No GPS or radio owner is started here.</Text>
      {!enabled && !busy ? <>
        <TextInput accessibilityLabel="Unverified vehicle label" value={label}
          onChangeText={setLabel} maxLength={12} autoCapitalize="none"
          placeholder="Vehicle label (1–12 characters)" placeholderTextColor={colors.textSecondary} style={styles.input} />
        <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel="Accept unverified location sharing warning"
          accessibilityState={{checked: consent}} onPress={() => setConsent(v => !v)} style={styles.button}>
          <Text style={styles.text}>{consent ? '✓ ' : ''}I accept sharing my coordinates on this channel</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Start unverified channel sharing"
          accessibilityState={{disabled: !consent || !usable || !/^[A-Za-z0-9_-]{1,12}$/.test(label)}}
          disabled={!consent || !usable || !/^[A-Za-z0-9_-]{1,12}$/.test(label)}
          onPress={() => {void start();}} style={styles.button}>
          <Text style={styles.text}>START UNVERIFIED SHARING</Text>
        </TouchableOpacity>
      </> : <TouchableOpacity accessibilityRole="button" accessibilityLabel="Stop unverified channel sharing"
        onPress={() => stop('Sharing stopped. New consent required.')} style={styles.button}>
        <Text style={styles.text}>STOP UNVERIFIED SHARING</Text>
      </TouchableOpacity>}
      {snapshot && enabled ? <Text style={styles.body}>
        {snapshot.lastSubmission === 'submitted-to-meshcore' ? 'Submitted to radio; peer receipt unknown.' :
          snapshot.lastSubmission === 'failed-or-unknown' ? 'Submission failed or unknown.' : 'Waiting for a fresh GPS fix and airtime allowance.'}
        {' · '}{snapshot.remoteMarkers.length} unverified heard. Enable RADIO DIAG on the map to inspect markers.
      </Text> : null}
      {notice ? <Text style={styles.warning}>{notice}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: 14, padding: 14, gap: 10, marginBottom: 12},
  heading: {color: colors.accent, fontSize: 14, fontWeight: '900'},
  warning: {color: colors.warning, fontSize: 13, lineHeight: 20},
  body: {color: colors.textSecondary, fontSize: 13, lineHeight: 20},
  input: {color: colors.textPrimary, borderColor: colors.border, borderWidth: 1,
    borderRadius: 10, padding: 12, minHeight: 56},
  button: {borderColor: colors.border, borderWidth: 1, borderRadius: 10,
    minHeight: 56, padding: 12, justifyContent: 'center'},
  text: {color: colors.textPrimary, fontWeight: '800', fontSize: 13},
});
