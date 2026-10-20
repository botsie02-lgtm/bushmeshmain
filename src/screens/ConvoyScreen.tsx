import React, {useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {BushMeshConvoyRole} from '../bushmesh/protocol';
import {
  clearBushMeshConvoyRemoteState,
  configureBushMeshConvoy,
  nextBushMeshConvoyStatus,
  updateBushMeshConvoyTelemetry,
} from '../bushmesh/runtime/BushMeshConvoyHub';
import {
  getBushMeshNativePosition,
  isBushMeshNativeLocationAvailable,
} from '../bushmesh/runtime/BushMeshNativeLocation';
import {sendActiveBushMeshConvoyStatus} from '../bushmesh/runtime/BushMeshRuntimeHub';
import {useBushMesh} from '../state/BushMeshContext';
import {useBushMeshConvoyState} from '../state/useBushMeshConvoyState';
import {colors} from '../theme/colors';

function roleLabel(role: number): string {
  switch (role) {
    case BushMeshConvoyRole.Lead:
      return 'Lead';
    case BushMeshConvoyRole.Member:
      return 'Member';
    case BushMeshConvoyRole.Tail:
      return 'Tail';
    case BushMeshConvoyRole.Recovery:
      return 'Recovery';
    case BushMeshConvoyRole.Support:
      return 'Support';
    default:
      return `Role ${role}`;
  }
}

function healthLabel(health: string): string {
  switch (health) {
    case 'active':
      return 'Active';
    case 'stale':
      return 'Stale';
    case 'lost':
      return 'Lost';
    default:
      return health;
  }
}

function nodeLabel(nodeId: number): string {
  return nodeId.toString(16).padStart(8, '0').toUpperCase();
}

function heartbeatLabel(milliseconds: number): string {
  return milliseconds < 60_000
    ? `${Math.round(milliseconds / 1000)}s`
    : `${Math.round(milliseconds / 60_000)}m`;
}

export function ConvoyScreen(): React.JSX.Element {
  const {
    connectionStatus,
    activeChannelIndex,
    localBushMeshNodeId,
    bushMeshNetworkStatus,
  } = useBushMesh();
  const convoy = useBushMeshConvoyState();
  const [convoyIdText, setConvoyIdText] = useState(String(convoy.config.convoyId));
  const [orderText, setOrderText] = useState(String(convoy.config.orderIndex));
  const [status, setStatus] = useState('Convoy mode is idle.');
  const [sending, setSending] = useState(false);

  const channelIndex =
    activeChannelIndex === null ? null : Number(activeChannelIndex);
  const channelReady =
    Number.isInteger(channelIndex) &&
    channelIndex !== null &&
    channelIndex >= 0 &&
    channelIndex <= 255;
  const canTransmit =
    convoy.config.enabled &&
    connectionStatus === 'Connected' &&
    bushMeshNetworkStatus.active &&
    localBushMeshNodeId !== null &&
    channelReady;

  const roleOptions = useMemo(
    () => [
      BushMeshConvoyRole.Lead,
      BushMeshConvoyRole.Member,
      BushMeshConvoyRole.Tail,
      BushMeshConvoyRole.Recovery,
      BushMeshConvoyRole.Support,
    ],
    [],
  );
  const heartbeatOptions = useMemo(() => [5000, 10_000, 20_000, 30_000, 60_000], []);

  const commitNumbers = () => {
    const convoyId = Number(convoyIdText);
    const orderIndex = Number(orderText);

    if (!Number.isInteger(convoyId) || convoyId < 0 || convoyId > 0xffffffff) {
      setStatus('Convoy ID must be a whole number from 0 to 4,294,967,295.');
      return false;
    }
    if (!Number.isInteger(orderIndex) || orderIndex < 0 || orderIndex > 65535) {
      setStatus('Vehicle position must be a whole number from 0 to 65,535.');
      return false;
    }

    configureBushMeshConvoy({convoyId, orderIndex});
    return true;
  };

  const refreshPosition = async () => {
    if (!isBushMeshNativeLocationAvailable()) {
      return false;
    }

    try {
      const position = await getBushMeshNativePosition({
        maxAgeMs: 15_000,
        timeoutMs: 5000,
      });
      updateBushMeshConvoyTelemetry({
        location: position.location,
        speedKph: position.speedKph,
        headingDegrees: position.headingDegrees,
      });
      return true;
    } catch {
      return false;
    }
  };

  const sendHeartbeat = async () => {
    if (!commitNumbers()) {
      return;
    }
    if (!canTransmit || channelIndex === null || localBushMeshNodeId === null) {
      setStatus('Connect a node, select a channel and enable convoy mode first.');
      return;
    }

    try {
      setSending(true);
      setStatus('Refreshing local position and sending convoy heartbeat...');
      await refreshPosition();
      const next = nextBushMeshConvoyStatus(localBushMeshNodeId);
      await sendActiveBushMeshConvoyStatus(channelIndex, next);
      setStatus('Convoy heartbeat sent.');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Convoy heartbeat failed.',
      );
    } finally {
      setSending(false);
    }
  };

  const snapshot = convoy.snapshot;
  const localLocation = convoy.telemetry.location;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Convoy</Text>
        <Text style={styles.title}>Convoy Mesh</Text>
        <Text style={styles.body}>
          Compact vehicle heartbeats track convoy order, stale/lost members,
          hazards and large gaps without flooding the channel with verbose GPS
          messages.
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.sectionTitle}>Convoy mode</Text>
            <Text style={styles.sectionBody}>
              Sends a small status heartbeat on the active MeshCore channel.
              While enabled, BushMesh may request a fresh phone location before
              a heartbeat so convoy gap detection has useful coordinates.
            </Text>
          </View>
          <Switch
            value={convoy.config.enabled}
            onValueChange={enabled => {
              configureBushMeshConvoy({enabled});
              setStatus(
                enabled
                  ? 'Convoy heartbeat mode enabled.'
                  : 'Convoy heartbeat mode disabled.',
              );
            }}
          />
        </View>

        <Text style={styles.fieldLabel}>Convoy ID</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={convoyIdText}
          onChangeText={setConvoyIdText}
          onEndEditing={commitNumbers}
          placeholder="1"
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.fieldLabel}>Vehicle position</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={orderText}
          onChangeText={setOrderText}
          onEndEditing={commitNumbers}
          placeholder="0"
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.fieldLabel}>Role</Text>
        <View style={styles.roleGrid}>
          {roleOptions.map(role => {
            const selected = convoy.config.role === role;
            return (
              <TouchableOpacity
                key={role}
                style={[styles.roleButton, selected && styles.roleButtonActive]}
                onPress={() => configureBushMeshConvoy({role})}>
                <Text style={[styles.roleText, selected && styles.roleTextActive]}>
                  {roleLabel(role)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>Heartbeat interval</Text>
        <View style={styles.roleGrid}>
          {heartbeatOptions.map(interval => {
            const selected = convoy.config.heartbeatIntervalMs === interval;
            return (
              <TouchableOpacity
                key={interval}
                style={[styles.roleButton, selected && styles.roleButtonActive]}
                onPress={() =>
                  configureBushMeshConvoy({heartbeatIntervalMs: interval})
                }>
                <Text style={[styles.roleText, selected && styles.roleTextActive]}>
                  {heartbeatLabel(interval)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.helpText}>
          Hazard mode automatically speeds updates up to about 3 seconds.
          Stopped vehicles back off to at least 20 seconds to conserve airtime.
        </Text>

        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[
              styles.flagButton,
              convoy.telemetry.stopped && styles.flagButtonWarning,
            ]}
            onPress={() =>
              updateBushMeshConvoyTelemetry({stopped: !convoy.telemetry.stopped})
            }>
            <Text style={styles.flagText}>
              {convoy.telemetry.stopped ? 'Stopped ✓' : 'Mark stopped'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.flagButton,
              convoy.telemetry.hazard && styles.flagButtonDanger,
            ]}
            onPress={() =>
              updateBushMeshConvoyTelemetry({hazard: !convoy.telemetry.hazard})
            }>
            <Text style={styles.flagText}>
              {convoy.telemetry.hazard ? 'Hazard ✓' : 'Raise hazard'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.locationCard}>
          <View style={styles.rowBetween}>
            <View style={styles.flexOne}>
              <Text style={styles.fieldLabelNoMargin}>Local phone position</Text>
              <Text style={styles.locationText}>
                {localLocation
                  ? `${localLocation.latitude.toFixed(5)}, ${localLocation.longitude.toFixed(5)}`
                  : isBushMeshNativeLocationAvailable()
                    ? 'No location captured yet.'
                    : 'Native location service unavailable.'}
              </Text>
              {convoy.telemetry.speedKph !== undefined ? (
                <Text style={styles.metaText}>
                  Speed {convoy.telemetry.speedKph.toFixed(1)} km/h
                  {convoy.telemetry.headingDegrees === undefined
                    ? ''
                    : ` • Heading ${Math.round(convoy.telemetry.headingDegrees)}°`}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={styles.locationButton}
              onPress={() => {
                setStatus('Refreshing phone position...');
                void refreshPosition().then(updated =>
                  setStatus(
                    updated
                      ? 'Phone position refreshed.'
                      : 'Unable to get a current phone position.',
                  ),
                );
              }}>
              <Text style={styles.locationButtonText}>Refresh GPS</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, (!canTransmit || sending) && styles.disabled]}
          disabled={!canTransmit || sending}
          onPress={sendHeartbeat}>
          <Text style={styles.primaryButtonText}>
            {sending ? 'Sending...' : 'Send Heartbeat Now'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.statusText}>{status}</Text>
        <Text style={styles.metaText}>
          Active channel: {channelReady ? `#${channelIndex}` : 'None'} • Local node:{' '}
          {localBushMeshNodeId === null ? 'Unknown' : nodeLabel(localBushMeshNodeId)}
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Convoy health</Text>
        <View style={styles.metricGrid}>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Members</Text>
            <Text style={styles.metricValue}>{snapshot?.members.length ?? 0}</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Issues</Text>
            <Text style={styles.metricValue}>{snapshot?.issues.length ?? 0}</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Largest gap</Text>
            <Text style={styles.metricValue}>
              {snapshot?.largestGapMetres === null || snapshot?.largestGapMetres === undefined
                ? '—'
                : `${snapshot.largestGapMetres} m`}
            </Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>State</Text>
            <Text style={styles.metricValue}>
              {snapshot?.healthy === false ? 'Attention' : 'Good'}
            </Text>
          </View>
        </View>

        {snapshot?.issues.length ? (
          snapshot.issues.map((issue, index) => (
            <View key={`${issue.nodeId}-${issue.type}-${index}`} style={styles.issueCard}>
              <Text style={styles.issueTitle}>
                {issue.type.replace(/-/g, ' ')} • {nodeLabel(issue.nodeId)}
              </Text>
              <Text style={styles.issueText}>{issue.detail}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>No convoy issues detected.</Text>
        )}
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Members</Text>
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => {
              clearBushMeshConvoyRemoteState();
              setStatus('Remote convoy state cleared.');
            }}>
            <Text style={styles.clearButtonText}>Clear remote</Text>
          </TouchableOpacity>
        </View>

        {snapshot?.members.length ? (
          snapshot.members.map(member => (
            <View key={member.status.nodeId} style={styles.memberCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.memberName}>{nodeLabel(member.status.nodeId)}</Text>
                <Text style={styles.memberHealth}>{healthLabel(member.health)}</Text>
              </View>
              <Text style={styles.memberMeta}>
                Position {member.status.orderIndex} • {roleLabel(member.status.role)}
                {member.status.speedKph === undefined
                  ? ''
                  : ` • ${member.status.speedKph.toFixed(1)} km/h`}
                {member.status.batteryPercent === undefined
                  ? ''
                  : ` • ${member.status.batteryPercent}%`}
              </Text>
              {member.status.location ? (
                <Text style={styles.memberMeta}>
                  {member.status.location.latitude.toFixed(5)}, {' '}
                  {member.status.location.longitude.toFixed(5)}
                </Text>
              ) : null}
              {member.gapFromPreviousMetres !== null ? (
                <Text style={styles.memberMeta}>
                  Gap from previous located vehicle: {member.gapFromPreviousMetres} m
                </Text>
              ) : null}
              {member.status.hazard ? (
                <Text style={styles.dangerText}>Hazard flag active</Text>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>
            No convoy members heard yet. Enable convoy mode on multiple BushMesh
            devices using the same convoy ID.
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 20, paddingBottom: 40},
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eyebrow: {color: colors.accent, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', marginBottom: 8},
  title: {color: colors.textPrimary, fontSize: 24, fontWeight: '900', marginBottom: 10},
  body: {color: colors.textSecondary, fontSize: 14, lineHeight: 21},
  sectionCard: {
    marginTop: 16,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {color: colors.textPrimary, fontSize: 18, fontWeight: '900'},
  sectionBody: {color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 5},
  rowBetween: {flexDirection: 'row', alignItems: 'center', gap: 10},
  flexOne: {flex: 1},
  fieldLabel: {color: colors.textMuted, fontSize: 12, fontWeight: '800', marginTop: 14, marginBottom: 6},
  fieldLabelNoMargin: {color: colors.textMuted, fontSize: 12, fontWeight: '800'},
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 15,
  },
  helpText: {color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 8},
  roleGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  roleButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.background,
  },
  roleButtonActive: {backgroundColor: colors.accent, borderColor: colors.accent},
  roleText: {color: colors.textSecondary, fontSize: 12, fontWeight: '800'},
  roleTextActive: {color: colors.background},
  toggleRow: {flexDirection: 'row', gap: 10, marginTop: 14},
  flagButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  flagButtonWarning: {borderColor: colors.warning},
  flagButtonDanger: {borderColor: colors.danger},
  flagText: {color: colors.textPrimary, fontSize: 12, fontWeight: '900'},
  locationCard: {
    marginTop: 14,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationText: {color: colors.textPrimary, fontSize: 13, fontWeight: '800', marginTop: 5},
  locationButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  locationButtonText: {color: colors.accent, fontSize: 10, fontWeight: '900'},
  primaryButton: {
    marginTop: 14,
    backgroundColor: colors.accent,
    borderRadius: 13,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryButtonText: {color: colors.background, fontSize: 13, fontWeight: '900'},
  disabled: {opacity: 0.4},
  statusText: {color: colors.accent, fontSize: 12, lineHeight: 18, marginTop: 10},
  metaText: {color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 6},
  metricGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12},
  metricBox: {
    minWidth: '45%',
    flexGrow: 1,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricLabel: {color: colors.textMuted, fontSize: 11, fontWeight: '800'},
  metricValue: {color: colors.textPrimary, fontSize: 16, fontWeight: '900', marginTop: 4},
  issueCard: {
    marginTop: 10,
    borderRadius: 12,
    padding: 11,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  issueTitle: {color: colors.warning, fontSize: 12, fontWeight: '900', textTransform: 'capitalize'},
  issueText: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4},
  memberCard: {
    marginTop: 10,
    borderRadius: 12,
    padding: 11,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  memberName: {flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  memberHealth: {color: colors.accent, fontSize: 11, fontWeight: '900'},
  memberMeta: {color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 5},
  dangerText: {color: colors.danger, fontSize: 11, fontWeight: '900', marginTop: 5},
  emptyText: {color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 12},
  clearButton: {borderRadius: 10, borderWidth: 1, borderColor: colors.warning, paddingHorizontal: 9, paddingVertical: 6},
  clearButtonText: {color: colors.warning, fontSize: 10, fontWeight: '900'},
});
