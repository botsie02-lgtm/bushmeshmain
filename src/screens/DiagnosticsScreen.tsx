import React, {useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {BushMeshFileContentType} from '../bushmesh/protocol';
import {
  bushMeshInboxFilePreview,
  clearBushMeshFileInbox,
  removeBushMeshInboxFile,
} from '../bushmesh/runtime/BushMeshFileInboxHub';
import {clearBushMeshLiveState} from '../bushmesh/runtime/BushMeshLiveStateHub';
import {useBushMesh} from '../state/BushMeshContext';
import {useBushMeshFileInbox} from '../state/useBushMeshFileInbox';
import {useBushMeshLiveState} from '../state/useBushMeshLiveState';
import {colors} from '../theme/colors';

function nodeIdLabel(nodeId: number | null): string {
  return nodeId === null
    ? 'Unknown'
    : nodeId.toString(16).padStart(8, '0').toUpperCase();
}

function formatAge(iso: string): string {
  const timestamp = Date.parse(iso);
  return formatTimestampAge(timestamp);
}

function formatTimestampAge(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return 'unknown';
  }

  const ageMs = Math.max(0, Date.now() - timestamp);
  if (ageMs < 60_000) {
    return 'now';
  }
  if (ageMs < 60 * 60_000) {
    return `${Math.floor(ageMs / 60_000)}m`;
  }
  if (ageMs < 24 * 60 * 60_000) {
    return `${Math.floor(ageMs / (60 * 60_000))}h`;
  }
  return `${Math.floor(ageMs / (24 * 60 * 60_000))}d`;
}

function contentTypeLabel(contentType: number): string {
  switch (contentType) {
    case BushMeshFileContentType.Text:
      return 'Text';
    case BushMeshFileContentType.Json:
      return 'JSON';
    case BushMeshFileContentType.Image:
      return 'Image';
    case BushMeshFileContentType.GpsRoute:
      return 'GPS route';
    case BushMeshFileContentType.Configuration:
      return 'Configuration';
    case BushMeshFileContentType.ContactCard:
      return 'Contact card';
    case BushMeshFileContentType.FirmwareMetadata:
      return 'Firmware metadata';
    case BushMeshFileContentType.Binary:
      return 'Binary';
    default:
      return `Type ${contentType}`;
  }
}

