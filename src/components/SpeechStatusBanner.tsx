import React, {useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

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
  const {
    supported,
    criticalAlertsEnabled,
    runtimeState,
    languageTag,
    errorMessage,
    setCriticalAlertsEnabled,
  } = useSpeech();
  const [updating, setUpdating] = useState(false);

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
