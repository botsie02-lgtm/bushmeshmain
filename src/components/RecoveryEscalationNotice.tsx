import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {getLatestRecoveryPositionRequest} from '../convoy/recoveryPositionRequest';
import {useConvoyRecovery} from '../state/ConvoyRecoveryContext';
import {colors} from '../theme/colors';

export function RecoveryEscalationNotice({
  visible,
}: {
  visible: boolean;
}): React.JSX.Element | null {
  const {activeCases} = useConvoyRecovery();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  if (!visible) {
    return null;
  }

  const recoveryCase = activeCases[0] ?? null;
  if (!recoveryCase) {
    return null;
  }

  const request = getLatestRecoveryPositionRequest(
    recoveryCase.vehicle.id,
    nowMs,
  );
  if (!request || (request.state !== 'expired' && request.state !== 'failed')) {
    return null;
  }

  const critical = recoveryCase.level === 'critical';
  const high = recoveryCase.level === 'high';
  const headline =
    request.state === 'failed'
      ? 'FRESH-POSITION REQUEST FAILED'
      : 'NO REQUEST-DRIVEN FIX OBSERVED';

  const action = critical
    ? 'HOLD CONVOY · CONSIDER REGROUP'
    : high
      ? 'CLOSE GAP · KEEP RECOVERY FOCUS'
      : 'MONITOR · DO NOT TREAT LAST KNOWN AS CURRENT';

  const detail = critical
    ? 'The missing vehicle remains high-risk after the request window. Keep the group together and use only observed recovery evidence before pushing farther apart.'
    : high
      ? 'No fresh request response has resolved the recovery case. Reduce separation where practical and keep the last-known/trail uncertainty visible.'
      : 'The vehicle remains stale. Continue monitoring for a trustworthy periodic fix before escalating further.';

  return (
    <View
      style={[
        styles.banner,
        critical
          ? styles.criticalBorder
          : high
            ? styles.highBorder
            : styles.watchBorder,
      ]}>
      <View style={styles.copy}>
        <Text
          style={[
            styles.eyebrow,
            critical
              ? styles.criticalText
              : high
                ? styles.highText
                : styles.watchText,
          ]}>
          {headline}
        </Text>
        <Text style={styles.vehicle}>{recoveryCase.vehicle.name}</Text>
        <Text style={styles.action}>{action}</Text>
        <Text style={styles.detail}>{detail}</Text>
        <Text style={styles.disclaimer}>
          Advisory only · Bushmesh has not automatically transmitted STOP, REGROUP or any other convoy command.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
  },
  criticalBorder: {borderBottomColor: colors.danger},
  highBorder: {borderBottomColor: colors.warning},
  watchBorder: {borderBottomColor: colors.accent},
  copy: {minWidth: 0},
  eyebrow: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  criticalText: {color: colors.danger},
  highText: {color: colors.warning},
  watchText: {color: colors.accent},
  vehicle: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 2,
  },
  action: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '900',
    marginTop: 4,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 2,
  },
  disclaimer: {
    color: colors.textMuted,
    fontSize: 8,
    lineHeight: 11,
    marginTop: 3,
  },
});
