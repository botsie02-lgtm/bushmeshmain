import React, {useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {BushMeshNodeRole} from '../bushmesh/protocol';
import {
  requestBushMeshPeerLocation,
  requestBushMeshPeerNodeInfo,
} from '../bushmesh/runtime';
import {useBushMesh} from '../state/BushMeshContext';
import {colors} from '../theme/colors';

function nodeIdLabel(nodeId: number): string {
  return nodeId.toString(16).padStart(8, '0').toUpperCase();
}

function roleLabel(role: number): string {
  switch (role) {
    case BushMeshNodeRole.Handheld:
      return 'Handheld';
    case BushMeshNodeRole.Router:
      return 'Router';
    case BushMeshNodeRole.Vehicle:
      return 'Vehicle';
    case BushMeshNodeRole.BaseStation:
      return 'Base station';
    case BushMeshNodeRole.Sensor:
      return 'Sensor';
    default:
      return `Role ${role}`;
  }
}

function formatLastSeen(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  const ageMs = Math.max(0, Date.now() - timestamp);
  if (ageMs < 60_000) {
    return 'just now';
  }
  if (ageMs < 60 * 60_000) {
    return `${Math.floor(ageMs / 60_000)} min ago`;
  }
  if (ageMs < 24 * 60 * 60_000) {
    return `${Math.floor(ageMs / (60 * 60_000))} hr ago`;
  }

  return new Date(timestamp).toLocaleDateString();
}

export function ContactsScreen(): React.JSX.Element {
  const {
    connectionStatus,
    contacts,
    knownBushMeshPeers,
    localBushMeshNodeId,
    activeChannel,
    canSendBushMeshRoutedMessage,
    sendBushMeshRoutedMessage,
    refreshBushMeshDiscovery,
    addLocalChannelMessage,
  } = useBushMesh();

  const [selectedPeerId, setSelectedPeerId] = useState<number | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sendStatus, setSendStatus] = useState(
    'Select a BushMesh peer to send a routed direct message.',
  );
  const [isSending, setIsSending] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [peerAction, setPeerAction] = useState<'info' | 'location' | null>(null);

  const sortedPeers = useMemo(
    () =>
      [...knownBushMeshPeers].sort((a, b) =>
        b.lastSeenAt.localeCompare(a.lastSeenAt),
      ),
    [knownBushMeshPeers],
  );

  const selectedPeer =
    sortedPeers.find(peer => peer.nodeId === selectedPeerId) ?? null;
  const cleanMessage = messageText.trim();
  const channelIndex = activeChannel ? Number(activeChannel.channelIndex) : NaN;
  const canUsePeerActions =
    selectedPeer !== null &&
    localBushMeshNodeId !== null &&
    Number.isInteger(channelIndex) &&
    canSendBushMeshRoutedMessage &&
    peerAction === null;
  const canSendDirect =
    canUsePeerActions && cleanMessage.length > 0 && !isSending;
  const canRefreshDiscovery =
    connectionStatus === 'Connected' &&
    Number.isInteger(channelIndex) &&
    !isDiscovering;

  const runDiscoveryRefresh = async () => {
    try {
      setIsDiscovering(true);
      setSendStatus('Broadcasting BushMesh HELLO on the active channel...');
      await refreshBushMeshDiscovery();
      setSendStatus(
        `BushMesh HELLO broadcast on ${activeChannel?.channelName ?? `channel ${channelIndex}`}. Nearby BushMesh nodes should answer with their own periodic HELLO traffic.`,
      );
    } catch (error) {
      setSendStatus(
        error instanceof Error ? error.message : 'BushMesh discovery refresh failed.',
      );
    } finally {
      setIsDiscovering(false);
    }
  };

  const sendPeerInfoRequest = async () => {
    if (
      !selectedPeer ||
      localBushMeshNodeId === null ||
      !Number.isInteger(channelIndex)
    ) {
      setSendStatus('Select a peer and active BushMesh channel first.');
      return;
    }

    try {
      setPeerAction('info');
      setSendStatus(`Requesting node info from ${nodeIdLabel(selectedPeer.nodeId)}...`);
      const result = await requestBushMeshPeerNodeInfo(
        channelIndex,
        localBushMeshNodeId,
        selectedPeer.nodeId,
      );
      setSendStatus(
        `Node-info request ${result.routedMessageId} sent to ${nodeIdLabel(selectedPeer.nodeId)}. The peer should answer with its current HELLO data.`,
      );
    } catch (error) {
      setSendStatus(
        error instanceof Error ? error.message : 'Failed to request peer node info.',
      );
    } finally {
      setPeerAction(null);
    }
  };

  const sendPeerLocationRequest = async () => {
    if (
      !selectedPeer ||
      localBushMeshNodeId === null ||
      !Number.isInteger(channelIndex)
    ) {
      setSendStatus('Select a peer and active BushMesh channel first.');
      return;
    }

    try {
      setPeerAction('location');
      setSendStatus(`Requesting location from ${nodeIdLabel(selectedPeer.nodeId)}...`);
      const result = await requestBushMeshPeerLocation(
        channelIndex,
        localBushMeshNodeId,
        selectedPeer.nodeId,
        {maxAgeSeconds: 300},
      );
      setSendStatus(
        `Location request ${result.routedMessageId} sent to ${nodeIdLabel(selectedPeer.nodeId)}. A peer with a recent location fix will return a compact location packet.`,
      );
    } catch (error) {
      setSendStatus(
        error instanceof Error ? error.message : 'Failed to request peer location.',
      );
    } finally {
      setPeerAction(null);
    }
  };

  const sendDirectMessage = async () => {
    if (!selectedPeer) {
      setSendStatus('Select a BushMesh peer first.');
      return;
    }

    if (!activeChannel || !Number.isInteger(channelIndex)) {
      setSendStatus('Select a valid active channel in the Channels tab first.');
      return;
    }

    try {
      setIsSending(true);
      setSendStatus(`Routing message to ${nodeIdLabel(selectedPeer.nodeId)}...`);

      const result = await sendBushMeshRoutedMessage(
        channelIndex,
        cleanMessage,
        selectedPeer.nodeId,
      );

      addLocalChannelMessage({
        channelIndex: activeChannel.channelIndex,
        channelName: activeChannel.channelName,
        text: cleanMessage,
        direction: 'sent',
        status: 'sent',
        protocol: 'bushmesh-routed',
      });

      setSendStatus(
        `Message ${result.messageId} sent to ${nodeIdLabel(selectedPeer.nodeId)} in ${result.frameCount} frame(s).`,
      );
      setMessageText('');
    } catch (error) {
      setSendStatus(
        error instanceof Error ? error.message : 'Failed to send routed message.',
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Contacts</Text>
        <Text style={styles.title}>Nodes & Direct Messages</Text>
        <Text style={styles.body}>
          MeshCore contacts are synced from the companion node. BushMesh peers are
          discovered over the selected channel and can receive routed direct
          messages and control requests by node ID.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Connection</Text>
          <Text
            style={[
              styles.summaryValue,
              connectionStatus === 'Connected' && styles.summaryValueOnline,
            ]}>
            {connectionStatus}
          </Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Local node</Text>
          <Text style={styles.summaryValue}>
            {localBushMeshNodeId === null
              ? 'Waiting for identity'
              : nodeIdLabel(localBushMeshNodeId)}
          </Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>BushMesh peers</Text>
          <Text style={styles.summaryValue}>{sortedPeers.length}</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>MeshCore contacts</Text>
          <Text style={styles.summaryValue}>{contacts.length}</Text>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.sectionTitle}>BushMesh Peers</Text>
            <Text style={styles.sectionBody}>
              Tap a peer to make it the destination for routed operations.
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.refreshButton,
              !canRefreshDiscovery && styles.refreshButtonDisabled,
            ]}
            disabled={!canRefreshDiscovery}
            onPress={runDiscoveryRefresh}>
            <Text style={styles.refreshButtonText}>
              {isDiscovering ? 'Sending...' : 'Refresh'}
            </Text>
          </TouchableOpacity>
        </View>

        {sortedPeers.length === 0 ? (
          <Text style={styles.emptyText}>
            No BushMesh peers discovered yet. Keep two BushMesh devices on the
            same MeshCore channel so their HELLO packets can be exchanged.
          </Text>
        ) : (
          sortedPeers.map(peer => {
            const selected = peer.nodeId === selectedPeerId;
            return (
              <TouchableOpacity
                key={peer.nodeId}
                style={[styles.peerCard, selected && styles.peerCardSelected]}
                onPress={() => setSelectedPeerId(peer.nodeId)}>
                <View style={styles.rowBetween}>
                  <View style={styles.flexOne}>
                    <Text style={styles.peerId}>{nodeIdLabel(peer.nodeId)}</Text>
                    <Text style={styles.peerRole}>{roleLabel(peer.role)}</Text>
                  </View>
                  <View style={styles.peerMetaRight}>
                    <Text style={styles.peerSeen}>{formatLastSeen(peer.lastSeenAt)}</Text>
                    <Text style={styles.peerBattery}>
                      {peer.batteryPercent === undefined
                        ? 'Battery --'
                        : `Battery ${peer.batteryPercent}%`}
                    </Text>
                  </View>
                </View>
                <Text style={styles.capabilityText}>
                  Capability mask 0x{peer.capabilities.toString(16).toUpperCase()}
                </Text>
                {selected ? <Text style={styles.selectedText}>Selected destination</Text> : null}
              </TouchableOpacity>
            );
          })
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Peer Actions</Text>
        <Text style={styles.sectionBody}>
          {selectedPeer
            ? `Send compact control requests to ${nodeIdLabel(selectedPeer.nodeId)}.`
            : 'Select a BushMesh peer above.'}
        </Text>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, !canUsePeerActions && styles.actionButtonDisabled]}
            disabled={!canUsePeerActions}
            onPress={sendPeerInfoRequest}>
            <Text style={styles.actionButtonText}>
              {peerAction === 'info' ? 'Requesting...' : 'Request node info'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, !canUsePeerActions && styles.actionButtonDisabled]}
            disabled={!canUsePeerActions}
            onPress={sendPeerLocationRequest}>
            <Text style={styles.actionButtonText}>
              {peerAction === 'location' ? 'Requesting...' : 'Request location'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Direct Routed Message</Text>
        <Text style={styles.sectionBody}>
          {selectedPeer
            ? `Destination ${nodeIdLabel(selectedPeer.nodeId)} via ${activeChannel?.channelName ?? 'no active channel'}.`
            : 'Select a BushMesh peer above.'}
        </Text>

        <TextInput
          style={styles.input}
          value={messageText}
          onChangeText={setMessageText}
          placeholder="Message a BushMesh peer"
          placeholderTextColor={colors.textMuted}
          multiline
        />

        <TouchableOpacity
          style={[styles.sendButton, !canSendDirect && styles.sendButtonDisabled]}
          disabled={!canSendDirect}
          onPress={sendDirectMessage}>
          <Text style={styles.sendButtonText}>
            {isSending ? 'Sending...' : 'Send Routed Direct Message'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.sendStatus}>{sendStatus}</Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>MeshCore Contacts</Text>
        <Text style={styles.sectionBody}>
          These are the contacts currently synced from the connected companion.
        </Text>

        {contacts.length === 0 ? (
          <Text style={styles.emptyText}>
            No MeshCore contacts loaded yet. Use the Device tab to sync contacts.
          </Text>
        ) : (
          contacts.map(contact => (
            <View key={contact.publicKey} style={styles.contactCard}>
              <View style={styles.rowBetween}>
                <View style={styles.flexOne}>
                  <Text style={styles.contactName}>{contact.name || 'Unnamed contact'}</Text>
                  <Text style={styles.contactKey}>{contact.publicKeyPrefix}</Text>
                </View>
                <Text style={styles.contactType}>Type {contact.type}</Text>
              </View>
              <Text style={styles.contactDetail}>
                Path {contact.outPathLength} • Flags 0x{contact.flags.toString(16).toUpperCase()}
              </Text>
              {contact.latitude !== null && contact.longitude !== null ? (
                <Text style={styles.contactDetail}>
                  {contact.latitude.toFixed(5)}, {contact.longitude.toFixed(5)}
                </Text>
              ) : (
                <Text style={styles.contactDetail}>No location advertised</Text>
              )}
            </View>
          ))
        )}
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
    fontSize: 15,
    lineHeight: 22,
  },
  summaryCard: {
    marginTop: 16,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryItem: {
    minWidth: '45%',
    flexGrow: 1,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
  },
  summaryValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  summaryValueOnline: {
    color: colors.success,
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
    marginBottom: 12,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 10,
  },
  refreshButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  refreshButtonDisabled: {
    opacity: 0.4,
  },
  refreshButtonText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: '900',
  },
  peerCard: {
    backgroundColor: colors.background,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 13,
    marginTop: 10,
  },
  peerCardSelected: {
    borderColor: colors.accent,
    borderWidth: 2,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  flexOne: {
    flex: 1,
  },
  peerId: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  peerRole: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
  peerMetaRight: {
    alignItems: 'flex-end',
  },
  peerSeen: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  peerBattery: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  capabilityText: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 9,
  },
  selectedText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: 11,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  actionButtonText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
  },
  input: {
    minHeight: 90,
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    color: colors.textPrimary,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  sendButton: {
    marginTop: 12,
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '900',
  },
  sendStatus: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  contactCard: {
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginTop: 10,
  },
  contactName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  contactKey: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
  contactType: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
  },
  contactDetail: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 7,
  },
});
