import React, {useEffect, useRef, useState} from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {BushMeshDistressType} from '../bushmesh/protocol';
import {
  BushMeshDistressBeacon,
  BushMeshDistressBeaconState,
} from '../bushmesh/runtime/BushMeshDistressBeacon';
import {getActiveBushMeshRuntime} from '../bushmesh/runtime/BushMeshRuntimeHub';
import {useBushMesh} from '../state/BushMeshContext';
import {useBushMeshLiveState} from '../state/useBushMeshLiveState';
import {colors} from '../theme/colors';

type DistressOption = {
  type: BushMeshDistressType;
  label: string;
  detail: string;
};

const distressOptions: DistressOption[] = [
  {type: BushMeshDistressType.General, label: 'SOS', detail: 'General emergency'},
  {type: BushMeshDistressType.Medical, label: 'Medical', detail: 'Medical assistance required'},
  {type: BushMeshDistressType.Injury, label: 'Injury', detail: 'Person injured'},
  {type: BushMeshDistressType.Fire, label: 'Fire', detail: 'Fire or immediate fire danger'},
  {type: BushMeshDistressType.Lost, label: 'Lost', detail: 'Lost or separated from group'},
  {type: BushMeshDistressType.Vehicle, label: 'Vehicle', detail: 'Vehicle disabled or stranded'},
  {type: BushMeshDistressType.NeedWater, label: 'Water', detail: 'Urgent water requirement'},
  {type: BushMeshDistressType.Flood, label: 'Flood', detail: 'Flood or water crossing danger'},
];

const IDLE_BEACON_STATE: BushMeshDistressBeaconState = {
  active: false,
  messageId: null,
  transmissions: 0,
  remainingRepeats: 0,
};

function distressLabel(type: number): string {
  return distressOptions.find(option => option.type === type)?.label ?? `Alert ${type}`;
}

function nodeIdLabel(nodeId: number): string {
  return nodeId.toString(16).padStart(8, '0').toUpperCase();
}

function receivedAge(receivedAt: number): string {
  const ageMs = Math.max(0, Date.now() - receivedAt);
  if (ageMs < 60_000) {
    return 'just now';
  }
  if (ageMs < 60 * 60_000) {
    return `${Math.floor(ageMs / 60_000)} min ago`;
  }
  if (ageMs < 24 * 60 * 60_000) {
    return `${Math.floor(ageMs / (60 * 60_000))} hr ago`;
  }
  return `${Math.floor(ageMs / (24 * 60 * 60_000))} day(s) ago`;
}

