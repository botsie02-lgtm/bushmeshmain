import React, {useEffect, useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {AdvancedCarrierCredentials} from '../components/AdvancedCarrierCredentials';
import {ActiveConvoyCarrierProfile} from '../convoy/carrierCredentials';
import {
  bearingDegrees,
  compassDirection,
  ConvoyFreshness,
  ConvoyVehicle,
  distanceMeters,
  formatDistance,
  formatPositionAge,
  getConvoyFreshness,
  positionAgeSeconds,
} from '../convoy/convoy';
import {
  BushMeshConvoyInviteV1,
  decodeBushMeshConvoyInvite,
} from '../convoy/convoyProvisioning';
import {useBushMesh} from '../state/BushMeshContext';
import {useConvoy} from '../state/ConvoyContext';
import {useRadioConnection} from '../state/RadioConnectionContext';
import {colors} from '../theme/colors';

export type ConvoyScreenProps = {
  activeCarrierProfile?: ActiveConvoyCarrierProfile | null;
  onActiveCarrierProfileChange?: (
    profile: ActiveConvoyCarrierProfile,
  ) => void;
};

function freshnessColor(freshness: ConvoyFreshness): string {
  switch (freshness) {
    case 'live':
      return colors.success;
    case 'recent':
      return colors.accent;
    case 'stale':
      return colors.warning;
    case 'lost':
      return colors.danger;
  }
}

function optionalSlot(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const slot = Number(trimmed);
  if (!Number.isInteger(slot) || slot < 0) {
    throw new Error('Channel slot must be a non-negative whole number.');
  }
  return slot;
}

function RadarPoint({
  vehicle,
  minLat,
  maxLat,
  minLon,
  maxLon,
}: {
  vehicle: ConvoyVehicle;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}): React.JSX.Element {
  const latSpan = Math.max(0.0001, maxLat - minLat);
  const lonSpan = Math.max(0.0001, maxLon - minLon);
  const left = 8 + ((vehicle.longitude - minLon) / lonSpan) * 84;
  const top = 8 + (1 - (vehicle.latitude - minLat) / latSpan) * 84;
  const freshness = getConvoyFreshness(vehicle.receivedAtMs);

  return (
    <View
      style={[
        styles.radarVehicle,
        {
          left: `${left}%`,
          top: `${top}%`,
          borderColor: freshnessColor(freshness),
        },
      ]}>
      <Text style={styles.radarVehicleText}>
        {vehicle.name.slice(0, 2).toUpperCase()}
      </Text>
    </View>
  );
}

export function ConvoyScreen({
  activeCarrierProfile = null,
  onActiveCarrierProfileChange,
}: ConvoyScreenProps = {}): React.JSX.Element {
  const {vehicles, localPosition, loadDemoConvoy, clearConvoy} = useConvoy();
  const {connectionStatus, setActiveChannelIndex} = useBushMesh();
  const {snapshot, createConvoy, joinConvoy} = useRadioConnection();
  const [, setClockTick] = useState(0);
  const [convoyName, setConvoyName] = useState('BushMesh Test Convoy');
  const [channelName, setChannelName] = useState('');
  const [createSlot, setCreateSlot] = useState('');
  const [invite, setInvite] = useState('');
  const [joinSlot, setJoinSlot] = useState('');
  const [decodedInvite, setDecodedInvite] =
    useState<BushMeshConvoyInviteV1 | null>(null);
  const [sensitiveInvite, setSensitiveInvite] = useState<string | null>(null);
  const [enrollmentStatus, setEnrollmentStatus] = useState(
    'Connect a MeshCore node to create or join a convoy carrier.',
  );
  const [localEnrollmentProfile, setLocalEnrollmentProfile] =
    useState<ActiveConvoyCarrierProfile | null>(null);
  const enrollmentProfile = activeCarrierProfile ?? localEnrollmentProfile;

  const canProvision = connectionStatus === 'Connected' && !snapshot.isWriting;

  const rememberEnrollmentProfile = (profile: ActiveConvoyCarrierProfile) => {
    setLocalEnrollmentProfile(profile);
    onActiveCarrierProfileChange?.(profile);
  };

  useEffect(() => {
    const timer = setInterval(() => setClockTick(value => value + 1), 10_000);
    return () => clearInterval(timer);
  }, []);

  const orderedVehicles = useMemo(
    () => [...vehicles].sort((a, b) => b.receivedAtMs - a.receivedAtMs),
    [vehicles],
  );

  const radarBounds = useMemo(() => {
    const coordinates = [
      ...(localPosition ? [localPosition] : []),
      ...vehicles.map(vehicle => ({
        latitude: vehicle.latitude,
        longitude: vehicle.longitude,
      })),
    ];

    if (coordinates.length === 0) return null;

    const latitudes = coordinates.map(point => point.latitude);
    const longitudes = coordinates.map(point => point.longitude);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLon = Math.min(...longitudes);
    const maxLon = Math.max(...longitudes);
    const latPadding = Math.max(0.001, (maxLat - minLat) * 0.2);
    const lonPadding = Math.max(0.001, (maxLon - minLon) * 0.2);

    return {
      minLat: minLat - latPadding,
      maxLat: maxLat + latPadding,
      minLon: minLon - lonPadding,
      maxLon: maxLon + lonPadding,
    };
  }, [vehicles, localPosition]);

  const liveCount = vehicles.filter(
    vehicle => getConvoyFreshness(vehicle.receivedAtMs) === 'live',
  ).length;
  const attentionCount = vehicles.filter(vehicle => {
    const freshness = getConvoyFreshness(vehicle.receivedAtMs);
    return freshness === 'stale' || freshness === 'lost';
  }).length;

  const createEnrollment = async () => {
    try {
      setSensitiveInvite(null);
      const enrollment = await createConvoy({
        convoyName,
        channelName: channelName.trim() || undefined,
        channelIndex: optionalSlot(createSlot),
      });
      setActiveChannelIndex(String(enrollment.channel.channelIndex));
      rememberEnrollmentProfile({
        convoyId: enrollment.convoyId,
        convoyName: enrollment.convoyName,
        channelName: enrollment.channel.channelName,
        channelIndex: enrollment.channel.channelIndex,
      });
      setSensitiveInvite(enrollment.invite);
      setEnrollmentStatus(
        `Convoy carrier provisioned, read back, verified, and activated on slot ${enrollment.channel.channelIndex}. Share the sensitive invite only with convoy members.`,
      );
    } catch (error) {
      setEnrollmentStatus(
        error instanceof Error ? error.message : 'Convoy creation failed.',
      );
    }
  };

  const inspectInvite = () => {
    try {
      const decoded = decodeBushMeshConvoyInvite(invite);
      setDecodedInvite(decoded);
      setEnrollmentStatus(
        'Invite decoded locally. Confirm the convoy and channel below before writing this carrier to the connected node.',
      );
    } catch (error) {
      setDecodedInvite(null);
      setEnrollmentStatus(
        error instanceof Error ? error.message : 'Convoy invite is invalid.',
      );
    }
  };

  const joinEnrollment = async () => {
    if (!decodedInvite) {
      setEnrollmentStatus('Inspect a valid convoy invite before joining.');
      return;
    }
    try {
      const enrollment = await joinConvoy({
        invite,
        channelIndex: optionalSlot(joinSlot),
      });
      setActiveChannelIndex(String(enrollment.channel.channelIndex));
      rememberEnrollmentProfile({
        convoyId: enrollment.convoyId,
        convoyName: enrollment.convoyName,
        channelName: enrollment.channel.channelName,
        channelIndex: enrollment.channel.channelIndex,
      });
      setSensitiveInvite(null);
      setEnrollmentStatus(
        `Joined “${enrollment.convoyName}”. Carrier write verified and activated on slot ${enrollment.channel.channelIndex}.`,
      );
    } catch (error) {
      setEnrollmentStatus(
        error instanceof Error ? error.message : 'Convoy join failed.',
      );
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>Convoy</Text>
            <Text style={styles.title}>Keep the group in sight.</Text>
          </View>
          <View style={styles.offlinePill}>
            <View style={styles.offlineDot} />
            <Text style={styles.offlinePillText}>OFFLINE READY</Text>
          </View>
        </View>
        <Text style={styles.body}>
          Bushmesh treats every vehicle position as time-sensitive. Old coordinates
          fade to stale and lost instead of pretending a mate is still there.
        </Text>
      </View>

      <View style={styles.enrollmentCard}>
        <Text style={styles.sectionEyebrow}>PROVISIONING</Text>
        <Text style={styles.sectionTitle}>Create Convoy</Text>
        <Text style={styles.body}>
          Creates a convoy profile, provisions a new private MeshCore carrier on
          the connected node, verifies the write, activates that slot for BushMesh,
          then creates a sensitive invite. The MeshCore carrier secret is not a
          Security v1 group key.
        </Text>
        <TextInput
          style={styles.input}
          value={convoyName}
          onChangeText={setConvoyName}
          placeholder="Convoy name"
          placeholderTextColor={colors.textMuted}
        />
        <TextInput
          style={styles.input}
          value={channelName}
          onChangeText={setChannelName}
          placeholder="Optional MeshCore channel name"
          placeholderTextColor={colors.textMuted}
        />
        <TextInput
          style={styles.input}
          value={createSlot}
          onChangeText={setCreateSlot}
          placeholder="Optional slot; blank = first empty"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
        />
        <TouchableOpacity
          style={[styles.primaryButton, !canProvision && styles.disabled]}
          disabled={!canProvision}
          onPress={createEnrollment}>
          <Text style={styles.primaryButtonText}>Create, provision and verify</Text>
        </TouchableOpacity>

        {sensitiveInvite ? (
          <View style={styles.sensitiveBox}>
            <Text style={styles.sensitiveLabel}>SENSITIVE CONVOY INVITE · SELECT / COPY</Text>
            <Text selectable style={styles.inviteText}>{sensitiveInvite}</Text>
            <TouchableOpacity onPress={() => setSensitiveInvite(null)}>
              <Text style={styles.linkText}>Hide invite</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.divider} />
        <Text style={styles.sectionTitle}>Join Convoy</Text>
        <Text style={styles.body}>
          Paste a BushMesh invite, inspect its convoy/channel metadata, then
          explicitly confirm before writing the same private carrier to this node.
        </Text>
        <TextInput
          style={[styles.input, styles.inviteInput]}
          value={invite}
          onChangeText={value => {
            setInvite(value);
            setDecodedInvite(null);
          }}
          placeholder="Paste BUSHMESH-CONVOY-1 invite"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <TouchableOpacity style={styles.secondaryButton} onPress={inspectInvite}>
          <Text style={styles.secondaryButtonText}>Inspect invite</Text>
        </TouchableOpacity>
        {decodedInvite ? (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Confirm convoy provisioning</Text>
            <Text style={styles.confirmText}>Convoy: {decodedInvite.convoy.name}</Text>
            <Text style={styles.confirmText}>ID: {decodedInvite.convoy.id}</Text>
            <Text style={styles.confirmText}>Carrier: {decodedInvite.carrier.channelName}</Text>
            <Text style={styles.confirmText}>Invite version: {decodedInvite.version}</Text>
            <Text style={styles.confirmText}>Security v1 enrollment: not embedded in this phase</Text>
            <TextInput
              style={styles.input}
              value={joinSlot}
              onChangeText={setJoinSlot}
              placeholder="Optional slot; blank = first empty"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
            />
            <TouchableOpacity
              style={[styles.primaryButton, !canProvision && styles.disabled]}
              disabled={!canProvision}
              onPress={joinEnrollment}>
              <Text style={styles.primaryButtonText}>Confirm, provision and activate</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.statusBox}>
          <Text style={styles.statusText}>{enrollmentStatus}</Text>
        </View>
        {enrollmentProfile ? (
          <View style={styles.profileBox}>
            <Text style={styles.sectionEyebrow}>ACTIVE CONVOY PROFILE</Text>
            <Text style={styles.profileTitle}>{enrollmentProfile.convoyName}</Text>
            <Text style={styles.profileText}>ID {enrollmentProfile.convoyId}</Text>
            <Text style={styles.profileText}>
              Carrier {enrollmentProfile.channelName} · slot {enrollmentProfile.channelIndex}
            </Text>
            <AdvancedCarrierCredentials profile={enrollmentProfile} />
          </View>
        ) : null}
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{vehicles.length}</Text>
          <Text style={styles.statLabel}>Vehicles</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{liveCount}</Text>
          <Text style={styles.statLabel}>Live now</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, attentionCount > 0 && styles.attentionText]}>
            {attentionCount}
          </Text>
          <Text style={styles.statLabel}>Need eyes</Text>
        </View>
      </View>

      {vehicles.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No convoy positions yet</Text>
          <Text style={styles.body}>
            A connected radio will populate this from Bushmesh POSITION datagrams.
            On the emulator, load a simulated three-vehicle convoy.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={loadDemoConvoy}>
            <Text style={styles.primaryButtonText}>Load demo convoy</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {radarBounds ? (
        <View style={styles.radarCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>Relative view</Text>
              <Text style={styles.sectionTitle}>Convoy radar</Text>
            </View>
            <Text style={styles.northLabel}>N ↑</Text>
          </View>

          <View style={styles.radar}>
            <View style={styles.radarRingLarge} />
            <View style={styles.radarRingSmall} />
            <View style={styles.radarCrossHorizontal} />
            <View style={styles.radarCrossVertical} />

            {localPosition ? (
              <View style={styles.selfPoint}>
                <Text style={styles.selfPointText}>YOU</Text>
              </View>
            ) : null}

            {vehicles.map(vehicle => (
              <RadarPoint key={vehicle.id} vehicle={vehicle} {...radarBounds} />
            ))}
          </View>

          <Text style={styles.radarHint}>
            Relative geometry only for now — offline topographic map tiles are the
            next map layer.
          </Text>
        </View>
      ) : null}

      {orderedVehicles.length > 0 ? (
        <View style={styles.vehicleSection}>
          <Text style={styles.sectionTitle}>Vehicles</Text>
          {orderedVehicles.map(vehicle => {
            const freshness = getConvoyFreshness(vehicle.receivedAtMs);
            const age = positionAgeSeconds(vehicle.receivedAtMs);
            const distance = localPosition
              ? distanceMeters(localPosition, vehicle)
              : null;
            const bearing = localPosition
              ? bearingDegrees(localPosition, vehicle)
              : null;

            return (
              <View key={vehicle.id} style={styles.vehicleCard}>
                <View style={styles.vehicleTopRow}>
                  <View style={styles.vehicleIdentity}>
                    <View
                      style={[
                        styles.freshnessDot,
                        {backgroundColor: freshnessColor(freshness)},
                      ]}
                    />
                    <View>
                      <Text style={styles.vehicleName}>{vehicle.name}</Text>
                      <Text style={styles.vehicleId}>{vehicle.id}</Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.freshnessPill,
                      {borderColor: freshnessColor(freshness)},
                    ]}>
                    <Text
                      style={[
                        styles.freshnessText,
                        {color: freshnessColor(freshness)},
                      ]}>
                      {freshness.toUpperCase()}
                    </Text>
                  </View>
                </View>

                <View style={styles.vehicleMetrics}>
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>
                      {distance === null ? '—' : formatDistance(distance)}
                    </Text>
                    <Text style={styles.metricLabel}>
                      {bearing === null
                        ? 'Distance'
                        : `${compassDirection(bearing)} · ${Math.round(bearing)}°`}
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>{vehicle.speedKmh.toFixed(0)}</Text>
                    <Text style={styles.metricLabel}>km/h</Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>{formatPositionAge(age)}</Text>
                    <Text style={styles.metricLabel}>Last heard</Text>
                  </View>
                </View>

                <View style={styles.radioRow}>
                  <Text style={styles.radioText}>
                    Link {vehicle.snrDb == null ? '—' : `${vehicle.snrDb.toFixed(1)} dB`}
                  </Text>
                  <Text style={styles.radioText}>
                    Path {vehicle.pathLength == null ? '—' : vehicle.pathLength}
                  </Text>
                  {vehicle.accuracyMeters != null ? (
                    <Text style={styles.radioText}>GPS ±{vehicle.accuracyMeters} m</Text>
                  ) : null}
                </View>
              </View>
            );
          })}

          {vehicles.some(vehicle => vehicle.simulated) ? (
            <TouchableOpacity style={styles.secondaryButton} onPress={clearConvoy}>
              <Text style={styles.secondaryButtonText}>Clear demo convoy</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 32, gap: 14},
  heroCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 18,
  },
  enrollmentCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 18,
  },
  heroTopRow: {flexDirection: 'row', justifyContent: 'space-between', gap: 12},
  heroCopy: {flex: 1},
  eyebrow: {color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.2},
  title: {color: colors.textPrimary, fontSize: 26, fontWeight: '900', marginTop: 5},
  body: {color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 10},
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: colors.surfaceSoft,
  },
  offlineDot: {width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success},
  offlinePillText: {color: colors.textPrimary, fontSize: 9, fontWeight: '800'},
  input: {
    marginTop: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  inviteInput: {minHeight: 88, textAlignVertical: 'top'},
  divider: {height: 1, backgroundColor: colors.border, marginVertical: 18},
  sensitiveBox: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 14,
    padding: 12,
  },
  sensitiveLabel: {color: colors.warning, fontSize: 10, fontWeight: '900'},
  inviteText: {color: colors.textPrimary, fontSize: 10, lineHeight: 15, marginTop: 8},
  linkText: {color: colors.accent, fontWeight: '900', marginTop: 10},
  confirmBox: {
    marginTop: 12,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 14,
    padding: 12,
  },
  confirmTitle: {color: colors.textPrimary, fontSize: 15, fontWeight: '900'},
  confirmText: {color: colors.textSecondary, fontSize: 11, marginTop: 5},
  statusBox: {marginTop: 12, backgroundColor: colors.surfaceSoft, borderRadius: 12, padding: 11},
  statusText: {color: colors.textSecondary, fontSize: 11, lineHeight: 17},
  profileBox: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: 14,
    padding: 12,
  },
  profileTitle: {color: colors.textPrimary, fontSize: 16, fontWeight: '900', marginTop: 4},
  profileText: {color: colors.textSecondary, fontSize: 11, marginTop: 4},
  disabled: {opacity: 0.45},
  statsRow: {flexDirection: 'row', gap: 10},
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 14,
  },
  statValue: {color: colors.textPrimary, fontSize: 24, fontWeight: '900'},
  statLabel: {color: colors.textMuted, fontSize: 11, marginTop: 3, fontWeight: '700'},
  attentionText: {color: colors.warning},
  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 20,
  },
  emptyTitle: {color: colors.textPrimary, fontSize: 19, fontWeight: '800'},
  primaryButton: {
    marginTop: 12,
    backgroundColor: colors.accent,
    borderRadius: 15,
    alignItems: 'center',
    paddingVertical: 14,
  },
  primaryButtonText: {color: colors.background, fontSize: 14, fontWeight: '900'},
  radarCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 16,
  },
  sectionHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  sectionEyebrow: {color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1},
  sectionTitle: {color: colors.textPrimary, fontSize: 19, fontWeight: '800', marginTop: 2},
  northLabel: {color: colors.accent, fontSize: 13, fontWeight: '900'},
  radar: {
    height: 270,
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: colors.surfaceSoft,
    overflow: 'hidden',
    position: 'relative',
  },
  radarRingLarge: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    borderWidth: 1,
    borderColor: colors.border,
    left: '50%',
    top: '50%',
    marginLeft: -105,
    marginTop: -105,
  },
  radarRingSmall: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1,
    borderColor: colors.border,
    left: '50%',
    top: '50%',
    marginLeft: -55,
    marginTop: -55,
  },
  radarCrossHorizontal: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: '50%',
    height: 1,
    backgroundColor: colors.border,
  },
  radarCrossVertical: {
    position: 'absolute',
    top: 18,
    bottom: 18,
    left: '50%',
    width: 1,
    backgroundColor: colors.border,
  },
  selfPoint: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -19,
    marginTop: -19,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  selfPointText: {color: colors.background, fontSize: 8, fontWeight: '900'},
  radarVehicle: {
    position: 'absolute',
    width: 32,
    height: 32,
    marginLeft: -16,
    marginTop: -16,
    borderRadius: 16,
    borderWidth: 2,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarVehicleText: {color: colors.textPrimary, fontSize: 9, fontWeight: '900'},
  radarHint: {color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 10},
  vehicleSection: {gap: 10},
  vehicleCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
  },
  vehicleTopRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  vehicleIdentity: {flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1},
  freshnessDot: {width: 10, height: 10, borderRadius: 5},
  vehicleName: {color: colors.textPrimary, fontSize: 16, fontWeight: '800'},
  vehicleId: {color: colors.textMuted, fontSize: 10, marginTop: 2, letterSpacing: 0.8},
  freshnessPill: {borderWidth: 1, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5},
  freshnessText: {fontSize: 9, fontWeight: '900', letterSpacing: 0.8},
  vehicleMetrics: {flexDirection: 'row', marginTop: 16, gap: 8},
  metric: {flex: 1},
  metricValue: {color: colors.textPrimary, fontSize: 18, fontWeight: '900'},
  metricLabel: {color: colors.textMuted, fontSize: 10, marginTop: 2},
  radioRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  radioText: {color: colors.textSecondary, fontSize: 11, fontWeight: '700'},
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    alignItems: 'center',
    paddingVertical: 13,
    marginTop: 8,
  },
  secondaryButtonText: {color: colors.textSecondary, fontSize: 13, fontWeight: '800'},
});