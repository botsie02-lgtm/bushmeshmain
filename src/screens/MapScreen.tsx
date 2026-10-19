import React, {useMemo, useState} from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {useBushMesh} from '../state/BushMeshContext';
import {colors} from '../theme/colors';

type LocatedContact = {
  publicKey: string;
  publicKeyPrefix: string;
  name: string;
  latitude: number;
  longitude: number;
  lastAdvert: number | null;
};

function validCoordinate(value: number | null, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function formatAdvertAge(lastAdvert: number | null): string {
  if (lastAdvert === null || !Number.isFinite(lastAdvert)) {
    return 'Advert age unknown';
  }

  const timestampMs = lastAdvert > 10_000_000_000 ? lastAdvert : lastAdvert * 1000;
  const ageMs = Math.max(0, Date.now() - timestampMs);

  if (ageMs < 60_000) {
    return 'Advertised just now';
  }
  if (ageMs < 60 * 60_000) {
    return `Advertised ${Math.floor(ageMs / 60_000)} min ago`;
  }
  if (ageMs < 24 * 60 * 60_000) {
    return `Advertised ${Math.floor(ageMs / (60 * 60_000))} hr ago`;
  }

  return `Advertised ${Math.floor(ageMs / (24 * 60 * 60_000))} day(s) ago`;
}

export function MapScreen(): React.JSX.Element {
  const {contacts, knownBushMeshPeers, connectionStatus} = useBushMesh();
  const [status, setStatus] = useState(
    'Tap a located contact to open it in your phone mapping app.',
  );

  const locatedContacts = useMemo<LocatedContact[]>(
    () =>
      contacts
        .filter(
          contact =>
            validCoordinate(contact.latitude, -90, 90) &&
            validCoordinate(contact.longitude, -180, 180),
        )
        .map(contact => ({
          publicKey: contact.publicKey,
          publicKeyPrefix: contact.publicKeyPrefix,
          name: contact.name || 'Unnamed contact',
          latitude: contact.latitude as number,
          longitude: contact.longitude as number,
          lastAdvert: contact.lastAdvert,
        })),
    [contacts],
  );

  const bounds = useMemo(() => {
    if (locatedContacts.length === 0) {
      return null;
    }

    let minLat = locatedContacts[0].latitude;
    let maxLat = locatedContacts[0].latitude;
    let minLon = locatedContacts[0].longitude;
    let maxLon = locatedContacts[0].longitude;

    for (const contact of locatedContacts.slice(1)) {
      minLat = Math.min(minLat, contact.latitude);
      maxLat = Math.max(maxLat, contact.latitude);
      minLon = Math.min(minLon, contact.longitude);
      maxLon = Math.max(maxLon, contact.longitude);
    }

    return {
      minLat,
      maxLat,
      minLon,
      maxLon,
      centreLat: (minLat + maxLat) / 2,
      centreLon: (minLon + maxLon) / 2,
    };
  }, [locatedContacts]);

  const openLocation = async (contact: LocatedContact) => {
    const label = encodeURIComponent(contact.name);
    const candidates = [
      `geo:${contact.latitude},${contact.longitude}?q=${contact.latitude},${contact.longitude}(${label})`,
      `https://www.google.com/maps/search/?api=1&query=${contact.latitude},${contact.longitude}`,
    ];

    try {
      for (const url of candidates) {
        if (await Linking.canOpenURL(url)) {
          await Linking.openURL(url);
          setStatus(`Opened ${contact.name} in maps.`);
          return;
        }
      }

      setStatus('No compatible mapping app was available.');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Failed to open mapping app.',
      );
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Map</Text>
        <Text style={styles.title}>Convoy Locations</Text>
        <Text style={styles.body}>
          BushMesh can already surface coordinates advertised by MeshCore
          contacts. This screen keeps the data useful before a full offline map
          renderer is added.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Connection</Text>
          <Text
            style={[
              styles.metricValue,
              connectionStatus === 'Connected' && styles.metricValueOnline,
            ]}>
            {connectionStatus}
          </Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Located contacts</Text>
          <Text style={styles.metricValue}>{locatedContacts.length}</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>BushMesh peers</Text>
          <Text style={styles.metricValue}>{knownBushMeshPeers.length}</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Synced contacts</Text>
          <Text style={styles.metricValue}>{contacts.length}</Text>
        </View>
      </View>

      {bounds ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Current Location Envelope</Text>
          <Text style={styles.sectionBody}>
            Centre {bounds.centreLat.toFixed(5)}, {bounds.centreLon.toFixed(5)}
          </Text>
          <Text style={styles.boundsText}>
            Lat {bounds.minLat.toFixed(5)} → {bounds.maxLat.toFixed(5)}
          </Text>
          <Text style={styles.boundsText}>
            Lon {bounds.minLon.toFixed(5)} → {bounds.maxLon.toFixed(5)}
          </Text>
        </View>
      ) : null}

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Map-ready Contacts</Text>
        <Text style={styles.sectionBody}>{status}</Text>

        {locatedContacts.length === 0 ? (
          <Text style={styles.emptyText}>
            No synced contacts currently advertise valid coordinates. Sync
            contacts from the Device tab and wait for location adverts.
          </Text>
        ) : (
          locatedContacts.map(contact => (
            <TouchableOpacity
              key={contact.publicKey}
              style={styles.locationCard}
              onPress={() => openLocation(contact)}>
              <View style={styles.rowBetween}>
                <View style={styles.flexOne}>
                  <Text style={styles.contactName}>{contact.name}</Text>
                  <Text style={styles.contactKey}>{contact.publicKeyPrefix}</Text>
                </View>
                <Text style={styles.openText}>Open map</Text>
              </View>

              <Text style={styles.coordinateText}>
                {contact.latitude.toFixed(6)}, {contact.longitude.toFixed(6)}
              </Text>
              <Text style={styles.advertText}>
                {formatAdvertAge(contact.lastAdvert)}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Offline Map Path</Text>
        <Text style={styles.sectionBody}>
          The next map layer can consume the same contact and BushMesh location
          state without changing the radio protocol: cached offline tiles,
          convoy trails, route markers and peer positions can be rendered here
          once a map renderer is selected.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 10,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  summaryCard: {
    marginTop: 16,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricBox: {
    minWidth: '45%',
    flexGrow: 1,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  metricValueOnline: {
    color: colors.success,
  },
  sectionCard: {
    marginTop: 18,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
  sectionBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  boundsText: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 7,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 12,
  },
  locationCard: {
    backgroundColor: colors.background,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 13,
    marginTop: 12,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  flexOne: {
    flex: 1,
  },
  contactName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  contactKey: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
  openText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
  },
  coordinateText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 10,
  },
  advertText: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 5,
  },
});
