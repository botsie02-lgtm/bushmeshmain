import React, {useState} from 'react';
import {
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import {BushMeshQuickActionCode} from '../../bushmesh/legacyProtocol';
import {getQuickActionDefinition} from '../quickActions';
import {ConvoyMap} from '../../maps/ConvoyMap';
import type {BushMeshMapPackCatalogEntry} from '../../maps/mapPackCatalog';
import {colors} from '../../theme/colors';
import type {DashboardActionResult} from './quickActionController';
import {DASHBOARD_ACTIONS} from './quickActionController';
import type {DriveDashboardModel} from './driveDashboardModel';

export type DriveDashboardProps = {
  model: DriveDashboardModel;
  packCatalog: readonly BushMeshMapPackCatalogEntry[];
  onOpenMap: () => void;
  onOpenConvoy: () => void;
  onOpenRadio?: () => void;
  onOpenDevice?: () => void;
  onQuickAction: (code: BushMeshQuickActionCode) => void;
  onDismissVerifiedAlert?: (alertId: string) => void;
  busyAction?: BushMeshQuickActionCode | null;
  actionResult?: DashboardActionResult | null;
  /** Embed the REAL offline ConvoyMap when desired; never a static illustration. */
  showInlineMap?: boolean;
  nowMs?: number;
};

function LargeButton({
  label, onPress, variant = 'neutral', disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'neutral' | 'danger';
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.largeButton,
        variant === 'primary' && styles.primaryButton,
        variant === 'danger' && styles.dangerButton,
        disabled && styles.disabled,
      ]}>
      <Text style={[
        styles.largeButtonText,
        variant === 'primary' && styles.primaryButtonText,
      ]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Metric({label, value, caution = false}: {
  label: string; value: string; caution?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, caution && styles.caution]}>{value}</Text>
    </View>
  );
}

