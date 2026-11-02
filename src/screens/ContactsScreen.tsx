import React, {useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {distanceMeters, formatDistance, getConvoyFreshness} from '../convoy/convoy';
import {useBushMesh} from '../state/BushMeshContext';
import {useConvoy} from '../state/ConvoyContext';
import {colors} from '../theme/colors';

function ageLabel(timestampSeconds: number | null, nowMs: number): string {
  if (timestampSeconds === null || timestampSeconds <= 0) {
    return 'Never heard';
  }

  const ageSeconds = Math.max(0, Math.floor(nowMs / 1000) - timestampSeconds);
  if (ageSeconds < 60) {
    return `${ageSeconds}s ago`;
  }
  if (ageSeconds < 3_600) {
    return `${Math.floor(ageSeconds / 60)}m ago`;
  }
  if (ageSeconds < 86_400) {
    return `${Math.floor(ageSeconds / 3_600)}h ago`;
  }
  return `${Math.floor(ageSeconds / 86_400)}d ago`;
}

function shortKey(prefix: string): string {
  const normalized = prefix.toUpperCase();
  return normalized.length <= 12
    ? normalized
    : `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

export function ContactsScreen(): React.JSX.Element {
  const {contacts, connectionStatus, connectedDeviceName} = useBushMesh();
  const {
    vehicles,
    localPosition,
    navigationTargetVehicleId,
    setNavigationTarget,
    clearNavigationTarget,
  } = useConvoy();
  const [query, setQuery] = useState('');
  const nowMs = Date.now();

  const filteredContacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...contacts].sort((a, b) => {
      const aAdvert = a.lastAdvert ?? 0;
      const bAdvert = b.lastAdvert ?? 0;
      if (aAdvert !== bAdvert) {
        return bAdvert - aAdvert;
      }
      return a.name.localeCompare(b.name);
    });

    if (!needle) {
      return sorted;
    }

    return sorted.filter(contact =>
      `${contact.name} ${contact.publicKeyPrefix} ${contact.publicKey}`
        .toLowerCase()
        .includes(needle),
    );
  }, [contacts, query]);

  const liveMatches = useMemo(() => {
    const byId = new Map<string, (typeof vehicles)[number]>();
    vehicles.forEach(vehicle => byId.set(vehicle.id.toUpperCase(), vehicle));
    return byId;
  }, [vehicles]);

  const contactsWithLocations = contacts.filter(
    contact => contact.latitude !== null && contact.longitude !== null,
  ).length;
  const liveContactCount = contacts.filter(contact =>
    liveMatches.has(contact.publicKeyPrefix.toUpperCase()),
  ).length;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>RADIO CONTACTS</Text>
            <Text style={styles.title}>People and nodes</Text>
          </View>
          <View
            style={[
              styles.statusPill,
              connectionStatus === 'Connected'
                ? styles.statusConnected
                : styles.statusOffline,
            ]}>
            <Text style={styles.statusText}>
              {connectionStatus === 'Connected' ? 'RADIO ONLINE' : 'OFFLINE'}
            </Text>
          </View>
        </View>
        <Text style={styles.body}>
          MeshCore contacts are matched against live Bushmesh position identities.
          Following a contact only uses live Bushmesh position packets; a stored
          MeshCore advert location is shown as last-known information, not live GPS.
        </Text>
        {connectedDeviceName ? (
          <Text style={styles.deviceText}>Node: {connectedDeviceName}</Text>
        ) : null}
      </View>

      <View style={styles.metricRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{contacts.length}</Text>
          <Text style={styles.metricLabel}>KNOWN</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{liveContactCount}</Text>
          <Text style={styles.metricLabel}>LIVE ON BUSHMESH</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{contactsWithLocations}</Text>
          <Text style={styles.metricLabel}>LAST LOCATION</Text>
        </View>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search name or public key"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.searchInput}
      />

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Contacts</Text>
        <Text style={styles.sectionMeta}>{filteredContacts.length} shown</Text>
      </View>

      {filteredContacts.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            {contacts.length === 0 ? 'No contacts synced yet' : 'No contacts match'}
          </Text>
          <Text style={styles.emptyText}>
            {contacts.length === 0
              ? 'Connect a MeshCore companion node and sync contacts from Device. Bushmesh will keep this screen focused on operational contact data rather than raw protocol records.'
              : 'Try a different name or public-key prefix.'}
          </Text>
        </View>
      ) : (
        filteredContacts.map(contact => {
          const liveVehicle = liveMatches.get(contact.publicKeyPrefix.toUpperCase()) ?? null;
          const freshness = liveVehicle
            ? getConvoyFreshness(liveVehicle.receivedAtMs, nowMs)
            : null;
          const following =
            liveVehicle !== null && navigationTargetVehicleId === liveVehicle.id;
          const rangeMeters =
            liveVehicle && localPosition
              ? distanceMeters(localPosition, liveVehicle)
              : null;

          return (
            <View key={contact.publicKey} style={styles.contactCard}>
              <View style={styles.contactTopRow}>
                <View style={styles.contactTitleWrap}>
                  <Text style={styles.contactName} numberOfLines={1}>
                    {contact.name || 'Unnamed contact'}
                  </Text>
                  <Text style={styles.publicKey}>{shortKey(contact.publicKeyPrefix)}</Text>
                </View>
                {liveVehicle ? (
                  <View
                    style={[
                      styles.livePill,
                      freshness === 'live' || freshness === 'recent'
                        ? styles.livePillReady
                        : styles.livePillStale,
                    ]}>
                    <Text style={styles.livePillText}>
                      {freshness?.toUpperCase() ?? 'LIVE'}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.advertAge}>{ageLabel(contact.lastAdvert, nowMs)}</Text>
                )}
              </View>

              <View style={styles.detailGrid}>
                <View style={styles.detailCell}>
                  <Text style={styles.detailLabel}>MESH PATH</Text>
                  <Text style={styles.detailValue}>
                    {contact.outPathLength < 0 ? 'Unknown' : `${contact.outPathLength} hop${contact.outPathLength === 1 ? '' : 's'}`}
                  </Text>
                </View>
                <View style={styles.detailCell}>
                  <Text style={styles.detailLabel}>NODE TYPE</Text>
                  <Text style={styles.detailValue}>{contact.type}</Text>
                </View>
                <View style={styles.detailCell}>
                  <Text style={styles.detailLabel}>LAST ADVERT</Text>
                  <Text style={styles.detailValue}>{ageLabel(contact.lastAdvert, nowMs)}</Text>
                </View>
              </View>

              {liveVehicle ? (
                <View style={styles.livePositionCard}>
                  <View style={styles.positionCopy}>
                    <Text style={styles.positionKicker}>LIVE BUSHMESH POSITION</Text>
                    <Text style={styles.positionText}>
                      {liveVehicle.latitude.toFixed(5)}, {liveVehicle.longitude.toFixed(5)}
                    </Text>
                    <Text style={styles.positionMeta}>
                      {rangeMeters === null ? 'Range unavailable until your GPS is ready' : `${formatDistance(rangeMeters)} away`}
                      {liveVehicle.snrDb === null ? '' : ` · ${liveVehicle.snrDb.toFixed(1)} dB SNR`}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.followButton,
                      following ? styles.followButtonActive : undefined,
                    ]}
                    onPress={() =>
                      following
                        ? clearNavigationTarget()
                        : setNavigationTarget(liveVehicle.id)
                    }>
                    <Text
                      style={[
                        styles.followButtonText,
                        following ? styles.followButtonTextActive : undefined,
                      ]}>
                      {following ? 'FOLLOWING' : 'FOLLOW LIVE'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : contact.latitude !== null && contact.longitude !== null ? (
                <View style={styles.lastKnownCard}>
                  <Text style={styles.lastKnownKicker}>LAST-KNOWN ADVERT LOCATION</Text>
                  <Text style={styles.lastKnownText}>
                    {contact.latitude.toFixed(5)}, {contact.longitude.toFixed(5)}
                  </Text>
                  <Text style={styles.lastKnownWarning}>
                    Stored MeshCore advert location — not safe to treat as current.
                  </Text>
                </View>
              ) : (
                <Text style={styles.noLocationText}>No contact location available.</Text>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 36},
  heroCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 18,
    marginBottom: 12,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroCopy: {flex: 1},
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 25,
    fontWeight: '900',
    marginTop: 4,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 9,
  },
  deviceText: {color: colors.textMuted, fontSize: 11, marginTop: 9},
  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  statusConnected: {borderColor: colors.success},
  statusOffline: {borderColor: colors.border},
  statusText: {color: colors.textPrimary, fontSize: 9, fontWeight: '900'},
  metricRow: {flexDirection: 'row', gap: 8, marginBottom: 12},
  metricCard: {
    flex: 1,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 14,
    padding: 12,
  },
  metricValue: {color: colors.textPrimary, fontSize: 22, fontWeight: '900'},
  metricLabel: {color: colors.textMuted, fontSize: 8, fontWeight: '900', marginTop: 3},
  searchInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 9,
  },
  sectionTitle: {color: colors.textPrimary, fontSize: 17, fontWeight: '900'},
  sectionMeta: {color: colors.textMuted, fontSize: 11, fontWeight: '700'},
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
  },
  emptyTitle: {color: colors.textPrimary, fontSize: 15, fontWeight: '900'},
  emptyText: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 5},
  contactCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 15,
    marginBottom: 10,
  },
  contactTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  contactTitleWrap: {flex: 1, minWidth: 0},
  contactName: {color: colors.textPrimary, fontSize: 17, fontWeight: '900'},
  publicKey: {color: colors.textMuted, fontSize: 10, fontWeight: '700', marginTop: 3},
  advertAge: {color: colors.textMuted, fontSize: 10, fontWeight: '700'},
  livePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  livePillReady: {borderColor: colors.success},
  livePillStale: {borderColor: colors.warning},
  livePillText: {color: colors.textPrimary, fontSize: 8, fontWeight: '900'},
  detailGrid: {flexDirection: 'row', gap: 8, marginTop: 13},
  detailCell: {flex: 1},
  detailLabel: {color: colors.textMuted, fontSize: 7, fontWeight: '900'},
  detailValue: {color: colors.textSecondary, fontSize: 11, fontWeight: '700', marginTop: 3},
  livePositionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 14,
    padding: 12,
    marginTop: 13,
  },
  positionCopy: {flex: 1},
  positionKicker: {color: colors.success, fontSize: 8, fontWeight: '900'},
  positionText: {color: colors.textPrimary, fontSize: 12, fontWeight: '800', marginTop: 3},
  positionMeta: {color: colors.textMuted, fontSize: 10, marginTop: 3},
  followButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  followButtonActive: {backgroundColor: colors.accent},
  followButtonText: {color: colors.accent, fontSize: 9, fontWeight: '900'},
  followButtonTextActive: {color: colors.background},
  lastKnownCard: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 14,
    padding: 12,
    marginTop: 13,
  },
  lastKnownKicker: {color: colors.warning, fontSize: 8, fontWeight: '900'},
  lastKnownText: {color: colors.textPrimary, fontSize: 12, fontWeight: '800', marginTop: 3},
  lastKnownWarning: {color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 4},
  noLocationText: {color: colors.textMuted, fontSize: 11, marginTop: 13},
});
