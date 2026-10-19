import React, {useEffect, useMemo, useRef, useState} from 'react';
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
import {getTripReadiness} from '../drive/tripReadiness';
import {getAdaptivePositionDecision} from '../location/adaptivePosition';
import {useBushMesh} from '../state/BushMeshContext';
import {useConvoy} from '../state/ConvoyContext';
import {DriveAlertSource, useDrive} from '../state/DriveContext';
import {useRadioSession} from '../state/RadioSessionContext';
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

function alertSourceLabel(source: DriveAlertSource): string {
  switch (source) {
    case 'radio':
      return 'INCOMING';
    case 'local-accepted':
      return 'RADIO ACCEPTED';
    case 'local-queued':
      return 'QUEUED FOR RETRY';
    case 'local-failed':
      return 'SEND FAILED';
    case 'local-preview':
    default:
      return 'LOCAL PREVIEW';
  }
}

export function DriveScreen(): React.JSX.Element {
  const {
    connectionStatus,
    connectedDeviceName,
    activeChannel,
    deviceStatus,
  } = useBushMesh();
  const {vehicles, localPosition} = useConvoy();
  const {
    latestAlert,
    alerts,
    previewQuickAction,
    recordLocalQuickAction,
    dismissAlert,
  } = useDrive();
  const {
    snapshot: radioSession,
    queueDriverAction,
    drainOnce,
  } = useRadioSession();
  const [nowMs, setNowMs] = useState(Date.now());
  const [quickActionStatus, setQuickActionStatus] = useState<string | null>(null);
  const quickActionSequenceRef = useRef(1);

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

  const tripReadiness = getTripReadiness({
    radioConnected: connectionStatus === 'Connected',
    radioTransportReady: radioSession.transportReady,
    radioIdentityReady: radioSession.identityRef !== null,
    channelSelected: activeChannel !== null,
    localPositionReady: localPosition !== null,
    convoyMembersKnown: vehicles.length > 0,
    offlineMapReady: false,
    navigationRequired: false,
  });

  const bushMeshLinkReady =
    radioSession.transportReady &&
    radioSession.identityRef !== null &&
    activeChannel !== null;

  const nextQuickActionSequence = (): number => {
    const sequence = quickActionSequenceRef.current;
    quickActionSequenceRef.current = sequence >= 0xffff ? 1 : sequence + 1;
    return sequence;
  };

  const handleQuickAction = async (definition: QuickActionDefinition) => {
    const locatedAction = definition.includesLocation;

    if (locatedAction && !localPosition) {
      previewQuickAction(definition.code, localPosition);
      setQuickActionStatus(
        `${definition.label} previewed only — a GPS fix is required before this located action can be transmitted.`,
      );
      return;
    }

    if (!bushMeshLinkReady || !activeChannel || !radioSession.identityRef) {
      previewQuickAction(definition.code, localPosition);
      setQuickActionStatus(
        `${definition.label} previewed only — waiting for radio transport, identity and convoy channel.`,
      );
      return;
    }

    const channelIndex = Number(activeChannel.channelIndex);
    if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 7) {
      previewQuickAction(definition.code, localPosition);
      setQuickActionStatus(
        `${definition.label} previewed only — active channel index is invalid.`,
      );
      return;
    }

    const sequence = nextQuickActionSequence();

    try {
      queueDriverAction({
        channelIndex,
        sequence,
        action: definition.code,
        latitude: locatedAction ? localPosition?.latitude ?? null : null,
        longitude: locatedAction ? localPosition?.longitude ?? null : null,
        ttlSeconds: definition.defaultTtlSeconds,
      });

      const result = await drainOnce();
      const source: Exclude<DriveAlertSource, 'radio'> =
        result.outcome === 'accepted'
          ? 'local-accepted'
          : result.outcome === 'failed'
            ? 'local-failed'
            : 'local-queued';

      recordLocalQuickAction(
        definition.code,
        locatedAction ? localPosition : null,
        source,
        radioSession.identityRef,
        channelIndex,
      );

      if (result.outcome === 'accepted') {
        setQuickActionStatus(
          `${definition.label} accepted by MeshCore for transmission. Peer delivery is not yet confirmed.`,
        );
      } else if (result.outcome === 'failed') {
        setQuickActionStatus(
          `${definition.label} could not be accepted by the radio after retries.`,
        );
      } else {
        setQuickActionStatus(
          `${definition.label} remains queued and will be retried when the radio link is available.`,
        );
      }
    } catch (error) {
      recordLocalQuickAction(
        definition.code,
        locatedAction ? localPosition : null,
        'local-failed',
        radioSession.identityRef,
        channelIndex,
      );
      setQuickActionStatus(
        error instanceof Error ? error.message : 'Quick action could not be queued.',
      );
    }
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
            bushMeshLinkReady ? styles.connectionReady : styles.connectionOffline,
          ]}>
          <Text style={styles.connectionText}>
            {bushMeshLinkReady ? 'LINK READY' : connectionStatus}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.previewBanner,
          bushMeshLinkReady ? styles.readyBanner : undefined,
        ]}>
        <Text
          style={[
            styles.previewTitle,
            bushMeshLinkReady ? styles.readyBannerTitle : undefined,
          ]}>
          {bushMeshLinkReady ? 'BUSHMESH DATA LINK READY' : 'SAFE PREVIEW MODE'}
        </Text>
        <Text style={styles.previewText}>
          {bushMeshLinkReady
            ? `Radio identity ${radioSession.identityRef}. Driver actions will be encoded, queued and submitted to MeshCore; radio acceptance does not mean peer delivery.`
            : 'Driver controls remain local previews until a MeshCore transport, radio identity and convoy channel are all available.'}
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
                {alertSourceLabel(latestAlert.source)}
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
            onPress={() => void handleQuickAction(definition)}>
            <Text style={[styles.actionText, actionTextStyle(definition)]}>
              {definition.shortLabel}
            </Text>
            <Text style={[styles.actionHint, actionTextStyle(definition)]}>
              {definition.priority.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {quickActionStatus ? (
        <View style={styles.statusCard}>
          <Text style={styles.statusText}>{quickActionStatus}</Text>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Outbound radio queue</Text>
        <Text style={styles.sectionMeta}>
          {radioSession.queuedCount} queued
        </Text>
      </View>
      <View style={styles.queueRow}>
        <View style={styles.queueCell}>
          <Text style={styles.queueValue}>{radioSession.queuedCount}</Text>
          <Text style={styles.queueLabel}>QUEUED</Text>
        </View>
        <View style={styles.queueCell}>
          <Text style={styles.queueValue}>{radioSession.inflightCount}</Text>
          <Text style={styles.queueLabel}>IN FLIGHT</Text>
        </View>
        <View style={styles.queueCell}>
          <Text style={styles.queueValue}>{radioSession.acceptedCount}</Text>
          <Text style={styles.queueLabel}>ACCEPTED</Text>
        </View>
        <View style={styles.queueCell}>
          <Text style={styles.queueValue}>{radioSession.failedCount}</Text>
          <Text style={styles.queueLabel}>FAILED</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Trip readiness</Text>
      <View style={styles.readinessCard}>
        {tripReadiness.items.map(item => (
          <View key={item.key} style={styles.readinessRow}>
            <View
              style={[
                styles.readinessDot,
                item.state === 'ready'
                  ? styles.dotReady
                  : item.state === 'warning'
                    ? styles.dotWarning
                    : styles.dotNotReady,
              ]}
            />
            <View style={styles.readinessCopy}>
              <Text style={styles.readinessLabel}>{item.label}</Text>
              <Text style={styles.readinessDetail}>{item.detail}</Text>
            </View>
            <Text
              style={
                item.state === 'ready'
                  ? styles.readyText
                  : item.state === 'warning'
                    ? styles.warningText
                    : styles.notReadyText
              }>
              {item.state === 'ready'
                ? 'READY'
                : item.state === 'warning'
                  ? 'CHECK'
                  : 'WAIT'}
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
  readyBanner: {
    borderColor: colors.success,
  },
  previewTitle: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  readyBannerTitle: {
    color: colors.success,
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
    marginBottom: 12,
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
  statusCard: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 14,
    padding: 12,
    marginBottom: 20,
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  queueRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    marginBottom: 22,
  },
  queueCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  queueValue: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
  },
  queueLabel: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 2,
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
  dotWarning: {
    backgroundColor: colors.warning,
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
  warningText: {
    color: colors.warning,
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