function Metric({label, value}: {label: string; value: string | number}) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export function DiagnosticsScreen(): React.JSX.Element {
  const {
    connectionStatus,
    connectedDeviceName,
    meshCorePublicKey,
    localBushMeshNodeId,
    knownBushMeshPeers,
    bushMeshRuntimeStats,
    bushMeshNetworkStatus,
    bushMeshDeliveryStatus,
    activeChannel,
    refreshBushMeshDiscovery,
    flushBushMeshQueuedMessages,
  } = useBushMesh();
  const liveState = useBushMeshLiveState();
  const fileInbox = useBushMeshFileInbox();
  const [actionStatus, setActionStatus] = useState(
    'Diagnostics are read-only unless you use one of the maintenance actions below.',
  );
  const [busy, setBusy] = useState(false);

  const publicKeyShort = useMemo(() => {
    if (!meshCorePublicKey) {
      return 'Unknown';
    }
    return meshCorePublicKey.length > 24
      ? `${meshCorePublicKey.slice(0, 12)}…${meshCorePublicKey.slice(-12)}`
      : meshCorePublicKey;
  }, [meshCorePublicKey]);

  const runAction = async (label: string, action: () => Promise<void>) => {
    try {
      setBusy(true);
      setActionStatus(`${label}...`);
      await action();
      setActionStatus(`${label} complete.`);
    } catch (error) {
      setActionStatus(
        error instanceof Error ? error.message : `${label} failed.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const clearLiveHistory = () => {
    clearBushMeshLiveState();
    setActionStatus('Live peer-position and received-SOS history cleared.');
  };

  const clearFileInbox = () => {
    clearBushMeshFileInbox();
    setActionStatus('Persistent BushMesh received-file inbox cleared.');
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Diagnostics</Text>
        <Text style={styles.title}>BushMesh Runtime</Text>
        <Text style={styles.body}>
          Field-facing visibility into the application protocol, persistence,
          delivery and peer-discovery layers. This does not change radio settings.
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Identity & Transport</Text>
        <View style={styles.metricGrid}>
          <Metric label="Connection" value={connectionStatus} />
          <Metric label="Runtime" value={bushMeshNetworkStatus.active ? 'Active' : 'Inactive'} />
          <Metric label="Local node" value={nodeIdLabel(localBushMeshNodeId)} />
          <Metric label="Peers" value={knownBushMeshPeers.length} />
        </View>
        <Text style={styles.detailText}>
          Device: {connectedDeviceName ?? 'None'}
        </Text>
        <Text style={styles.detailText}>Public key: {publicKeyShort}</Text>
        <Text style={styles.detailText}>
          Active channel: {activeChannel
            ? `${activeChannel.channelName} #${activeChannel.channelIndex}`
            : 'None'}
        </Text>
        <Text style={styles.statusText}>{bushMeshNetworkStatus.detail}</Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Packet Counters</Text>
        <View style={styles.metricGrid}>
          <Metric label="Messages sent" value={bushMeshRuntimeStats.sentMessages} />
          <Metric label="Frames sent" value={bushMeshRuntimeStats.sentFrames} />
          <Metric label="Frames received" value={bushMeshRuntimeStats.receivedFrames} />
          <Metric label="Messages received" value={bushMeshRuntimeStats.receivedMessages} />
          <Metric label="ACK sent" value={bushMeshRuntimeStats.ackFramesSent} />
          <Metric label="ACK received" value={bushMeshRuntimeStats.ackFramesReceived} />
          <Metric label="Retransmits" value={bushMeshRuntimeStats.retransmittedFrames} />
          <Metric label="Decode errors" value={bushMeshRuntimeStats.decodeErrors} />
          <Metric label="Ignored frames" value={bushMeshRuntimeStats.ignoredFrames} />
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Persistent Delivery</Text>
        <View style={styles.metricGrid}>
          <Metric
            label="Storage"
            value={bushMeshDeliveryStatus.persistentStorageAvailable ? 'Durable' : 'Memory'}
          />
          <Metric label="Queued" value={bushMeshDeliveryStatus.queuedMessages} />
        </View>
        <Text style={styles.detailText}>
          Backend: {bushMeshDeliveryStatus.storageLabel}
        </Text>
        <Text style={styles.statusText}>{bushMeshDeliveryStatus.detail}</Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Live Network State</Text>
        <View style={styles.metricGrid}>
          <Metric label="Peer positions" value={liveState.peerLocations.length} />
          <Metric label="SOS history" value={liveState.distressAlerts.length} />
          <Metric label="Unseen SOS" value={liveState.unacknowledgedDistressCount} />
          <Metric label="State revision" value={liveState.revision} />
          <Metric label="Storage loaded" value={liveState.hydrated ? 'Yes' : 'Loading'} />
        </View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.sectionTitle}>Received File Inbox</Text>
            <Text style={styles.sectionBody}>
              Small completed transfers are retained locally. The inbox is
              intentionally bounded to protect phone storage from oversized LoRa
              transfers.
            </Text>
          </View>
          <Text style={styles.fileCountText}>{fileInbox.files.length}</Text>
        </View>

        <View style={styles.metricGrid}>
          <Metric label="Stored bytes" value={fileInbox.totalBytes} />
          <Metric label="Inbox loaded" value={fileInbox.hydrated ? 'Yes' : 'Loading'} />
        </View>

        {fileInbox.files.length === 0 ? (
          <Text style={styles.emptyText}>No completed BushMesh files are stored.</Text>
        ) : (
          <>
            {fileInbox.files.map(file => {
              const preview = bushMeshInboxFilePreview(file, 400);
              return (
                <View key={file.id} style={styles.fileCard}>
                  <View style={styles.rowBetween}>
                    <View style={styles.flexOne}>
                      <Text style={styles.fileName}>
                        {file.fileName ?? `Transfer ${file.transferId}`}
                      </Text>
                      <Text style={styles.fileMeta}>
                        {contentTypeLabel(file.contentType)} • {file.data.length} bytes • Channel #{file.channelIndex} • {formatTimestampAge(file.receivedAt)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.removeFileButton}
                      onPress={() => {
                        removeBushMeshInboxFile(file.id);
                        setActionStatus(`Removed ${file.fileName ?? `transfer ${file.transferId}`} from the local inbox.`);
                      }}>
                      <Text style={styles.removeFileButtonText}>Delete</Text>
                    </TouchableOpacity>
                  </View>

                  {preview ? (
                    <Text style={styles.filePreview} selectable>
                      {preview}
                    </Text>
                  ) : (
                    <Text style={styles.fileBinaryNote}>
                      Binary payload retained; preview is disabled for this content type.
                    </Text>
                  )}
                </View>
              );
            })}

            <TouchableOpacity style={styles.clearButton} onPress={clearFileInbox}>
              <Text style={styles.clearButtonText}>Clear Received File Inbox</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Known BushMesh Peers</Text>
        {knownBushMeshPeers.length === 0 ? (
          <Text style={styles.emptyText}>
            No BushMesh-capable peers discovered yet.
          </Text>
        ) : (
          knownBushMeshPeers.map(peer => (
            <View key={peer.nodeId} style={styles.peerCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.peerNode}>{nodeIdLabel(peer.nodeId)}</Text>
                <Text style={styles.peerAge}>{formatAge(peer.lastSeenAt)}</Text>
              </View>
              <Text style={styles.peerMeta}>
                Role {peer.role} • Capabilities 0x{peer.capabilities.toString(16).toUpperCase()}
                {peer.batteryPercent === undefined
                  ? ''
                  : ` • Battery ${peer.batteryPercent}%`}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Maintenance Actions</Text>
        <Text style={styles.sectionBody}>{actionStatus}</Text>

        <TouchableOpacity
          style={[styles.actionButton, busy && styles.buttonDisabled]}
          disabled={busy || !bushMeshNetworkStatus.active}
          onPress={() => runAction('Refreshing BushMesh discovery', refreshBushMeshDiscovery)}>
          <Text style={styles.actionButtonText}>Refresh Peer Discovery</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, busy && styles.buttonDisabled]}
          disabled={busy || !bushMeshNetworkStatus.active}
          onPress={() => runAction('Flushing persistent delivery queue', flushBushMeshQueuedMessages)}>
          <Text style={styles.actionButtonText}>Flush Delivery Queue</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.clearButton, busy && styles.buttonDisabled]}
          disabled={busy}
          onPress={clearLiveHistory}>
          <Text style={styles.clearButtonText}>Clear Live Position / SOS History</Text>
        </TouchableOpacity>
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
    fontSize: 14,
    lineHeight: 21,
  },
  sectionCard: {
    marginTop: 16,
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
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  metricBox: {
    minWidth: '45%',
    flexGrow: 1,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 4,
  },
  detailText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 9,
  },
  statusText: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  peerCard: {
    marginTop: 10,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  flexOne: {
    flex: 1,
  },
  peerNode: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  peerAge: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  peerMeta: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 5,
  },
  fileCountText: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: '900',
  },
  fileCard: {
    marginTop: 12,
    backgroundColor: colors.background,
    borderRadius: 13,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fileName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  fileMeta: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },
  filePreview: {
    color: colors.textSecondary,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 10,
    padding: 10,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 10,
  },
  fileBinaryNote: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
  },
  removeFileButton: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.warning,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  removeFileButtonText: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: '900',
  },
  actionButton: {
    marginTop: 12,
    borderRadius: 13,
    backgroundColor: colors.accent,
    paddingVertical: 13,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  actionButtonText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: '900',
  },
  clearButton: {
    marginTop: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.warning,
    paddingVertical: 13,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  clearButtonText: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: '900',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
});
