import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {useBushMesh} from '../state/BushMeshContext';
import {colors} from '../theme/colors';

export type SecureDataStatusKind = 'contacts' | 'messages';

export function SecureDataStatusBanner({
  kind,
}: {
  kind: SecureDataStatusKind;
}): React.JSX.Element {
  const {
    contactPersistenceStatus,
    contactPersistenceError,
    messagePersistenceStatus,
    messagePersistenceError,
  } = useBushMesh();

  const status =
    kind === 'contacts' ? contactPersistenceStatus : messagePersistenceStatus;
  const error =
    kind === 'contacts' ? contactPersistenceError : messagePersistenceError;
  const label = kind === 'contacts' ? 'CONTACT BOOK' : 'RADIO HISTORY';

  const stateText =
    status === 'ready'
      ? 'ENCRYPTED + DURABLE'
      : status === 'restoring'
        ? 'RESTORING SECURE DATA'
        : status === 'unsupported'
          ? 'MEMORY ONLY'
          : 'SECURE STORAGE ISSUE';

  return (
    <View
      style={[
        styles.banner,
        status === 'ready'
          ? styles.readyBanner
          : status === 'error'
            ? styles.errorBanner
            : styles.warningBanner,
      ]}>
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        <Text
          style={[
            styles.state,
            status === 'ready'
              ? styles.readyText
              : status === 'error'
                ? styles.errorText
                : styles.warningText,
          ]}>
          {stateText}
        </Text>
        {error ? <Text style={styles.detail}>{error}</Text> : null}
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
  readyBanner: {borderBottomColor: colors.success},
  warningBanner: {borderBottomColor: colors.warning},
  errorBanner: {borderBottomColor: colors.danger},
  copy: {flex: 1},
  label: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  state: {fontSize: 10, fontWeight: '900', marginTop: 2},
  readyText: {color: colors.success},
  warningText: {color: colors.warning},
  errorText: {color: colors.danger},
  detail: {
    color: colors.textSecondary,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 3,
  },
});
