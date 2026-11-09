import React, {useEffect, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {BushMeshQuickActionCode} from '../../bushmesh/legacyProtocol';
import {getQuickActionDefinition} from '../quickActions';
import {colors} from '../../theme/colors';
import type {
  FieldCapability,
  FieldCapabilityState,
  FieldReadinessModel,
} from './fieldReadinessModel';

export type FieldReadinessDashboardProps = {
  model: FieldReadinessModel;
  /** Must open the real ConvoyMap route; this component never simulates maps. */
  onOpenMap: () => void;
  /** Must open real Device / offline map-pack management. */
  onManageMapPacks: () => void;
  onOpenConvoy: () => void;
  onOpenRadio: () => void;
  onOpenGpsSettings: () => void;
};

const STATUS_LABELS: Record<FieldCapabilityState, string> = {
  connected: 'CONNECTED',
  degraded: 'DEGRADED',
  unavailable: 'UNAVAILABLE',
  stale: 'STALE',
  'awaiting-authorisation': 'AWAITING AUTHORISATION',
};

function statusColor(state: FieldCapabilityState): string {
  if (state === 'connected') return colors.success;
  if (state === 'unavailable' || state === 'stale') return colors.danger;
  return colors.warning;
}

function FieldButton({
  label,
  onPress,
  emphasis = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  emphasis?: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{disabled}}
      disabled={disabled}
      activeOpacity={0.75}
      onPress={onPress}
      style={[
        styles.touch,
        emphasis && styles.primaryTouch,
        disabled && styles.disabled,
      ]}>
      <Text style={[styles.touchText, emphasis && styles.primaryTouchText]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function CapabilityTile({
  item,
}: {item: FieldCapability}): React.JSX.Element {
  return (
    <View
      style={styles.capability}
      accessible
      accessibilityLabel={item.key + ': ' + STATUS_LABELS[item.state] +
        '. ' + item.title + '. ' + item.detail}>
      <Text style={styles.capabilityLabel}>{item.key.toUpperCase()}</Text>
      <Text style={[styles.stateText, {color: statusColor(item.state)}]}>
        {STATUS_LABELS[item.state]}
      </Text>
      <Text style={styles.capabilityTitle}>{item.title}</Text>
      <Text style={styles.smallText}>{item.detail}</Text>
    </View>
  );
}

function Metric({label, value}: {
  label: string; value: string;
}): React.JSX.Element {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const PREVIEW_ACTIONS = [
  BushMeshQuickActionCode.Stop,
  BushMeshQuickActionCode.Help,
  BushMeshQuickActionCode.Hazard,
  BushMeshQuickActionCode.Regroup,
] as const;

/**
 * Read-only driver briefing + LOCAL previews. No send/queue handler is accepted
 * as a prop, and this module never imports the radio quick-action controller.
 */
export function FieldReadinessDashboard({
  model,
  onOpenMap,
  onManageMapPacks,
  onOpenConvoy,
  onOpenRadio,
  onOpenGpsSettings,
}: FieldReadinessDashboardProps): React.JSX.Element {
  const [pendingCritical, setPendingCritical] =
    useState<BushMeshQuickActionCode | null>(null);
  const [preview, setPreview] =
    useState<BushMeshQuickActionCode | null>(null);

  // Clear a pending confirmation when field/convoy state changes.
  useEffect(() => {
    setPendingCritical(null);
    setPreview(null);
  }, [
    model.convoy.name,
    model.convoy.remoteCount,
    model.previewAvailable,
    model.allChecksReady,
  ]);

  const requestPreview = (code: BushMeshQuickActionCode) => {
    if (!model.previewAvailable) {
      return;
    }
    if (code === BushMeshQuickActionCode.Stop ||
      code === BushMeshQuickActionCode.Help) {
      setPendingCritical(code);
      setPreview(null);
    } else {
      setPendingCritical(null);
      setPreview(code);
    }
  };

  return (
    <ScrollView
      accessibilityLabel="BushMesh field readiness"
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>BUSHMESH / FIELD READINESS</Text>
        <Text style={styles.heroTitle}>{model.title}</Text>
        <Text style={styles.bodyText}>{model.detail}</Text>
        <Text style={styles.notice}>
          Review before departure. Check controls only when safely stopped.
        </Text>
      </View>

      <View style={styles.grid}>
        {model.capabilities.map(capability => (
          <CapabilityTile key={capability.key} item={capability} />
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Offline ConvoyMap</Text>
        <View style={styles.card}>
          <Text style={styles.emphasisText}>{model.maps.imageryLabel}</Text>
          <Text style={styles.bodyText}>{model.maps.detail}</Text>
          <Text style={styles.smallText}>{model.maps.inventoryLabel}</Text>
          <Text style={styles.bodyText}>{model.maps.coverageLabel}</Text>
          <Text style={styles.smallText}>{model.maps.downloadLabel}</Text>
          <FieldButton label="Open ConvoyMap" emphasis onPress={onOpenMap} />
          <FieldButton
            label="Manage offline map packs"
            onPress={onManageMapPacks}
            disabled={model.moving}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your GPS</Text>
        <View style={styles.card}>
          <Text style={[styles.emphasisText, {
            color: statusColor(model.gps.state),
          }]}>
            {model.gps.title.toUpperCase()}
          </Text>
          <Text style={styles.bodyText}>
            {model.gps.lastKnown
              ? 'LAST KNOWN POSITION — not a current navigation fix.'
              : model.gps.detail}
          </Text>
          <View style={styles.metrics}>
            <Metric label="HEADING" value={model.gps.heading} />
            <Metric label="ACCURACY" value={model.gps.accuracy} />
            <Metric label="POSITION AGE" value={model.gps.positionAge} />
          </View>
          <View style={styles.metrics}>
            <Metric label="LAT" value={model.gps.latitude} />
            <Metric label="LON" value={model.gps.longitude} />
          </View>
          <FieldButton label="GPS details" onPress={onOpenGpsSettings}
            disabled={model.moving} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Authorised convoy</Text>
        <View style={styles.card}>
          <Text style={styles.emphasisText}>{model.convoy.name}</Text>
          <Text style={styles.bodyText}>{model.convoy.detail}</Text>
          <View style={styles.metrics}>
            <Metric label="VERIFIED REMOTE"
              value={model.convoy.remoteCount === null
                ? 'UNKNOWN' : String(model.convoy.remoteCount)} />
            <Metric label="LIVE"
              value={model.convoy.live === null
                ? '—' : String(model.convoy.live)} />
            <Metric label="NEED CHECK"
              value={model.convoy.attention === null
                ? '—' : String(model.convoy.attention)} />
          </View>
          <FieldButton label="Convoy selection" onPress={onOpenConvoy}
            disabled={model.moving} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Verified convoy alerts</Text>
        {model.alerts.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.bodyText}>{model.alertsLabel}</Text>
          </View>
        ) : model.alerts.map(alert => {
          const critical = alert.action === BushMeshQuickActionCode.Stop ||
            alert.action === BushMeshQuickActionCode.Help;
          return (
            <View key={alert.id} style={[
              styles.alert,
              {borderLeftColor: critical ? colors.danger : colors.warning},
            ]}>
              <Text style={styles.alertTitle}>{alert.label.toUpperCase()}</Text>
              <Text style={styles.bodyText}>{alert.description}</Text>
              <Text style={styles.smallText}>
                Authorised convoy sender: {alert.senderId}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Radio traffic</Text>
        <View style={styles.card}>
          <View style={styles.metrics}>
            <Metric label="CARRIER RX / 5 MIN"
              value={String(model.traffic.carrierRxLast5Min)} />
            <Metric label="PENDING" value={String(model.traffic.pending)} />
            <Metric label="FAILED" value={String(model.traffic.failed)} />
          </View>
          <Text style={styles.smallText}>
            MeshCore carrier traffic is not a verified convoy message count.
            Radio acceptance never proves delivery to another vehicle.
          </Text>
          <FieldButton label="Radio messages" onPress={onOpenRadio}
            disabled={model.moving} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Safety-action previews</Text>
        <Text style={styles.notice}>{model.previewReason}</Text>
        <View style={styles.actionGrid}>
          {PREVIEW_ACTIONS.map(code => {
            const action = getQuickActionDefinition(code);
            return (
              <TouchableOpacity
                key={code}
                accessible
                accessibilityRole="button"
                accessibilityLabel={'Preview ' + action.shortLabel}
                accessibilityHint="Local informational preview only. Never transmits."
                accessibilityState={{disabled: !model.previewAvailable}}
                disabled={!model.previewAvailable}
                onPress={() => requestPreview(code)}
                style={[
                  styles.actionTouch,
                  !model.previewAvailable && styles.disabled,
                ]}>
                <Text style={styles.actionTitle}>{action.shortLabel}</Text>
                <Text style={styles.actionSubtitle}>LOCAL PREVIEW</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {pendingCritical !== null && model.previewAvailable ? (
          <View style={styles.confirmCard}>
            <Text style={styles.emphasisText}>
              Preview {getQuickActionDefinition(pendingCritical).shortLabel}?
            </Text>
            <Text style={styles.bodyText}>
              This is a local demonstration. It will not contact the convoy,
              send a packet, or request help.
            </Text>
            <FieldButton
              label={'Confirm local ' +
                getQuickActionDefinition(pendingCritical).shortLabel + ' preview'}
              onPress={() => {
                setPreview(pendingCritical);
                setPendingCritical(null);
              }}
            />
            <FieldButton label="Cancel preview"
              onPress={() => setPendingCritical(null)} />
          </View>
        ) : null}
        {preview !== null ? (
          <View accessibilityLiveRegion="polite" style={styles.previewCard}>
            <Text style={styles.emphasisText}>
              LOCAL PREVIEW — {getQuickActionDefinition(preview).shortLabel}
            </Text>
            <Text style={styles.bodyText}>
              {getQuickActionDefinition(preview).description}
            </Text>
            <Text style={styles.notice}>
              NOT TRANSMITTED. No other vehicle has received this.
            </Text>
            <FieldButton label="Close preview"
              onPress={() => setPreview(null)} />
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 42, gap: 20},
  hero: {
    backgroundColor: colors.surface,
    borderRadius: 18, borderWidth: 1, borderColor: colors.border,
    padding: 18, gap: 8,
  },
  eyebrow: {color: colors.accent, fontWeight: '800', fontSize: 12, letterSpacing: 1},
  heroTitle: {color: colors.textPrimary, fontSize: 25, fontWeight: '900'},
  bodyText: {color: colors.textPrimary, fontSize: 14, lineHeight: 21},
  notice: {color: colors.warning, fontSize: 13, lineHeight: 20},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  capability: {
    width: '48%', backgroundColor: colors.surfaceSoft,
    borderRadius: 14, padding: 13, borderWidth: 1, borderColor: colors.border,
    gap: 5, minHeight: 138,
  },
  capabilityLabel: {color: colors.textSecondary, fontSize: 12, fontWeight: '800'},
  capabilityTitle: {color: colors.textPrimary, fontSize: 15, fontWeight: '800'},
  stateText: {fontSize: 12, fontWeight: '900'},
  smallText: {color: colors.textSecondary, fontSize: 12, lineHeight: 19},
  section: {gap: 10},
  sectionTitle: {color: colors.textPrimary, fontSize: 20, fontWeight: '900'},
  card: {
    padding: 16, gap: 13, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: 16,
  },
  emphasisText: {color: colors.textPrimary, fontSize: 18, fontWeight: '900'},
  touch: {
    minHeight: 56, paddingHorizontal: 16, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, backgroundColor: colors.surfaceSoft,
    borderWidth: 1, borderColor: colors.border,
  },
  touchText: {color: colors.textPrimary, fontSize: 15, fontWeight: '800'},
  primaryTouch: {backgroundColor: colors.accent, borderColor: colors.accent},
  primaryTouchText: {color: colors.background},
  disabled: {opacity: 0.45},
  metrics: {flexDirection: 'row', gap: 10},
  metric: {flex: 1, minWidth: 0, gap: 4},
  metricLabel: {color: colors.textSecondary, fontSize: 10, fontWeight: '800'},
  metricValue: {color: colors.textPrimary, fontSize: 16, fontWeight: '900'},
  alert: {
    borderLeftWidth: 5, padding: 16, gap: 9,
    backgroundColor: colors.surfaceSoft, borderRadius: 12,
  },
  alertTitle: {color: colors.textPrimary, fontSize: 24, fontWeight: '900'},
  actionGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  actionTouch: {
    width: '48%', minHeight: 96, padding: 14,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    justifyContent: 'space-between',
  },
  actionTitle: {color: colors.textPrimary, fontSize: 23, fontWeight: '900'},
  actionSubtitle: {color: colors.textSecondary, fontSize: 11, fontWeight: '800'},
  confirmCard: {
    gap: 12, padding: 16, borderRadius: 14,
    borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.surface,
  },
  previewCard: {
    gap: 12, padding: 16, borderRadius: 14,
    borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface,
  },
});
