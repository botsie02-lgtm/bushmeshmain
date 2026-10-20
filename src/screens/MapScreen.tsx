import React, {useMemo, useState} from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {clearBushMeshPeerTracks} from '../bushmesh/runtime/BushMeshPeerTrackHub';
import {useBushMesh} from '../state/BushMeshContext';
import {useBushMeshLiveState} from '../state/useBushMeshLiveState';
import {useBushMeshPeerTracks} from '../state/useBushMeshPeerTracks';
import {colors} from '../theme/colors';

type LocatedContact = {
  publicKey: string;
  publicKeyPrefix: string;
  name: string;
  latitude: number;
  longitude: number;
  lastAdvert: number | null;
};

type OpenableLocation = {
  name: string;
  latitude: number;
  longitude: number;
};

function validCoordinate(value: number | null, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function formatAge(timestampMs: number, prefix: string): string {
  const ageMs = Math.max(0, Date.now() - timestampMs);

  if (ageMs < 60_000) {
    return `${prefix} just now`;
  }
  if (ageMs < 60 * 60_000) {
    return `${prefix} ${Math.floor(ageMs / 60_000)} min ago`;
  }
  if (ageMs < 24 * 60 * 60_000) {
    return `${prefix} ${Math.floor(ageMs / (60 * 60_000))} hr ago`;
  }

  return `${prefix} ${Math.floor(ageMs / (24 * 60 * 60_000))} day(s) ago`;
}

function formatAdvertAge(lastAdvert: number | null): string {
  if (lastAdvert === null || !Number.isFinite(lastAdvert)) {
    return 'Advert age unknown';
  }

  const timestampMs = lastAdvert > 10_000_000_000 ? lastAdvert : lastAdvert * 1000;
  return formatAge(timestampMs, 'Advertised');
}

function nodeIdLabel(nodeId: number): string {
  return nodeId.toString(16).padStart(8, '0').toUpperCase();
}

export function MapScreen(): React.JSX.Element {
  const {contacts, knownBushMeshPeers, connectionStatus} = useBushMesh();
  const {peerLocations} = useBushMeshLiveState();
  const peerTracks = useBushMeshPeerTracks();
  const [status, setStatus] = useState(
    'Tap a location to open it in your phone mapping app.',
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

  const allLocations = useMemo<OpenableLocation[]>(
    () => [
      ...peerLocations.map(location => ({
        name: `BushMesh ${nodeIdLabel(location.nodeId)}`,
        latitude: location.latitude,
        longitude: location.longitude,
      })),
      ...locatedContacts.map(contact => ({
        name: contact.name,
        latitude: contact.latitude,
        longitude: contact.longitude,
      })),
    ],
    [locatedContacts, peerLocations],
  );

  const bounds = useMemo(() => {
    if (allLocations.length === 0) {
      return null;
    }

    let minLat = allLocations[0].latitude;
    let maxLat = allLocations[0].latitude;
    let minLon = allLocations[0].longitude;
    let maxLon = allLocations[0].longitude;

    for (const location of allLocations.slice(1)) {
      minLat = Math.min(minLat, location.latitude);
      maxLat = Math.max(maxLat, location.latitude);
      minLon = Math.min(minLon, location.longitude);
      maxLon = Math.max(maxLon, location.longitude);
    }

    return {
      minLat,
      maxLat,
      minLon,
      maxLon,
      centreLat: (minLat + maxLat) / 2,
      centreLon: (minLon + maxLon) / 2,
    };
  }, [allLocations]);

  const openLocation = async (location: OpenableLocation) => {
    const label = encodeURIComponent(location.name);
    const candidates = [
      `geo:${location.latitude},${location.longitude}?q=${location.latitude},${location.longitude}(${label})`,
      `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`,
    ];

    try {
      for (const url of candidates) {
        if (await Linking.canOpenURL(url)) {
          await Linking.openURL(url);
          setStatus(`Opened ${location.name} in maps.`);
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
          Combines coordinates advertised by MeshCore contacts with live compact
          location replies received directly through BushMesh routed packets.
          Recent BushMesh movement fixes are retained as a bounded convoy trail.
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
          <Text style={styles.metricLabel}>Live peer positions</Text>
          <Text style={styles.metricValue}>{peerLocations.length}</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Trail points</Text>
          <Text style={styles.metricValue}>{peerTracks.totalPoints}</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>BushMesh peers</Text>
          <Text style={styles.metricValue}>{knownBushMeshPeers.length}</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Located contacts</Text>
          <Text style={styles.metricValue}>{locatedContacts.length}</Text>
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
        <Text style={styles.sectionTitle}>Live BushMesh Positions</Text>
        <Text style={styles.sectionBody}>
          These are source-attributed locations received inside routed BushMesh
          packets. The newest fix drives the live marker; recent movement is kept
          separately as a durable trail.
        </Text>

        {peerLocations.length === 0 ? (
          <Text style={styles.emptyText}>
            No routed BushMesh location replies have been received yet. Request
            a peer location from the Contacts tab.
          </Text>
        ) : (
          peerLocations.map(location => {
            const peer = knownBushMeshPeers.find(item => item.nodeId === location.nodeId);
            const name = `BushMesh ${nodeIdLabel(location.nodeId)}`;
            const track = peerTracks.tracks.find(item => item.nodeId === location.nodeId);
            const recentTrack = track?.points.slice(-5).reverse() ?? [];

            return (
              <View key={location.nodeId} style={styles.liveLocationCard}>
                <TouchableOpacity
                  onPress={() => openLocation({
                    name,
                    latitude: location.latitude,
                    longitude: location.longitude,
                  })}>
                  <View style={styles.rowBetween}>
                    <View style={styles.flexOne}>
                      <Text style={styles.contactName}>{nodeIdLabel(location.nodeId)}</Text>
                      <Text style={styles.contactKey}>
                        Channel #{location.channelIndex}
                        {peer ? ` • Role ${peer.role}` : ''}
                        {track ? ` • ${track.points.length} trail points` : ''}
                      </Text>
                    </View>
                    <Text style={styles.openText}>Open map</Text>
                  </View>

                  <Text style={styles.coordinateText}>
                    {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                  </Text>
                  <Text style={styles.advertText}>
                    {formatAge(location.receivedAt, 'Received')}
                    {location.batteryPercent === undefined
                      ? ''
                      : ` • Battery ${location.batteryPercent}%`}
                  </Text>
                </TouchableOpacity>

                {recentTrack.length > 1 ? (
                  <View style={styles.trailWrap}>
                    <Text style={styles.trailTitle}>Recent movement</Text>
                    {recentTrack.map((point, index) => (
                      <TouchableOpacity
                        key={`${point.receivedAt}-${index}`}
                        style={styles.trailRow}
                        onPress={() => openLocation({
                          name: `${name} trail point`,
                          latitude: point.latitude,
                          longitude: point.longitude,
                        })}>
                        <Text style={styles.trailCoordinate}>
                          {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
                        </Text>
                        <Text style={styles.trailAge}>
                          {formatAge(point.receivedAt, '')}
                            .replace(/^\s+/, '')
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      {peerTracks.totalPoints > 0 ? (
        <View style={styles.sectionCard}>
          <View style={styles.rowBetween}>
            <View style={styles.flexOne}>
              <Text style={styles.sectionTitle}>Convoy Trail Cache</Text>
              <Text style={styles.sectionBody}>
                {peerTracks.totalPoints} recent point(s) across {peerTracks.tracks.length}{' '}
                node(s). Trails are capped and expire automatically after seven days.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.clearTrailButton}
              onPress={() => {
                clearBushMeshPeerTracks();
                setStatus('BushMesh convoy trail history cleared.');
              }}>
              <Text style={styles.clearTrailText}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Map-ready MeshCore Contacts</Text>
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
          BushMesh now retains latest peer fixes and bounded movement trails
          independently of the map UI. A future offline tile renderer can draw
          convoy tracks without changing the radio protocol or receive pipeline.
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
  liveLocationCard: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.accent,
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
  trailWrap: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  trailTitle: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 5,
  },
  trailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  trailCoordinate: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  trailAge: {
    color: colors.textMuted,
    fontSize: 10,
  },
  clearTrailButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.warning,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  clearTrailText: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: '900',
  },
});
