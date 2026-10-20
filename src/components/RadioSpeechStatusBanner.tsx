import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {nativeSpeech} from '../native/NativeSpeech';
import {useBushMesh} from '../state/BushMeshContext';
import {useSpeech} from '../state/SpeechContext';
import {colors} from '../theme/colors';

function replayText(channelName: string, text: string): string {
  return `Bushmesh replay, ${channelName.trim() || 'radio channel'}. ${text.trim()}`;
}

export function RadioSpeechStatusBanner(): React.JSX.Element | null {
  const {channelMessages} = useBushMesh();
  const {
    supported,
    radioMessagesEnabled,
    runtimeState,
    setRadioMessagesEnabled,
  } = useSpeech();
  const [busy, setBusy] = useState(false);
  const [detailOverride, setDetailOverride] = useState<string | null>(null);

  const latestReceived = useMemo(
    () => channelMessages.find(message => message.direction === 'received') ?? null,
    [channelMessages],
  );

  if (!supported) {
    return null;
  }

  const ready = runtimeState === 'ready';

  const toggle = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await setRadioMessagesEnabled(!radioMessagesEnabled);
      setDetailOverride(null);
    } finally {
      setBusy(false);
    }
  };

  const replay = async () => {
    if (!latestReceived || !ready || busy) {
      return;
    }
    setBusy(true);
    try {
      const spoken = await nativeSpeech.speak(
        replayText(latestReceived.channelName, latestReceived.text),
        true,
      );
      setDetailOverride(
        spoken
          ? `Replaying last received message from ${latestReceived.channelName}.`
          : 'Local voice could not replay the last radio message.',
      );
    } catch (error) {
      setDetailOverride(
        error instanceof Error
          ? error.message
          : 'Local voice could not replay the last radio message.',
      );
    } finally {
      setBusy(false);
    }
  };

  const detail =
    detailOverride ??
    (radioMessagesEnabled
      ? 'New received channel text is read aloud locally. Critical safety alerts remain a separate priority.'
      : 'Normal radio read-aloud is off. Critical STOP / HAZARD / HELP speech is unaffected.');

  return (
    <View style={styles.banner}>
      <View style={styles.copy}>
        <Text
          style={[
            styles.status,
            radioMessagesEnabled && ready ? styles.ready : styles.muted,
          ]}>
          {radioMessagesEnabled ? 'RADIO AUTO-READ ON' : 'RADIO AUTO-READ OFF'}
        </Text>
        <Text style={styles.detail} numberOfLines={3}>
          {detail}
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.action, busy && styles.disabled]}
          disabled={busy || !ready}
          onPress={() => {
            toggle().catch(() => undefined);
          }}>
          <Text style={styles.actionText}>
            {busy ? 'WAIT' : radioMessagesEnabled ? 'MUTE' : 'AUTO-READ'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.replay,
            (!latestReceived || !ready || busy) && styles.disabled,
          ]}
          disabled={!latestReceived || !ready || busy}
          onPress={() => {
            replay().catch(() => undefined);
          }}>
          <Text style={styles.replayText}>REPLAY LAST</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  copy: {flex: 1},
  status: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  ready: {color: colors.success},
  muted: {color: colors.textMuted},
  detail: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 3,
  },
  actions: {
    gap: 6,
  },
  action: {
    minWidth: 84,
    minHeight: 34,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  actionText: {
    color: colors.background,
    fontSize: 9,
    fontWeight: '900',
  },
  replay: {
    minWidth: 84,
    minHeight: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  replayText: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '900',
  },
  disabled: {opacity: 0.4},
});
