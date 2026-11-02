import React, {useState} from 'react';
import {
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {useCarMessaging} from '../state/CarMessagingContext';
import {colors} from '../theme/colors';

function platformApiLevel(): number {
  return typeof Platform.Version === 'number'
    ? Platform.Version
    : Number.parseInt(String(Platform.Version), 10) || 0;
}

export function CarMessagingStatusBanner(): React.JSX.Element | null {
  const {supported, status, errorMessage, draining, refresh} = useCarMessaging();
  const [requestingPermission, setRequestingPermission] = useState(false);

  if (!supported || Platform.OS !== 'android') {
    return null;
  }

  const unresolved =
    status.queuedReplies +
    status.inflightReplies +
    status.blockedReplies +
    status.acceptedReplies;
  const hasUncertain = status.inflightReplies > 0;
  const hasBlocked = status.blockedReplies > 0;

  const requestNotificationPermission = async () => {
    if (requestingPermission) {
      return;
    }

    setRequestingPermission(true);
    try {
      if (platformApiLevel() >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          {
            title: 'Bushmesh vehicle messages',
            message:
              'Allow Bushmesh message notifications so Android Auto can read incoming radio messages and accept voice replies.',
            buttonPositive: 'Enable messages',
            buttonNegative: 'Not now',
          },
        );
      }
      await refresh();
    } finally {
      setRequestingPermission(false);
    }
  };

  let headline = 'ANDROID AUTO READY';
  let detail = 'Radio message notifications can be read and replied to in the car.';
  let statusStyle = styles.readyText;

  if (!status.notificationsEnabled) {
    headline = 'AUTO MESSAGES OFF';
    detail = 'Enable notifications to use Android Auto radio read/reply.';
    statusStyle = styles.warningText;
  } else if (hasUncertain) {
    headline = 'AUTO REPLY UNCERTAIN';
    detail = `${status.inflightReplies} voice repl${
      status.inflightReplies === 1 ? 'y has' : 'ies have'
    } an unknown radio outcome after interruption. Bushmesh will not resend automatically.`;
    statusStyle = styles.dangerText;
  } else if (hasBlocked) {
    headline = 'AUTO REPLY NEEDS EDIT';
    detail = `${status.blockedReplies} voice repl${
      status.blockedReplies === 1 ? 'y is' : 'ies are'
    } blocked, usually because it exceeds the MeshCore text limit.`;
    statusStyle = styles.warningText;
  } else if (status.queuedReplies > 0) {
    headline = draining ? 'SENDING AUTO REPLY' : 'AUTO REPLY QUEUED';
    detail = `${status.queuedReplies} voice repl${
      status.queuedReplies === 1 ? 'y is' : 'ies are'
    } waiting for MeshCore radio acceptance.`;
    statusStyle = styles.warningText;
  } else if (status.acceptedReplies > 0) {
    headline = 'AUTO REPLY ACCEPTED';
    detail = `${status.acceptedReplies} accepted repl${
      status.acceptedReplies === 1 ? 'y is' : 'ies are'
    } retained only for crash-safe cleanup; it will not be retransmitted.`;
  }

  if (errorMessage) {
    headline = 'AUTO MESSAGE ERROR';
    detail = errorMessage;
    statusStyle = styles.dangerText;
  }

  return (
    <View style={styles.banner}>
      <View style={styles.copy}>
        <Text style={[styles.statusText, statusStyle]}>{headline}</Text>
        <Text style={styles.detailText} numberOfLines={3}>
          {detail}
        </Text>
        {unresolved > 0 ? (
          <Text style={styles.countText}>
            {status.queuedReplies} queued · {status.inflightReplies} uncertain ·{' '}
            {status.blockedReplies} blocked
          </Text>
        ) : null}
      </View>

      {!status.notificationsEnabled ? (
        <TouchableOpacity
          style={[
            styles.actionButton,
            requestingPermission && styles.actionButtonDisabled,
          ]}
          disabled={requestingPermission}
          onPress={() => {
            requestNotificationPermission().catch(() => undefined);
          }}>
          <Text style={styles.actionText}>
            {requestingPermission ? 'WAIT' : 'ENABLE'}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => {
            refresh().catch(() => undefined);
          }}>
          <Text style={styles.refreshText}>REFRESH</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  copy: {flex: 1},
  statusText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  readyText: {color: colors.success},
  warningText: {color: colors.warning},
  dangerText: {color: colors.danger},
  detailText: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 3,
  },
  countText: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  actionButton: {
    minWidth: 72,
    minHeight: 38,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  actionButtonDisabled: {opacity: 0.5},
  actionText: {
    color: colors.background,
    fontSize: 10,
    fontWeight: '900',
  },
  refreshButton: {
    minWidth: 72,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  refreshText: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '900',
  },
});
