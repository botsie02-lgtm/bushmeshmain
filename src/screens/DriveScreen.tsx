import React, {useEffect, useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {BushMeshQuickActionCode} from '../bushmesh/protocol';
import {getConvoyFreshness} from '../convoy/convoy';
import {
  DRIVER_QUICK_ACTIONS,
  QuickActionDefinition,
} from '../drive/quickActions';
import {getAdaptivePositionDecision} from '../location/adaptivePosition';
import {useBushMesh} from '../state/BushMeshContext';
import {useConvoy} from '../state/ConvoyContext';
import {useDrive} from '../state/DriveContext';
import {colors} from '../theme/colors';

function actionButtonStyle(definition: QuickActionDefinition) {
  if (definition.priority === 'safety') {
    return styles.actionSafety;
  }
  if (definition.priority === 'control') {
    return styles.actionControl;
  }
  return styles.actionStatus;
}

function actionTextStyle(definition: QuickActionDefinition) {
  return definition.priority === 'status'
    ? styles.actionTextDark
    : styles.actionTextLight;
}

export function DriveScreen(): React.JSX.Element {
  const {
    connectionStatus,
    connectedDeviceName,
    activeChannel,
    deviceStatus,
  } = useBushMesh();
  const {vehicles, localPosition} = useConvoy();
  const {latestAlert, alerts, previewQuickAction, dismissAlert} = useDrive();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const convoySummary = useMemo(() => {
    const counts = {live: 0, recent: 0, stale: 0, lost: 0};
    vehicles.forEach(vehicle => {
      counts[getConvoyFreshness(vehicle.receivedAtMs, nowMs)] += 1;
    });
    return counts;
  }, [vehicles, nowMs]);

  const activeAlerts = alerts.filter(
    alert => alert.expiresAtMs === null || alert.expiresAtMs > nowMs,
  );

  const positionPolicy = getAdaptivePositionDecision({
    speedKmh: 0,
    convoyGapMeters: null,
  });

  const readiness = [
    {
      label: 'Radio',
      ready: connectionStatus === 'Connected',
      detail:
        connectionStatus === 'Connected'
          ? connectedDeviceName ?? 'MeshCore connected'
          : 'Connect a MeshCore radio',
    },
    {
      label: 'Channel',
      ready: activeChannel !== null,
      detail: activeChannel?.channelName ?? 'Select a convoy channel',
    },
    {
      label: 'Position',
      ready: localPosition !== null,
      detail: localPosition ? 'Local position available' : 'GPS hook not active yet',
    },
    {
      label: 'Convoy',
      ready: vehicles.length > 0,
      detail:
        vehicles.length > 0
          ? `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} known`
          : 'No remote vehicles yet',
    },
  ];

  const handleQuickAction = (action: BushMeshQuickActionCode) => {
    previewQuickAction(action, localPosition);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.heroRow}>
        <View>
          <Text style={styles.eyebrow}>DRIVE MODE</Text>
          <Text style={styles.title}>Bushmesh</Text>
        </View>
        <View
          style={[
            styles.connectionPill,
            connectionStatus === 'Connected'
              ? styles.connectionReady
              : styles.connectionOffline,
          ]}>
          <Text style={styles.connectionText}>{connectionStatus}</Text>
        </View>
      </View>

      <View style={styles.previewBanner}>
        <Text style={styles.previewTitle}>DEVELOPMENT PREVIEW</Text>
        <Text style={styles.previewText}>
          Driver controls below exercise the Bushmesh protocol and alert UI but
          are not transmitted over the radio yet. The outbound transport hook is
          the next integration step.
        </Text>
      </View>

      {latestAlert ? (
        <View
          style={[
            styles.alertCard,
            latestAlert.action === BushMeshQuickActionCode.Stop ||
            latestAlert.action === BushMeshQuickActionCode.Help
              ? styles.alertCardCritical
              : undefined,
          ]}>
          <View style={styles.alertHeader}>
            <View>
              <Text style={styles.alertKicker}>
                {latestAlert.source === 'radio' ? 'INCOMING' : 'LOCAL PREVIEW'}
              </Text>
              <Text style={styles.alertTitle}>{latestAlert.label}</Text>
            </View>
            <TouchableOpacity
              style={styles.dismissButton}
              onPress={() => dismissAlert(latestAlert.id)}>
              <Text style={styles.dismissText}>DISMISS</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.alertDescription}>{latestAlert.description}</Text>
          <Text style={styles.alertMeta}>
            {latestAlert.senderId}
            {latestAlert.channelIndex !== null
              ? ` · channel ${latestAlert.channelIndex}`
              : ''}
            {latestAlert.snrDb !== null
              ? ` · ${latestAlert.snrDb.toFixed(1)} dB SNR`
              : ''}
          </Text>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Quick controls</Text>
        <Text style={styles.sectionMeta}>{activeAlerts.length} active alerts</Text>
      </View>

      <View style={styles.actionGrid}>
        {DRIVER_QUICK_ACTIONS.map(definition => (
          <TouchableOpacity
            key={definition.code}
            activeOpacity={0.78}
            style={[styles.actionButton, actionButtonStyle(definition)]}
            onPress={() => handleQuickAction(definition.code)}>
            <Text style={[styles.actionText, actionTextStyle(definition)]}>
              {definition.shortLabel}
            </Text>
            <Text style={[styles.actionHint, actionTextStyle(definition)]}>
              {definition.priority.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Trip readiness</Text>
      <View style={styles.readinessCard}>
        {readiness.map(item => (
          <View key={item.label} style={styles.readinessRow}>
            <View
              style={[
                styles.readinessDot,
                item.ready ? styles.dotReady : styles.dotNotReady,
              ]}
            />
            <View style={styles.readinessCopy}>
              <Text style={styles.readinessLabel}>{item.label}</Text>
              <Text style={styles.readinessDetail}>{item.detail}</Text>
            </View>
            <Text style={item.ready ? styles.readyText : styles.notReadyText}>
              {item.ready ? 'READY' : 'WAIT'}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Convoy health</Text>
        <Text style={styles.sectionMeta}>{vehicles.length} tracked</Text>
      </View>
      <View style={styles.healthRow}>
        <View style={styles.healthCell}>
          <Text style={styles.healthValue}>{convoySummary.live}</Text>
          <Text style={styles.healthLabel}>LIVE</Text>
        </View>
        <View style={styles.healthCell}>
          <Text style={styles.healthValue}>{convoySummary.recent}</Text>
          <Text style={styles.healthLabel}>RECENT</Text>
        </View>
        <View style={styles.healthCell}>
          <Text style={styles.healthValue}>{convoySummary.stale}</Text>
          <Text style={styles.healthLabel}>STALE</Text>
        </View>
        <View style={styles.healthCell}>
          <Text style={styles.healthValue}>{convoySummary.lost}</Text>
          <Text style={styles.healthLabel}>LOST</Text>
        </View>
      </View>

      <View style={styles.telemetryCard}>
        <Text style={styles.telemetryTitle}>Position airtime policy</Text>
        <Text style={styles.telemetryValue}>
          {Math.round(positionPolicy.intervalMs / 1000)}s · {positionPolicy.reason}
        </Text>
        <Text style={styles.telemetryDetail}>
          Stationary vehicles back off automatically. Turns, movement, large
          convoy gaps and urgent events increase update frequency.
        </Text>
      </View>

      {deviceStatus ? (
        <View style={styles.footerStatus}>
          <Text style={styles.footerText}>
            Radio {deviceStatus.batteryVolts.toFixed(2)} V
            {deviceStatus.storagePercent !== null
              ? ` · storage ${deviceStatus.storagePercent}% used`
              : ''}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 18,
    paddingBottom: 36,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '900',
    marginTop: 2,
  },
  connectionPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  connectionReady: {
    borderColor: colors.success,
    backgroundColor: colors.surfaceSoft,
  },
  connectionOffline: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  connectionText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  previewBanner: {
    backgroundColor: colors.surface,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
  },
  previewTitle: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  previewText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  alertCard: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
  },
  alertCardCritical: {
    borderColor: colors.danger,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  alertKicker: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  alertTitle: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '900',
    marginTop: 2,
  },
  alertDescription: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  alertMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 10,
  },
  dismissButton: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  dismissText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '900',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  sectionMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  actionButton: {
    width: '48.5%',
    minHeight: 90,
    borderRadius: 18,
    padding: 14,
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  actionSafety: {
    backgroundColor: colors.danger,
  },
  actionControl: {
    backgroundColor: colors.warning,
  },
  actionStatus: {
    backgroundColor: colors.accent,
  },
  actionText: {
    fontSize: 20,
    fontWeight: '900',
  },
  actionTextLight: {
    color: colors.textPrimary,
  },
  actionTextDark: {
    color: colors.background,
  },
  actionHint: {
    fontSize: 10,
    fontWeight: '800',
    opacity: 0.8,
  },
  readinessCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    marginBottom: 22,
  },
  readinessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  readinessDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  dotReady: {
    backgroundColor: colors.success,
  },
  dotNotReady: {
    backgroundColor: colors.textMuted,
  },
  readinessCopy: {
    flex: 1,
  },
  readinessLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  readinessDetail: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  readyText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '900',
  },
  notReadyText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
  },
  healthRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    marginBottom: 18,
  },
  healthCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  healthValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
  },
  healthLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '900',
    marginTop: 2,
  },
  telemetryCard: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  telemetryTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  telemetryValue: {
    color: colors.accent,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4,
  },
  telemetryDetail: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  footerStatus: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 11,
  },
});
