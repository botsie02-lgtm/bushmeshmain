import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {useConvoy} from '../state/ConvoyContext';
import {useConvoyRecovery} from '../state/ConvoyRecoveryContext';
import {colors} from '../theme/colors';

export function ConvoyLossBanner(): React.JSX.Element | null {
  const {getBuddyTail} = useConvoy();
  const {events} = useConvoyRecovery();
  const [dismissedEventId, setDismissedEventId] = useState<string | null>(null);

  const alert = useMemo(
    () =>
      events.find(
        event =>
          (event.type === 'stale' || event.type === 'lost') &&
          event.id !== dismissedEventId,
      ) ?? null,
    [dismissedEventId, events],
  );

  if (!alert) {
    return null;
  }

  const tail = getBuddyTail(alert.vehicleId);
  const tailPoints = tail?.points.length ?? 0;
  const critical = alert.type === 'lost';

  return (
    <View style={[styles.banner, critical ? styles.lost : styles.stale]}>
      <View style={styles.copy}>
        <Text style={[styles.kicker, critical ? styles.lostText : styles.staleText]}>
          {critical ? 'CONVOY MEMBER LOST' : 'CONVOY POSITION STALE'}
        </Text>
        <Text style={styles.name}>{alert.vehicleName}</Text>
        <Text style={styles.detail}>
          No trustworthy new position has arrived.
          {tailPoints > 1
            ? ` Bushmesh retained ${tailPoints} Buddy Tail fixes for recovery.`
            : ' Last-known position must not be treated as current.'}
        </Text>
      </View>
      <TouchableOpacity
        accessibilityLabel="Dismiss convoy freshness alert"
        style={styles.dismiss}
        onPress={() => setDismissedEventId(alert.id)}>
        <Text style={styles.dismissText}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    backgroundColor: colors.surface,
  },
  stale: {borderBottomColor: colors.warning},
  lost: {borderBottomColor: colors.danger},
  copy: {flex: 1, minWidth: 0},
  kicker: {fontSize: 9, fontWeight: '900', letterSpacing: 1},
  staleText: {color: colors.warning},
  lostText: {color: colors.danger},
  name: {color: colors.textPrimary, fontSize: 15, fontWeight: '900', marginTop: 2},
  detail: {color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 3},
  dismiss: {
    width: 36,
    height: 36,
    marginLeft: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {color: colors.textSecondary, fontSize: 23, lineHeight: 24},
});