function Section({title, children}: {
  title: string; children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

/** Purely presentational, vehicle-first Drive surface; performs no radio I/O. */
export function DriveDashboard({
  model, packCatalog, onOpenMap, onOpenConvoy, onOpenRadio, onOpenDevice,
  onQuickAction, onDismissVerifiedAlert, busyAction = null, actionResult = null,
  showInlineMap = false, nowMs,
}: DriveDashboardProps): React.JSX.Element {
  const [confirmAction, setConfirmAction] = useState<BushMeshQuickActionCode | null>(null);
  const canTransmit = model.actionAvailability.canTransmit;
  const pressAction = (action: BushMeshQuickActionCode) => {
    if (busyAction !== null) {
      return;
    }
    // Avoid an accidental critical transmission while driving. Previews
    // require no confirmation because they never enter the radio queue.
    if (canTransmit &&
      (action === BushMeshQuickActionCode.Stop ||
        action === BushMeshQuickActionCode.Help)) {
      setConfirmAction(action);
      return;
    }
    setConfirmAction(null);
    onQuickAction(action);
  };
  const statusReady = model.status === 'ready';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      accessibilityLabel="BushMesh Drive dashboard"
      showsVerticalScrollIndicator={false}>
      <View style={[styles.hero, statusReady && styles.heroReady]}>
        <Text style={styles.eyebrow}>DRIVE / OPERATIONAL STATUS</Text>
        <Text style={styles.heroTitle}>{model.statusTitle}</Text>
        <Text style={styles.heroDescription}>{model.statusDetail}</Text>
        <View style={styles.heroDivider} />
        <View style={styles.inlineRow}>
          <Text style={styles.inlineLabel}>RADIO CONNECTION</Text>
          <Text style={[
            styles.inlineValue,
            model.radioStatus === 'ready' ? styles.good : styles.caution,
          ]}>
            {model.radioStatus === 'ready' ? 'DATA LINK READY' :
              model.radioStatus === 'connected' ? 'NODE CONNECTED' : 'OFFLINE'}
          </Text>
        </View>
        <Text style={styles.smallDetail}>{model.connectionDetail}</Text>
      </View>

      <Section title="Active convoy">
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{model.convoy.name}</Text>
          <Text style={styles.panelHint}>
            {model.convoy.id === null
              ? 'No authorised convoy is selected. MeshCore contacts are not members.'
              : model.convoy.memberRosterVerified
                ? 'Authorised operational membership, not a carrier channel.'
                : 'Membership selected; verified remote roster unavailable.'}
          </Text>
          <View style={styles.metricsRow}>
            <Metric label="VERIFIED REMOTE"
              value={model.convoy.verifiedMemberCount === null
                ? 'Unknown' : String(model.convoy.verifiedMemberCount)} />
            <Metric label="LIVE"
              value={model.convoy.memberRosterVerified
                ? String(model.convoy.live) : '—'} />
            <Metric label="NEEDS CHECK"
              value={model.convoy.memberRosterVerified
                ? String(model.convoy.stale + model.convoy.lost + model.convoy.noPosition)
                : '—'}
              caution={model.convoy.memberRosterVerified &&
                model.convoy.stale + model.convoy.lost + model.convoy.noPosition > 0} />
          </View>
          {model.convoy.memberRosterVerified ? (
            <Text style={styles.smallDetail}>
              Recent {model.convoy.recent} · Stale {model.convoy.stale} ·
              Lost {model.convoy.lost} · No fix {model.convoy.noPosition}
            </Text>
          ) : null}
          <LargeButton label="Manage convoy" onPress={onOpenConvoy} />
        </View>
      </Section>

      <Section title="Your position">
        <View style={styles.panel}>
          <View style={styles.inlineRow}>
            <Text style={[
              styles.panelStatus,
              model.gps.freshness === 'live' && !model.gps.simulated
                ? styles.good : styles.caution,
            ]}>
              {model.gps.simulated ? 'SIMULATED GPS' :
                model.gps.freshness === 'unknown' ? 'NO GPS FIX' :
                  model.gps.freshness.toUpperCase() + ' GPS'}
            </Text>
            <Text style={styles.smallDetail}>{model.gps.ageLabel}</Text>
          </View>
          <View style={styles.metricsRow}>
            <Metric label="HEADING" value={model.gps.headingLabel} />
            <Metric label="ACCURACY" value={model.gps.accuracyLabel} />
          </View>
          <View style={styles.metricsRow}>
            <Metric label="LATITUDE" value={model.gps.latitudeLabel} />
            <Metric label="LONGITUDE" value={model.gps.longitudeLabel} />
          </View>
          {model.gps.freshness === 'stale' || model.gps.freshness === 'lost' ? (
            <Text style={styles.caution}>
              Last-known coordinates only. Do not navigate using stale GPS.
            </Text>
          ) : null}
          {onOpenDevice ? (
            <LargeButton label="GPS settings" onPress={onOpenDevice} />
          ) : null}
        </View>
      </Section>

      <Section title="Safety alerts">
        <View style={styles.panel}>
          {!model.alertsAvailable ? (
            <Text style={styles.panelHint}>
              Verified convoy alerts are not connected. Unverified public-channel
              alerts are intentionally excluded.
            </Text>
          ) : model.alerts.length === 0 ? (
            <Text style={styles.panelHint}>No current verified convoy alerts.</Text>
          ) : (
            model.alerts.map(alert => (
              <View key={alert.id} style={styles.alertRow}>
                <Text style={styles.alertTitle}>{alert.label}</Text>
                <Text style={styles.alertDetail}>{alert.description}</Text>
                <Text style={styles.alertMeta}>
                  Received from authorised member · {alert.senderId}
                </Text>
                {onDismissVerifiedAlert ? (
                  <LargeButton
                    label={'Dismiss alert ' + alert.id}
                    onPress={() => onDismissVerifiedAlert(alert.id)}
                  />
                ) : null}
              </View>
            ))
          )}
        </View>
      </Section>

      <Section title="Quick actions">
        <Text style={styles.panelHint}>
          {canTransmit
            ? 'Sends through the explicitly authorised carrier. Radio acceptance is NOT peer delivery.'
            : 'LOCAL PREVIEW ONLY. ' + model.actionAvailability.reason}
        </Text>
        <View style={styles.actionGrid}>
          {DASHBOARD_ACTIONS.map(code => {
            const action = getQuickActionDefinition(code);
            const isCritical = code === BushMeshQuickActionCode.Stop ||
              code === BushMeshQuickActionCode.Help;
            return (
              <TouchableOpacity
                key={code}
                accessibilityRole="button"
                accessibilityLabel={action.shortLabel}
                accessibilityHint={canTransmit
                  ? 'Radio quick action' : 'Local preview; will not transmit'}
                accessibilityState={{disabled: busyAction !== null}}
                disabled={busyAction !== null}
                onPress={() => pressAction(code)}
                style={[
                  styles.actionButton,
                  isCritical ? styles.actionCritical : styles.actionControl,
                  busyAction !== null && styles.disabled,
                ]}>
                <Text style={styles.actionTitle}>{action.shortLabel}</Text>
                <Text style={styles.actionSub}>
                  {busyAction === code ? 'WORKING…' :
                    canTransmit ? 'RADIO ACTION' : 'PREVIEW'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {confirmAction !== null && canTransmit ? (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmText}>
              Confirm {getQuickActionDefinition(confirmAction).shortLabel} radio
              action. This may be heard by other carrier participants.
            </Text>
            <View style={styles.confirmRow}>
              <View style={styles.confirmCell}>
                <LargeButton
                  label={'Confirm ' + getQuickActionDefinition(confirmAction).shortLabel}
                  variant="danger"
                  disabled={busyAction !== null}
                  onPress={() => {
                    const action = confirmAction;
                    setConfirmAction(null);
                    onQuickAction(action);
                  }}
                />
              </View>
              <View style={styles.confirmCell}>
                <LargeButton label="Cancel" onPress={() => setConfirmAction(null)} />
              </View>
            </View>
          </View>
        ) : null}
        {actionResult ? (
          <View style={styles.resultBox}>
            <Text style={styles.resultText} accessibilityRole="alert">
              {actionResult.message}
            </Text>
          </View>
        ) : null}
      </Section>

      <Section title="Offline convoy map">
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{model.maps.label}</Text>
          <Text style={styles.panelHint}>{model.maps.detail}</Text>
          <LargeButton label="Open ConvoyMap" variant="primary" onPress={onOpenMap} />
          {showInlineMap ? (
            <View style={styles.mapInline}>
              <ConvoyMap
                activeConvoyId={model.convoy.id}
                authorisedMembers={model.mapMembers}
                selfFix={model.gps.fix}
                packCatalog={packCatalog}
                height={280}
                nowMs={nowMs}
              />
            </View>
          ) : null}
        </View>
      </Section>

      <View style={styles.footer}>
        <View style={styles.metricsRow}>
          <Metric label="CARRIER RX / 5 MIN"
            value={String(model.incomingCarrierMessages)} />
          <Metric label="RADIO PENDING" value={String(model.outgoingPending)} />
          <Metric label="FAILED" value={String(model.outgoingFailed)}
            caution={model.outgoingFailed > 0} />
        </View>
        <Text style={styles.smallDetail}>
          Carrier traffic is not authenticated convoy traffic. Pending, accepted
          and delivered are different radio states.
        </Text>
        {onOpenRadio ? (
          <LargeButton label="Open Radio" onPress={onOpenRadio} />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 38, gap: 18},
  eyebrow: {color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2},
  hero: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.surface,
    padding: 18,
    gap: 9,
  },
  heroReady: {borderColor: colors.success},
  heroTitle: {color: colors.textPrimary, fontSize: 25, fontWeight: '900'},
  heroDescription: {color: colors.textSecondary, fontSize: 14, lineHeight: 21},
  heroDivider: {height: 1, backgroundColor: colors.border, marginVertical: 4},
  inlineRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10},
  inlineLabel: {color: colors.textSecondary, fontSize: 11, fontWeight: '800'},
  inlineValue: {fontWeight: '900', fontSize: 12},
  good: {color: colors.success},
  caution: {color: colors.warning, fontWeight: '700'},
  smallDetail: {color: colors.textSecondary, fontSize: 12, lineHeight: 18},
  section: {gap: 9},
  sectionTitle: {fontSize: 19, fontWeight: '900', color: colors.textPrimary},
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 15,
    gap: 12,
  },
  panelTitle: {fontSize: 21, fontWeight: '800', color: colors.textPrimary},
  panelHint: {fontSize: 13, lineHeight: 20, color: colors.textSecondary},
  panelStatus: {fontSize: 14, fontWeight: '900'},
  metricsRow: {flexDirection: 'row', gap: 10},
  metric: {flex: 1, minWidth: 0, gap: 4},
  metricLabel: {color: colors.textSecondary, fontSize: 10, fontWeight: '800'},
  metricValue: {color: colors.textPrimary, fontSize: 16, fontWeight: '900'},
  largeButton: {
    minHeight: 56, paddingHorizontal: 16, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1, borderColor: colors.border, borderRadius: 12,
  },
  largeButtonText: {color: colors.textPrimary, fontWeight: '900', fontSize: 14, textAlign: 'center'},
  primaryButton: {backgroundColor: colors.accent, borderColor: colors.accent},
  primaryButtonText: {color: colors.background},
  dangerButton: {backgroundColor: colors.danger, borderColor: colors.danger},
  disabled: {opacity: 0.45},
  actionGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  actionButton: {
    width: '48%', minHeight: 94, borderRadius: 16,
    padding: 15, justifyContent: 'space-between',
  },
  actionCritical: {backgroundColor: colors.danger},
  actionControl: {backgroundColor: colors.warning},
  actionTitle: {fontSize: 23, fontWeight: '900', color: colors.background},
  actionSub: {fontSize: 11, fontWeight: '800', color: colors.background},
  confirmBox: {
    borderRadius: 12, borderWidth: 1, borderColor: colors.warning,
    padding: 14, backgroundColor: colors.surface,
    gap: 12,
  },
  confirmText: {color: colors.textPrimary, fontSize: 14, lineHeight: 20},
  confirmRow: {flexDirection: 'row', gap: 10},
  confirmCell: {flex: 1},
  resultBox: {padding: 14, backgroundColor: colors.surfaceSoft, borderRadius: 12},
  resultText: {color: colors.textPrimary, fontSize: 13, lineHeight: 20},
  mapInline: {marginTop: 4, borderRadius: 12, overflow: 'hidden'},
  alertRow: {
    borderLeftWidth: 3, borderLeftColor: colors.warning,
    paddingLeft: 12, gap: 5,
  },
  alertTitle: {color: colors.textPrimary, fontSize: 22, fontWeight: '900'},
  alertDetail: {color: colors.textSecondary, fontSize: 14, lineHeight: 20},
  alertMeta: {color: colors.textSecondary, fontSize: 11},
  footer: {
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, borderRadius: 16,
    padding: 15, gap: 14,
  },
});
