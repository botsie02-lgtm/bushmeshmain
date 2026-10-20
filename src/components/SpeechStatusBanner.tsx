import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {nativeSpeech} from '../native/NativeSpeech';
import {
  isSpeakableCriticalAlert,
  speechForCriticalAlert,
} from '../speech/criticalAlertSpeech';
import {useDrive} from '../state/DriveContext';
import {useSpeech} from '../state/SpeechContext';
import {colors} from '../theme/colors';

function runtimeLabel(state: ReturnType<typeof useSpeech>['runtimeState']): string {
  switch (state) {
    case 'ready':
      return 'LOCAL VOICE READY';
    case 'initializing':
    case 'loading':
      return 'VOICE STARTING';
    case 'error':
      return 'VOICE ERROR';
    case 'unavailable':
    default:
      return 'VOICE UNAVAILABLE';
  }
}

export function SpeechStatusBanner(): React.JSX.Element | null {
  const {alerts} = useDrive();
  const {
    supported,
    criticalAlertsEnabled,
    runtimeState,
    languageTag,
    errorMessage,
    setCriticalAlertsEnabled,
  } = useSpeech();
  const [updating, setUpdating] = useState(false);
  const [replaying, setReplaying] = useState(false);

  const lastCriticalAlert = useMemo(
    () => alerts.find(alert => isSpeakableCriticalAlert(alert)) ?? null,
    [alerts],
  );

  if (!supported) {
    return null;
  }

  const ready = runtimeState === 'ready';
  const enabledAndReady = ready && criticalAlertsEnabled;

  const toggle = async () => {
    if (updating) {
      return;
    }
    setUpdating(true);
    try {
      await setCriticalAlertsEnabled(!criticalAlertsEnabled);
    } finally {
      setUpdating(false);
    }
  };

  const replay = async () => {
    if (!ready || !lastCriticalAlert || replaying) {
      return;
    }

    setReplaying(true);
    try {
      await nativeSpeech.speak(speechForCriticalAlert(lastCriticalAlert), true);
    } finally {
      setReplaying(false);
    }
  };

  return (
    <View style={styles.banner}>
      <View style={styles.copy}>
        <Text
          style={[
            styles.status,
            enabledAndReady ? styles.statusReady : styles.statusMuted,
          ]}>
          {runtimeLabel(runtimeState)}
        </Text>
        <Text style={styles.detail} numberOfLines={2}>
          {errorMessage
            ? errorMessage
            : criticalAlertsEnabled
              ? `Critical STOP, HAZARD, REGROUP and HELP alerts will be spoken${
                  languageTag ? ` · ${languageTag}` : ''
                }.`
              : 'Critical voice alerts are muted. Visual alerts remain active.'}
        </Text>
      </View>

      <View style={styles.actions}>
        {lastCriticalAlert ? (
          <TouchableOpacity
            style={[styles.replay, (!ready || replaying) && styles.toggleDisabled]}
            onPress={replay}
            disabled={!ready || replaying}>
            <Text style={styles.replayText}>
              {replaying ? 'PLAYING' : 'REPLAY'}
            </Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[
            styles.toggle,
            criticalAlertsEnabled ? styles.toggleEnabled : styles.toggleMuted,
            updating && styles.toggleDisabled,
          ]}
          onPress={toggle}
          disabled={updating || runtimeState === 'unavailable'}>
          <Text
            style={[
              styles.toggleText,
              criticalAlertsEnabled
                ? styles.toggleTextEnabled
                : styles.toggleTextMuted,
            ]}>
            {updating
              ? 'SAVING'
              : criticalAlertsEnabled
                ? 'VOICE ON'
                : 'MUTED'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  copy: {
    flex: 1,
  },
  status: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  statusReady: {
    color: colors.success,
  },
  statusMuted: {
    color: colors.warning,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
  },
  actions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  replay: {
    minWidth: 78,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
  },
  replayText: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '900',
  },
  toggle: {
    minWidth: 78,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
    borderWidth: 1,
  },
  toggleEnabled: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  toggleMuted: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.border,
  },
  toggleDisabled: {
    opacity: 0.6,
  },
  toggleText: {
    fontSize: 10,
    fontWeight: '900',
  },
  toggleTextEnabled: {
    color: colors.background,
  },
  toggleTextMuted: {
    color: colors.textPrimary,
  },
});