export function EmergencyScreen(): React.JSX.Element {
  const {
    connectionStatus,
    localBushMeshNodeId,
    activeChannel,
    bushMeshNetworkStatus,
  } = useBushMesh();
  const {distressAlerts} = useBushMeshLiveState();

  const beaconRef = useRef<BushMeshDistressBeacon | null>(null);
  const [selectedType, setSelectedType] = useState<BushMeshDistressType>(
    BushMeshDistressType.General,
  );
  const [beaconState, setBeaconState] =
    useState<BushMeshDistressBeaconState>(IDLE_BEACON_STATE);
  const [status, setStatus] = useState(
    'Choose an alert type. BushMesh will send an emergency-priority routed beacon with repeated transmissions.',
  );
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const beacon = beaconRef.current;
      if (!beacon) {
        return;
      }

      const next = beacon.state();
      setBeaconState(next);

      if (!next.active && next.transmissions > 0) {
        beaconRef.current = null;
        setStatus(
          `Emergency beacon sequence complete after ${next.transmissions} transmission(s).`,
        );
      }
    }, 1000);

    return () => {
      clearInterval(timer);
      beaconRef.current?.stop();
      beaconRef.current = null;
    };
  }, []);

  const channelIndex = activeChannel ? Number(activeChannel.channelIndex) : NaN;
  const ready =
    connectionStatus === 'Connected' &&
    localBushMeshNodeId !== null &&
    Number.isInteger(channelIndex) &&
    bushMeshNetworkStatus.active;

  const startBeacon = async () => {
    if (!ready || localBushMeshNodeId === null || !Number.isInteger(channelIndex)) {
      setStatus(
        'BushMesh SOS is not ready. Connect a companion node and select an active channel first.',
      );
      return;
    }

    const network = getActiveBushMeshRuntime();
    if (!network) {
      setStatus('BushMesh networking runtime is not active.');
      return;
    }

    try {
      setIsStarting(true);
      beaconRef.current?.stop();

      const beacon = new BushMeshDistressBeacon(
        network,
        () => localBushMeshNodeId,
      );
      beaconRef.current = beacon;

      const messageId = await beacon.start(
        channelIndex,
        {type: selectedType},
        {
          ttlHops: 6,
          repeatDelaysMs: [15_000, 45_000, 90_000],
        },
      );

      setBeaconState(beacon.state());
      setStatus(
        `Emergency beacon ${messageId} started on ${activeChannel?.channelName ?? `channel ${channelIndex}`}. Initial alert sent; repeats are scheduled at approximately 15, 45 and 90 seconds with collision jitter.`,
      );
    } catch (error) {
      beaconRef.current?.stop();
      beaconRef.current = null;
      setBeaconState(IDLE_BEACON_STATE);
      setStatus(
        error instanceof Error ? error.message : 'Failed to start BushMesh distress beacon.',
      );
    } finally {
      setIsStarting(false);
    }
  };

  const cancelBeacon = () => {
    const transmissions =
      beaconRef.current?.state().transmissions ?? beaconState.transmissions;
    beaconRef.current?.stop();
    beaconRef.current = null;
    setBeaconState({
      active: false,
      messageId: null,
      transmissions,
      remainingRepeats: 0,
    });
    setStatus(
      `Emergency beacon repeats cancelled after ${transmissions} transmission(s). Previously transmitted alerts cannot be recalled.`,
    );
  };

  const openAlertLocation = async (
    nodeId: number,
    latitude: number,
    longitude: number,
  ) => {
    const label = encodeURIComponent(`BushMesh SOS ${nodeIdLabel(nodeId)}`);
    const candidates = [
      `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`,
      `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    ];

    for (const url of candidates) {
      try {
        if (await Linking.canOpenURL(url)) {
          await Linking.openURL(url);
          return;
        }
      } catch {
        // Try the next map URL if this handler fails.
      }
    }

    setStatus('No compatible mapping app was available for the distress location.');
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Emergency</Text>
        <Text style={styles.title}>BushMesh SOS</Text>
        <Text style={styles.body}>
          Sends a compact emergency-priority routed BushMesh packet. The same
          beacon is repeated a small number of times to improve the chance of
          reaching another node without continuously flooding the channel.
        </Text>
      </View>

      <View style={styles.readinessCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.statusLabel}>Emergency readiness</Text>
            <Text style={[styles.statusValue, ready && styles.statusReady]}>
              {ready ? 'Ready' : 'Not ready'}
            </Text>
          </View>
          <View style={styles.channelBox}>
            <Text style={styles.channelLabel}>Channel</Text>
            <Text style={styles.channelValue}>
              {activeChannel
                ? `${activeChannel.channelName} #${activeChannel.channelIndex}`
                : 'None'}
            </Text>
          </View>
        </View>
        <Text style={styles.runtimeDetail}>{bushMeshNetworkStatus.detail}</Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Alert Type</Text>
        <Text style={styles.sectionBody}>
          Select the category that best describes the situation. The wire packet
          uses a compact numeric category rather than transmitting this label.
        </Text>

        <View style={styles.optionGrid}>
          {distressOptions.map(option => {
            const selected = option.type === selectedType;
            return (
              <TouchableOpacity
                key={option.type}
                style={[styles.optionCard, selected && styles.optionCardSelected]}
                onPress={() => setSelectedType(option.type)}>
                <Text
                  style={[
                    styles.optionLabel,
                    selected && styles.optionLabelSelected,
                  ]}>
                  {option.label}
                </Text>
                <Text style={styles.optionDetail}>{option.detail}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Transmit</Text>
        <Text style={styles.sectionBody}>{status}</Text>

        {!beaconState.active ? (
          <TouchableOpacity
            style={[
              styles.sosButton,
              (!ready || isStarting) && styles.buttonDisabled,
            ]}
            disabled={!ready || isStarting}
            onPress={startBeacon}>
            <Text style={styles.sosButtonText}>
              {isStarting ? 'Starting...' : 'SEND EMERGENCY BEACON'}
            </Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.activeBeaconCard}>
              <Text style={styles.activeBeaconTitle}>Beacon active</Text>
              <Text style={styles.activeBeaconText}>
                Message ID {beaconState.messageId ?? '--'}
              </Text>
              <Text style={styles.activeBeaconText}>
                Transmissions {beaconState.transmissions} • Remaining repeats{' '}
                {beaconState.remainingRepeats}
              </Text>
            </View>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelBeacon}>
              <Text style={styles.cancelButtonText}>Cancel future repeats</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.sectionTitle}>Received Distress Alerts</Text>
            <Text style={styles.sectionBody}>
              Source-attributed routed SOS packets received during this app
              session. Repeated copies of the same routed message are collapsed.
            </Text>
          </View>
          <View style={styles.alertCountBadge}>
            <Text style={styles.alertCountText}>{distressAlerts.length}</Text>
          </View>
        </View>

        {distressAlerts.length === 0 ? (
          <Text style={styles.emptyText}>No BushMesh distress alerts received.</Text>
        ) : (
          distressAlerts.map(alert => {
            const hasLocation =
              typeof alert.latitude === 'number' &&
              typeof alert.longitude === 'number';

            return (
              <View key={alert.key} style={styles.receivedAlertCard}>
                <View style={styles.rowBetween}>
                  <View style={styles.flexOne}>
                    <Text style={styles.receivedAlertType}>
                      {distressLabel(alert.type)}
                    </Text>
                    <Text style={styles.receivedAlertNode}>
                      Node {nodeIdLabel(alert.nodeId)} • Channel #{alert.channelIndex}
                    </Text>
                  </View>
                  <Text style={styles.receivedAlertAge}>
                    {receivedAge(alert.receivedAt)}
                  </Text>
                </View>

                <Text style={styles.receivedAlertMeta}>
                  Message {alert.messageId}
                  {alert.batteryPercent === undefined
                    ? ''
                    : ` • Battery ${alert.batteryPercent}%`}
                </Text>

                {hasLocation ? (
                  <TouchableOpacity
                    style={styles.locationButton}
                    onPress={() =>
                      openAlertLocation(
                        alert.nodeId,
                        alert.latitude as number,
                        alert.longitude as number,
                      )
                    }>
                    <Text style={styles.locationButtonText}>
                      Open {alert.latitude?.toFixed(6)}, {alert.longitude?.toFixed(6)} in maps
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.noLocationText}>
                    No location was included with this alert.
                  </Text>
                )}
              </View>
            );
          })
        )}
      </View>

      <View style={styles.warningCard}>
        <Text style={styles.warningTitle}>Important</Text>
        <Text style={styles.warningText}>
          BushMesh is an experimental off-grid communications system and is not a
          substitute for emergency services, a satellite communicator, PLB or
          other certified distress equipment. Use available emergency channels
          and services whenever possible.
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
    color: colors.danger,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '900',
    marginBottom: 10,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  readinessCard: {
    marginTop: 16,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  flexOne: {
    flex: 1,
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  statusValue: {
    color: colors.textSecondary,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 4,
  },
  statusReady: {
    color: colors.success,
  },
  channelBox: {
    maxWidth: '55%',
    alignItems: 'flex-end',
  },
  channelLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  channelValue: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 4,
    textAlign: 'right',
  },
  runtimeDetail: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
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
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  optionCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  optionCardSelected: {
    borderColor: colors.danger,
    borderWidth: 2,
  },
  optionLabel: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  optionLabelSelected: {
    color: colors.danger,
  },
  optionDetail: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 5,
  },
  sosButton: {
    marginTop: 16,
    backgroundColor: colors.danger,
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: 'center',
  },
  sosButtonText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  activeBeaconCard: {
    marginTop: 14,
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 13,
  },
  activeBeaconTitle: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '900',
  },
  activeBeaconText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 6,
  },
  cancelButton: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 13,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
  },
  alertCountBadge: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  alertCountText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
  },
  receivedAlertCard: {
    marginTop: 12,
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 13,
  },
  receivedAlertType: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '900',
  },
  receivedAlertNode: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 4,
  },
  receivedAlertAge: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  receivedAlertMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 9,
  },
  locationButton: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: 10,
  },
  locationButtonText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
  },
  noLocationText: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 9,
  },
  warningCard: {
    marginTop: 18,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: 16,
  },
  warningTitle: {
    color: colors.warning,
    fontSize: 14,
    fontWeight: '900',
  },
  warningText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
  },
});
