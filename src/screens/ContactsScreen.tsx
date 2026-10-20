import React, {useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {BushMeshNodeRole, BushMeshSyncNamespace} from '../bushmesh/protocol';
import {
  requestBushMeshPeerLocation,
  requestBushMeshPeerNodeInfo,
  requestBushMeshPeerSync,
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
  return `${Math.floor(ageMs / (24 * 60 * 60_000))} day(s) ago`;
}

export function ContactsScreen(): React.JSX.Element {
  const {
    connectionStatus,
    contacts,
    knownBushMeshPeers,
    localBushMeshNodeId,
    activeChannel,
    canSendBushMeshRoutedMessage,
    bushMeshDeliveryStatus,
    sendBushMeshRoutedMessage,
    refreshBushMeshDiscovery,
    flushBushMeshQueuedMessages,
    addLocalChannelMessage,
  } = useBushMesh();

  const [selectedPeerId, setSelectedPeerId] = useState<number | null>(null);
  const [messageText, setMessageText] = useState('');
  const [status, setStatus] = useState(
    'Select a BushMesh peer for direct messages or control requests.',
  );
  const [busy, setBusy] = useState<
    | 'message'
    | 'discovery'
    | 'info'
    | 'location'
    | 'syncMessages'
    | 'syncContacts'
    | 'flush'
    | null
  >(null);

  const peers = useMemo(
    () =>
      [...knownBushMeshPeers].sort((a, b) =>
        b.lastSeenAt.localeCompare(a.lastSeenAt),
      ),
    [knownBushMeshPeers],
  );
  const selectedPeer = peers.find(peer => peer.nodeId === selectedPeerId) ?? null;
  const channelIndex = activeChannel ? Number(activeChannel.channelIndex) : NaN;
  const validChannel = Number.isInteger(channelIndex);
  const actionsReady =
    selectedPeer !== null &&
    localBushMeshNodeId !== null &&
    validChannel &&
    canSendBushMeshRoutedMessage &&
    busy === null;
  const cleanMessage = messageText.trim();

  const refreshDiscovery = async () => {
    try {
      setBusy('discovery');
      setStatus('Broadcasting BushMesh HELLO...');
      await refreshBushMeshDiscovery();
      setStatus('BushMesh HELLO broadcast on the active channel.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Discovery failed.');
    } finally {
      setBusy(null);
    }
  };

  const requestInfo = async () => {
    if (!actionsReady || !selectedPeer || localBushMeshNodeId === null) {
      return;
    }

    try {
      setBusy('info');
      const result = await requestBushMeshPeerNodeInfo(
        channelIndex,
        localBushMeshNodeId,
        selectedPeer.nodeId,
      );
      setStatus(
        `Node-info request ${result.routedMessageId} sent to ${nodeIdLabel(selectedPeer.nodeId)}.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Node-info request failed.');
    } finally {
      setBusy(null);
    }
  };

  const requestLocation = async () => {
    if (!actionsReady || !selectedPeer || localBushMeshNodeId === null) {
      return;
    }

    try {
      setBusy('location');
      const result = await requestBushMeshPeerLocation(
        channelIndex,
        localBushMeshNodeId,
        selectedPeer.nodeId,
        {maxAgeSeconds: 300},
      );
      setStatus(
        `Location request ${result.routedMessageId} sent to ${nodeIdLabel(selectedPeer.nodeId)}.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Location request failed.');
    } finally {
      setBusy(null);
    }
  };

  const requestSync = async (
    namespace: BushMeshSyncNamespace,
    nextBusy: 'syncMessages' | 'syncContacts',
    label: string,
  ) => {
    if (!actionsReady || !selectedPeer || localBushMeshNodeId === null) {
      return;
    }

    try {
      setBusy(nextBusy);
      const result = await requestBushMeshPeerSync(
        channelIndex,
        localBushMeshNodeId,
        selectedPeer.nodeId,
        namespace,
      );
      setStatus(
        `${label} sync request ${result.routedMessageId} sent to ${nodeIdLabel(selectedPeer.nodeId)}. The peer will answer with its compact inventory summary.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : `${label} sync request failed.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const sendDirect = async () => {
    if (!actionsReady || !selectedPeer || !activeChannel || !cleanMessage) {
      return;
    }

    try {
      setBusy('message');
      setStatus(`Routing message to ${nodeIdLabel(selectedPeer.nodeId)}...`);
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
        status: result.state === 'sent' ? 'sent' : 'pending',
        protocol: 'bushmesh-routed',
      });

      if (result.state === 'queued') {
        setStatus(
          `Message ${result.messageId} saved for retry${result.queueId ? ` as ${result.queueId}` : ''}.`,
        );
      } else {
        setStatus(
          `Message ${result.messageId} sent to ${nodeIdLabel(selectedPeer.nodeId)} in ${result.frameCount ?? 0} frame(s).`,
        );
      }
      setMessageText('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Direct message failed.');
    } finally {
      setBusy(null);
    }
  };

  const flushQueue = async () => {
    try {
      setBusy('flush');
      await flushBushMeshQueuedMessages();
      setStatus('Requested immediate retry of queued BushMesh messages.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Queue retry failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Contacts</Text>
        <Text style={styles.title}>BushMesh Peers</Text>
        <Text style={styles.body}>
          Discover BushMesh nodes, send routed direct messages, request peer
          state, and exchange compact sync inventories.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <Summary label="Connection" value={connectionStatus} online={connectionStatus === 'Connected'} />
        <Summary
          label="Local node"
          value={localBushMeshNodeId === null ? 'Waiting' : nodeIdLabel(localBushMeshNodeId)}
        />
        <Summary label="Peers" value={String(peers.length)} />
        <Summary label="Queued" value={String(bushMeshDeliveryStatus.queuedMessages)} />
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.sectionTitle}>Discovery</Text>
            <Text style={styles.detail}>
              Active channel: {activeChannel ? `${activeChannel.channelName} #${activeChannel.channelIndex}` : 'none'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.smallButton, (!validChannel || busy !== null) && styles.disabled]}
            disabled={!validChannel || busy !== null}
            onPress={refreshDiscovery}>
            <Text style={styles.smallButtonText}>
              {busy === 'discovery' ? 'Sending...' : 'Refresh'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.statusText}>{status}</Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Discovered Peers</Text>
        {peers.length === 0 ? (
          <Text style={styles.emptyText}>
            No BushMesh HELLO packets received yet. Keep devices on the same
            MeshCore channel and use Refresh if needed.
          </Text>
        ) : (
          peers.map(peer => {
            const selected = peer.nodeId === selectedPeerId;
            return (
              <TouchableOpacity
                key={peer.nodeId}
                style={[styles.peerCard, selected && styles.selectedCard]}
                onPress={() => setSelectedPeerId(peer.nodeId)}>
                <View style={styles.rowBetween}>
                  <View style={styles.flexOne}>
                    <Text style={styles.peerId}>{nodeIdLabel(peer.nodeId)}</Text>
                    <Text style={styles.peerRole}>{roleLabel(peer.role)}</Text>
                  </View>
                  <View style={styles.rightText}>
                    <Text style={styles.detail}>{formatLastSeen(peer.lastSeenAt)}</Text>
                    <Text style={styles.detail}>
                      {peer.batteryPercent === undefined ? 'Battery --' : `Battery ${peer.batteryPercent}%`}
                    </Text>
                  </View>
                </View>
                <Text style={styles.capabilities}>
                  Capabilities 0x{peer.capabilities.toString(16).toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Peer Actions</Text>
        <Text style={styles.detail}>
          {selectedPeer
            ? `Selected ${nodeIdLabel(selectedPeer.nodeId)}`
            : 'Select a peer above.'}
        </Text>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, !actionsReady && styles.disabled]}
            disabled={!actionsReady}
            onPress={requestInfo}>
            <Text style={styles.actionText}>
              {busy === 'info' ? 'Requesting...' : 'Node info'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, !actionsReady && styles.disabled]}
            disabled={!actionsReady}
            onPress={requestLocation}>
            <Text style={styles.actionText}>
              {busy === 'location' ? 'Requesting...' : 'Location'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, !actionsReady && styles.disabled]}
            disabled={!actionsReady}
            onPress={() =>
              requestSync(
                BushMeshSyncNamespace.Messages,
                'syncMessages',
                'Message',
              )
            }>
            <Text style={styles.actionText}>
              {busy === 'syncMessages' ? 'Syncing...' : 'Message sync'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, !actionsReady && styles.disabled]}
            disabled={!actionsReady}
            onPress={() =>
              requestSync(
                BushMeshSyncNamespace.Contacts,
                'syncContacts',
                'Contact',
              )
            }>
            <Text style={styles.actionText}>
              {busy === 'syncContacts' ? 'Syncing...' : 'Contact sync'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Direct Message</Text>
        <TextInput
          style={styles.input}
          value={messageText}
          onChangeText={setMessageText}
          placeholder="Message the selected peer"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[
            styles.primaryButton,
            (!actionsReady || !cleanMessage) && styles.disabled,
          ]}
          disabled={!actionsReady || !cleanMessage}
          onPress={sendDirect}>
          <Text style={styles.primaryButtonText}>
            {busy === 'message' ? 'Sending...' : 'Send Routed Direct Message'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.sectionTitle}>Persistent Delivery</Text>
            <Text style={styles.detail}>{bushMeshDeliveryStatus.detail}</Text>
            <Text style={styles.storageText}>
              {bushMeshDeliveryStatus.storageLabel} • {bushMeshDeliveryStatus.queuedMessages} queued
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.smallButton,
              (bushMeshDeliveryStatus.queuedMessages === 0 || busy !== null) && styles.disabled,
            ]}
            disabled={bushMeshDeliveryStatus.queuedMessages === 0 || busy !== null}
            onPress={flushQueue}>
            <Text style={styles.smallButtonText}>
              {busy === 'flush' ? 'Retrying...' : 'Retry now'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>MeshCore Contacts</Text>
        {contacts.length === 0 ? (
          <Text style={styles.emptyText}>No MeshCore contacts are loaded.</Text>
        ) : (
          contacts.map(contact => (
            <View key={contact.publicKey} style={styles.contactCard}>
              <View style={styles.rowBetween}>
                <View style={styles.flexOne}>
                  <Text style={styles.contactName}>{contact.name || 'Unnamed contact'}</Text>
                  <Text style={styles.detail}>{contact.publicKeyPrefix}</Text>
                </View>
                <Text style={styles.contactType}>Type {contact.type}</Text>
              </View>
              <Text style={styles.detail}>
                Path {contact.outPathLength} • Flags 0x{contact.flags.toString(16).toUpperCase()}
              </Text>
              {contact.latitude !== null && contact.longitude !== null ? (
                <Text style={styles.detail}>
                  {contact.latitude.toFixed(5)}, {contact.longitude.toFixed(5)}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function Summary({
  label,
  value,
  online = false,
}: {
  label: string;
  value: string;
  online?: boolean;
}) {
  return (
    <View style={styles.summaryBox}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, online && styles.online]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 20, paddingBottom: 40},
  flexOne: {flex: 1},
  heroCard: {backgroundColor: colors.surface, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: colors.border},
  eyebrow: {color: colors.accent, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', marginBottom: 8},
  title: {color: colors.textPrimary, fontSize: 24, fontWeight: '900'},
  body: {color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 8},
  summaryCard: {marginTop: 16, backgroundColor: colors.surfaceSoft, borderRadius: 18, padding: 12, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  summaryBox: {width: '47%', flexGrow: 1, backgroundColor: colors.background, borderRadius: 12, padding: 10},
  summaryLabel: {color: colors.textMuted, fontSize: 10, fontWeight: '800'},
  summaryValue: {color: colors.textPrimary, fontSize: 13, fontWeight: '900', marginTop: 4},
  online: {color: colors.success},
  sectionCard: {marginTop: 16, backgroundColor: colors.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border},
  sectionTitle: {color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginBottom: 8},
  rowBetween: {flexDirection: 'row', alignItems: 'center', gap: 12},
  detail: {color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 4},
  statusText: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 10},
  emptyText: {color: colors.textMuted, fontSize: 13, lineHeight: 19},
  smallButton: {borderRadius: 12, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: 12, paddingVertical: 9},
  smallButtonText: {color: colors.accent, fontSize: 11, fontWeight: '900'},
  disabled: {opacity: 0.4},
  peerCard: {backgroundColor: colors.background, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 8},
  selectedCard: {borderColor: colors.accent, borderWidth: 2},
  peerId: {color: colors.textPrimary, fontSize: 16, fontWeight: '900', letterSpacing: 0.6},
  peerRole: {color: colors.accent, fontSize: 11, fontWeight: '800', marginTop: 3},
  rightText: {alignItems: 'flex-end'},
  capabilities: {color: colors.textMuted, fontSize: 10, marginTop: 8},
  actionRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10},
  actionButton: {width: '47%', flexGrow: 1, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, paddingVertical: 11, alignItems: 'center'},
  actionText: {color: colors.accent, fontSize: 11, fontWeight: '900'},
  input: {minHeight: 90, backgroundColor: colors.background, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, color: colors.textPrimary, fontSize: 15, textAlignVertical: 'top'},
  primaryButton: {marginTop: 12, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 13, alignItems: 'center'},
  primaryButtonText: {color: colors.background, fontSize: 13, fontWeight: '900'},
  storageText: {color: colors.textMuted, fontSize: 10, marginTop: 7},
  contactCard: {backgroundColor: colors.background, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 8},
  contactName: {color: colors.textPrimary, fontSize: 15, fontWeight: '900'},
  contactType: {color: colors.accent, fontSize: 10, fontWeight: '900'},
});
