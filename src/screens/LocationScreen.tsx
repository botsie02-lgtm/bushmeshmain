import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {useLocationSession} from '../state/LocationSessionContext';
import {useRadioSession} from '../state/RadioSessionContext';
import {colors} from '../theme/colors';

function statusLabel(status: ReturnType<typeof useLocationSession>['status']): string {
  switch (status) {
    case 'tracking':
      return 'TRACKING + RADIO READY';
    case 'tracking-no-link':
      return 'TRACKING · RADIO NOT READY';
    case 'error':
      return 'LOCATION ERROR';
    case 'stopped':
    default:
      return 'STOPPED';
  }
}

export function LocationScreen(): React.JSX.Element {
  const {
    status,
    providerLabel,
    latestFix,
    lastPlan,
    transmittedPlanCount,
    rejectedFixCount,
    lastError,
    startSimulation,
    stop,
  } = useLocationSession();
  const {snapshot: radioSession} = useRadioSession();

  const running = status !== 'stopped';
  const intervalSeconds = lastPlan?.decision
    ? Math.round(lastPlan.decision.intervalMs / 1000)
    : null;
  const radioProfile = radioSession.radioProfile;
  const modem = radioProfile?.modem ?? null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>LOCATION ENGINE</Text>
        <Text style={styles.title}>GPS + LoRa position planning</Text>
        <Text style={styles.body}>
          Bushmesh accepts local fixes continuously, but only selected fixes consume
          LoRa airtime. This simulator exercises that pipeline without requiring a
          phone GPS fix or a Heltec on the bench.
        </Text>
      </View>

      <View style={styles.statusCard}>
        <View style={styles.statusTopRow}>
          <View>
            <Text style={styles.cardLabel}>SESSION</Text>
            <Text style={styles.statusValue}>{statusLabel(status)}</Text>
          </View>
          <Text style={styles.providerText}>{providerLabel ?? 'No provider'}</Text>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={startSimulation}>
            <Text style={styles.primaryButtonText}>
              {running ? 'Restart simulation' : 'Start simulation'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={stop}
            disabled={!running}>
            <Text
              style={[
                styles.secondaryButtonText,
                !running && styles.disabledText,
              ]}>
              Stop
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.metricGrid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{transmittedPlanCount}</Text>
          <Text style={styles.metricLabel}>POSITION PLANS QUEUED</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{rejectedFixCount}</Text>
          <Text style={styles.metricLabel}>FIXES REJECTED</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>LATEST LOCAL FIX</Text>
        {latestFix ? (
          <>
            <Text style={styles.coordinateText}>
              {latestFix.latitude.toFixed(6)}, {latestFix.longitude.toFixed(6)}
            </Text>
            <Text style={styles.detailText}>
              Speed {latestFix.speedKmh == null ? '—' : `${latestFix.speedKmh.toFixed(1)} km/h`}
              {' · '}Heading {latestFix.headingDegrees == null ? '—' : `${Math.round(latestFix.headingDegrees)}°`}
            </Text>
            <Text style={styles.detailText}>
              Accuracy {latestFix.accuracyMeters == null ? '—' : `±${latestFix.accuracyMeters.toFixed(0)} m`}
              {' · '}Altitude {latestFix.altitudeMeters == null ? '—' : `${latestFix.altitudeMeters.toFixed(0)} m`}
            </Text>
          </>
        ) : (
          <Text style={styles.emptyText}>No accepted location fix yet.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>AIRTIME DECISION</Text>
        {lastPlan?.decision ? (
          <>
            <Text style={styles.planValue}>
              {lastPlan.shouldTransmit ? 'TRANSMIT' : 'HOLD'} · {intervalSeconds}s
            </Text>
            <Text style={styles.detailText}>
              Reason: {lastPlan.decision.reason}
              {lastPlan.headingChangeDegrees == null
                ? ''
                : ` · heading change ${Math.round(lastPlan.headingChangeDegrees)}°`}
            </Text>
          </>
        ) : (
          <Text style={styles.emptyText}>
            A radio identity and active convoy channel are required before fixes are
            evaluated for LoRa transmission.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>ACTIVE RADIO RF PROFILE</Text>
        {radioProfile ? (
          <>
            <Text style={styles.planValue}>
              {radioProfile.frequencyMhz == null
                ? 'Frequency unknown'
                : `${radioProfile.frequencyMhz.toFixed(3)} MHz`}
            </Text>
            <Text style={styles.detailText}>
              {modem
                ? `SF${modem.spreadingFactor} · ${modem.bandwidthKhz} kHz · CR 4/${modem.codingRate}`
                : 'Modem airtime parameters are incomplete; Bushmesh will not guess them.'}
            </Text>
            <Text style={styles.detailText}>
              TX power {radioProfile.txPower == null ? 'unknown' : `${radioProfile.txPower} dBm`}
              {radioProfile.maxTxPower == null
                ? ''
                : ` · advertised max ${radioProfile.maxTxPower} dBm`}
              {' · '}source {radioProfile.source}
            </Text>
          </>
        ) : (
          <Text style={styles.emptyText}>
            Waiting for SELF_INFO from the active radio. No default RF profile is assumed.
          </Text>
        )}
      </View>

      <View style={styles.noticeCard}>
        <Text style={styles.noticeTitle}>Truthful delivery semantics</Text>
        <Text style={styles.noticeText}>
          “Queued” means Bushmesh selected the fix for transmission. “Accepted” only
          means MeshCore accepted the datagram; it does not prove another vehicle
          received it.
        </Text>
      </View>

      {lastError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Latest location issue</Text>
          <Text style={styles.errorText}>{lastError}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 36, gap: 14},
  heroCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 18,
  },
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
    marginTop: 5,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
  },
  statusTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  statusValue: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '900',
    marginTop: 4,
  },
  providerText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
  },
  buttonRow: {flexDirection: 'row', gap: 10, marginTop: 16},
  button: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryButton: {backgroundColor: colors.accent},
  primaryButtonText: {color: colors.background, fontWeight: '900'},
  secondaryButton: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {color: colors.textPrimary, fontWeight: '800'},
  disabledText: {color: colors.textMuted},
  metricGrid: {flexDirection: 'row', gap: 10},
  metricCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 15,
  },
  metricValue: {color: colors.textPrimary, fontSize: 25, fontWeight: '900'},
  metricLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
  },
  coordinateText: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 8,
  },
  planValue: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 8,
  },
  detailText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  noticeCard: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 16,
  },
  noticeTitle: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  noticeText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  errorCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 18,
    padding: 16,
  },
  errorTitle: {color: colors.danger, fontSize: 13, fontWeight: '900'},
  errorText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
});
