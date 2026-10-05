import React, {useEffect, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';

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
import {useConvoy} from '../state/ConvoyContext';
import {colors} from '../theme/colors';

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

function freshnessLabel(freshness: ConvoyFreshness): string {
  return freshness.toUpperCase();
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
      <Text style={styles.radarVehicleText}>{vehicle.name.slice(0, 2).toUpperCase()}</Text>
    </View>
  );
}

export function MapScreen(): React.JSX.Element {
  const {vehicles, localPosition, loadDemoConvoy, clearConvoy} = useConvoy();
  const [, setClockTick] = useState(0);

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

    if (coordinates.length === 0) {
      return null;
    }

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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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
            While you are on the emulator, load a simulated three-vehicle convoy.
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
            Relative geometry only for now — offline topographic map tiles are the next map layer.
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
                      {freshnessLabel(freshness)}
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
    marginTop: 18,
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
  sectionTitle: {color: colors.textPrimary, fontSize: 19, fontWeight: '850', marginTop: 2},
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
  vehicleName: {color: colors.textPrimary, fontSize: 16, fontWeight: '850'},
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
    marginTop: 4,
  },
  secondaryButtonText: {color: colors.textSecondary, fontSize: 13, fontWeight: '800'},
});
