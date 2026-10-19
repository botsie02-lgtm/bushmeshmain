import React, {useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {BushMeshChannel, useBushMesh} from '../state/BushMeshContext';
import {colors} from '../theme/colors';

type SendMode = 'mesh' | 'bushmesh' | 'meshcore';

function isPrivateChannel(channel: BushMeshChannel): boolean {
  return (
    channel.secret !== 'Empty / Public' &&
    channel.secret !== 'Unknown' &&
    channel.secret.length > 0
  );
}

function nodeIdLabel(nodeId: number | null): string {
  return nodeId === null
    ? 'Waiting for SELF_INFO'
    : nodeId.toString(16).padStart(8, '0').toUpperCase();
}

export function ChannelsScreen(): React.JSX.Element {
  const {
    connectionStatus,
    connectedDeviceName,
    localBushMeshNodeId,
    knownBushMeshPeers,
    bushMeshRuntimeStats,
    channels,
    activeChannelIndex,
    activeChannel,
    channelMessages,
    canSendChannelMessage,
    canSendBushMeshMessage,
    canSendBushMeshRoutedMessage,
    bushMeshNetworkStatus,
    sendChannelMessage,
    sendBushMeshMessage,
    sendBushMeshRoutedMessage,
    addLocalChannelMessage,
    setActiveChannelIndex,
  } = useBushMesh();

  const [messageText, setMessageText] = useState('Test from BushMesh');
  const [sendMode, setSendMode] = useState<SendMode>('mesh');
  const [sendStatus, setSendStatus] = useState('No channel message sent yet.');
  const [isSending, setIsSending] = useState(false);

  const visibleChannels = channels.filter(
    channel => channel.channelName && channel.channelName !== 'Empty',
  );
  const activeIsPrivate = activeChannel ? isPrivateChannel(activeChannel) : false;
  const trimmedMessage = messageText.trim();
  const plainMessageTooLong =
    sendMode === 'meshcore' && trimmedMessage.length > 133;
  const selectedTransportReady =
    sendMode === 'mesh'
      ? canSendBushMeshRoutedMessage
      : sendMode === 'bushmesh'
        ? canSendBushMeshMessage
        : canSendChannelMessage;
  const canSend =
    !!activeChannel &&
    selectedTransportReady &&
    trimmedMessage.length > 0 &&
    !plainMessageTooLong &&
    !isSending;

  const sendActiveChannelMessage = async () => {
    if (!activeChannel) {
      setSendStatus('No active channel selected.');
      return;
    }

    const channelIndex = Number(activeChannel.channelIndex);
    if (!Number.isFinite(channelIndex)) {
      setSendStatus('Active channel index is invalid.');
      return;
    }

    try {
      setIsSending(true);

      if (sendMode === 'mesh') {
        setSendStatus(
          `Sending routed BushMesh broadcast on ${activeChannel.channelName}...`,
        );
        const result = await sendBushMeshRoutedMessage(
          channelIndex,
          trimmedMessage,
        );
        addLocalChannelMessage({
          channelIndex: activeChannel.channelIndex,
          channelName: activeChannel.channelName,
          text: trimmedMessage,
          direction: 'sent',
          status: 'sent',
          protocol: 'bushmesh-routed',
        });
        setSendStatus(
          `Routed message ${result.messageId} sent in ${result.frameCount} frame(s); receivers may forward it once while TTL remains.`,
        );
      } else if (sendMode === 'bushmesh') {
        setSendStatus(
          `Sending BushMesh protocol packet to ${activeChannel.channelName}...`,
        );
        const result = await sendBushMeshMessage(channelIndex, trimmedMessage);
        addLocalChannelMessage({
          channelIndex: activeChannel.channelIndex,
          channelName: activeChannel.channelName,
          text: trimmedMessage,
          direction: 'sent',
          status: 'sent',
          protocol: 'bushmesh',
        });
        setSendStatus(
          `BushMesh message ${result.messageId} sent in ${result.frameCount} frame(s) via ${result.transport}.`,
        );
      } else {
        setSendStatus(
          `Sending plain MeshCore text to ${activeChannel.channelName}...`,
        );
        await sendChannelMessage(channelIndex, trimmedMessage);
        addLocalChannelMessage({
          channelIndex: activeChannel.channelIndex,
          channelName: activeChannel.channelName,
          text: trimmedMessage,
          direction: 'sent',
          status: 'sent',
          protocol: 'meshcore-text',
        });
        setSendStatus(
          `Plain MeshCore text sent to ${activeChannel.channelName}.`,
        );
      }

      setMessageText('');
    } catch (error) {
      setSendStatus(
        error instanceof Error ? error.message : 'Failed to send message.',
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerCard}>
        <Text style={styles.eyebrow}>Channels</Text>
        <Text style={styles.title}>BushMesh Messaging</Text>
        <Text style={styles.body}>
          Use routed mesh packets for multi-hop traffic, compact BushMesh packets
          for direct channel compatibility, or plain MeshCore text as a fallback.
        </Text>
      </View>

      <View style={styles.statusCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.statusLabel}>Connection</Text>
            <Text
              style={[
                styles.statusValue,
                {
                  color:
                    connectionStatus === 'Connected'
                      ? colors.success
                      : colors.textSecondary,
                },
              ]}>
              {connectionStatus}
            </Text>
          </View>
          <View style={styles.nodeIdBox}>
            <Text style={styles.detailLabel}>BushMesh Node ID</Text>
            <Text style={styles.nodeIdValue}>
              {nodeIdLabel(localBushMeshNodeId)}
            </Text>
          </View>
        </View>

        <Text style={styles.statusDetail}>
          {connectedDeviceName
            ? `Connected to ${connectedDeviceName}`
            : 'No companion node connected.'}
        </Text>

        <View style={styles.protocolStatusRow}>
          <View
            style={[
              styles.protocolDot,
              {
                backgroundColor: bushMeshNetworkStatus.active
                  ? colors.success
                  : colors.textMuted,
              },
            ]}
          />
          <View style={styles.flexOne}>
            <Text style={styles.protocolStatusTitle}>BushMesh Runtime</Text>
            <Text style={styles.statusDetail}>{bushMeshNetworkStatus.detail}</Text>
          </View>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Runtime Counters</Text>
        <View style={styles.metricGrid}>
          <Metric label="TX frames" value={bushMeshRuntimeStats.sentFrames} />
          <Metric label="RX frames" value={bushMeshRuntimeStats.receivedFrames} />
          <Metric label="Messages RX" value={bushMeshRuntimeStats.receivedMessages} />
          <Metric label="Retransmits" value={bushMeshRuntimeStats.retransmittedFrames} />
          <Metric label="ACK sent" value={bushMeshRuntimeStats.ackFramesSent} />
          <Metric label="ACK received" value={bushMeshRuntimeStats.ackFramesReceived} />
          <Metric label="Decode errors" value={bushMeshRuntimeStats.decodeErrors} />
          <Metric label="Peers" value={knownBushMeshPeers.length} />
        </View>
      </View>

      <View style={styles.activeCard}>
        <Text style={styles.sectionTitle}>Active Channel</Text>
        {activeChannel ? (
          <>
            <View style={styles.rowBetween}>
              <View style={styles.flexOne}>
                <Text style={styles.activeName}>{activeChannel.channelName}</Text>
                <Text style={styles.activeSubText}>
                  Channel #{activeChannel.channelIndex}
                </Text>
              </View>
              <View
                style={[
                  styles.channelTypePill,
                  activeIsPrivate && styles.channelTypePillPrivate,
                ]}>
                <Text style={styles.channelTypeText}>
                  {activeIsPrivate ? 'Private' : 'Public'}
                </Text>
              </View>
            </View>
            <Text style={styles.modeHelp}>
              Routed mesh traffic carries source identity, optional destination,
              hop TTL and duplicate suppression while still travelling through
              the selected MeshCore channel.
            </Text>
          </>
        ) : (
          <Text style={styles.emptyText}>
            No active channel selected. Connect a companion node and let startup
            sync load its channels.
          </Text>
        )}
      </View>

      <View style={styles.sendCard}>
        <Text style={styles.sectionTitle}>Send Message</Text>

        <View style={styles.modeRow}>
          <ModeButton
            label="Routed Mesh"
            active={sendMode === 'mesh'}
            onPress={() => setSendMode('mesh')}
          />
          <ModeButton
            label="BushMesh Packet"
            active={sendMode === 'bushmesh'}
            onPress={() => setSendMode('bushmesh')}
          />
          <ModeButton
            label="Plain Text"
            active={sendMode === 'meshcore'}
            onPress={() => setSendMode('meshcore')}
          />
        </View>

        <Text style={styles.modeHelp}>
          {sendMode === 'mesh'
            ? 'Broadcasts a routed BushMesh wrapper. Each compatible receiver delivers it locally and may rebroadcast it once while hop TTL remains.'
            : sendMode === 'bushmesh'
              ? 'Uses semantic/dictionary compression and fragmentation, but does not add the routed source/destination wrapper.'
              : 'Sends ordinary MeshCore channel text exactly as before and is limited to 133 characters.'}
        </Text>

        <TextInput
          style={styles.messageInput}
          value={messageText}
          onChangeText={setMessageText}
          placeholder="Type a channel message"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={1000}
        />

        <View style={styles.messageMetaRow}>
          <Text
            style={[
              styles.messageCount,
              plainMessageTooLong && styles.messageCountError,
            ]}>
            {trimmedMessage.length}
            {sendMode === 'meshcore' ? '/133' : ' characters'}
          </Text>
          <Text style={styles.messageStatus}>{sendStatus}</Text>
        </View>

        <TouchableOpacity
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          onPress={sendActiveChannelMessage}
          disabled={!canSend}>
          <Text style={styles.sendButtonText}>
            {isSending
              ? 'Sending...'
              : sendMode === 'mesh'
                ? 'Send Routed Mesh Message'
                : sendMode === 'bushmesh'
                  ? 'Send BushMesh Packet'
                  : 'Send Plain MeshCore Text'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Known BushMesh Peers</Text>
        {knownBushMeshPeers.length === 0 ? (
          <Text style={styles.emptyText}>
            No BushMesh node hellos received yet. Peers appear here after node
            discovery traffic is received.
          </Text>
        ) : (
          knownBushMeshPeers.map(peer => (
            <View key={peer.nodeId} style={styles.peerRow}>
              <View style={styles.flexOne}>
                <Text style={styles.peerId}>
                  {peer.nodeId.toString(16).padStart(8, '0').toUpperCase()}
                </Text>
                <Text style={styles.peerDetail}>
                  Role {peer.role} • Capabilities 0x
                  {peer.capabilities.toString(16).toUpperCase()}
                </Text>
              </View>
              <View style={styles.peerRight}>
                <Text style={styles.peerBattery}>
                  {peer.batteryPercent === undefined
                    ? 'Battery ?'
                    : `${peer.batteryPercent}%`}
                </Text>
                <Text style={styles.peerDetail}>
                  {new Date(peer.lastSeenAt).toLocaleTimeString()}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.messageHistoryCard}>
        <Text style={styles.sectionTitle}>Channel Messages</Text>
        {channelMessages.length === 0 ? (
          <Text style={styles.emptyText}>No local messages yet.</Text>
        ) : (
          channelMessages.map(message => (
            <View key={message.id} style={styles.messageBubble}>
              <View style={styles.rowBetween}>
                <Text style={styles.messageChannel}>
                  {message.channelName} #{message.channelIndex}
                </Text>
                <Text style={styles.messageDirection}>
                  {message.direction === 'sent' ? 'Sent' : 'Received'}
                </Text>
              </View>
              <Text style={styles.messageText}>{message.text}</Text>
              <View style={styles.messageFooterRow}>
                <Text style={styles.messageTime}>
                  {new Date(message.createdAt).toLocaleTimeString()}
                </Text>
                <Text style={styles.protocolLabel}>
                  {message.protocol === 'bushmesh-routed'
                    ? 'Routed Mesh'
                    : message.protocol === 'bushmesh'
                      ? 'BushMesh'
                      : message.protocol === 'meshcore-text'
                        ? 'MeshCore text'
                        : 'Local'}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Available Channels</Text>
        {visibleChannels.length === 0 ? (
          <Text style={styles.emptyText}>No named channels are loaded yet.</Text>
        ) : (
          visibleChannels.map(channel => {
            const isActive = channel.channelIndex === activeChannelIndex;
            const channelIsPrivate = isPrivateChannel(channel);
            return (
              <TouchableOpacity
                key={channel.channelIndex}
                style={[
                  styles.channelCard,
                  isActive && styles.channelCardActive,
                ]}
                onPress={() => setActiveChannelIndex(channel.channelIndex)}>
                <View style={styles.rowBetween}>
                  <View style={styles.flexOne}>
                    <Text style={styles.channelName}>{channel.channelName}</Text>
                    <Text style={styles.channelPurpose}>
                      {isActive
                        ? 'Active channel selected.'
                        : 'Tap to make active.'}
                    </Text>
                  </View>
                  <View style={styles.channelRightWrap}>
                    <Text style={styles.channelIndex}>
                      #{channel.channelIndex}
                    </Text>
                    <Text
                      style={[
                        styles.smallTypeText,
                        channelIsPrivate && styles.smallTypeTextPrivate,
                      ]}>
                      {channelIsPrivate ? 'Private' : 'Public'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function Metric({label, value}: {label: string; value: number}): React.JSX.Element {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ModeButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      style={[styles.modeButton, active && styles.modeButtonActive]}
      onPress={onPress}>
      <Text
        style={[
          styles.modeButtonText,
          active && styles.modeButtonTextActive,
        ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 20, paddingBottom: 40},
  flexOne: {flex: 1},
  headerCard: {
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
  body: {color: colors.textSecondary, fontSize: 15, lineHeight: 22},
  statusCard: {
    marginTop: 16,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBetween: {flexDirection: 'row', alignItems: 'center', gap: 12},
  statusLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  statusValue: {fontSize: 18, fontWeight: '900'},
  statusDetail: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  nodeIdBox: {alignItems: 'flex-end', maxWidth: '52%'},
  nodeIdValue: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 4,
  },
  protocolStatusRow: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  protocolDot: {width: 10, height: 10, borderRadius: 5, marginTop: 5},
  protocolStatusTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
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
    marginBottom: 12,
  },
  metricGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  metricBox: {
    width: '48%',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricValue: {color: colors.textPrimary, fontSize: 18, fontWeight: '900'},
  metricLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 3,
  },
  activeCard: {
    marginTop: 18,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeName: {color: colors.textPrimary, fontSize: 22, fontWeight: '900'},
  activeSubText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  channelTypePill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  channelTypePillPrivate: {backgroundColor: colors.warning},
  channelTypeText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: '900',
  },
  detailLabel: {color: colors.textMuted, fontSize: 11, fontWeight: '800'},
  sendCard: {
    marginTop: 18,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeRow: {flexDirection: 'row', gap: 7},
  modeButton: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceSoft,
  },
  modeButtonText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  modeButtonTextActive: {color: colors.accent},
  modeHelp: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  messageInput: {
    marginTop: 12,
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
  messageMetaRow: {marginTop: 8, gap: 6},
  messageCount: {color: colors.textMuted, fontSize: 12, fontWeight: '800'},
  messageCountError: {color: colors.danger},
  messageStatus: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  sendButton: {
    marginTop: 12,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  sendButtonDisabled: {opacity: 0.4},
  sendButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  peerId: {color: colors.accent, fontSize: 14, fontWeight: '900'},
  peerDetail: {color: colors.textMuted, fontSize: 11, marginTop: 3},
  peerRight: {alignItems: 'flex-end'},
  peerBattery: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  messageHistoryCard: {
    marginTop: 18,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageBubble: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  messageChannel: {
    flex: 1,
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
  },
  messageDirection: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '900',
  },
  messageText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    marginTop: 8,
  },
  messageFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  messageTime: {color: colors.textMuted, fontSize: 11, fontWeight: '700'},
  protocolLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  emptyText: {color: colors.textMuted, fontSize: 14, lineHeight: 21},
  channelCard: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  channelCardActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceSoft,
  },
  channelName: {color: colors.textPrimary, fontSize: 18, fontWeight: '900'},
  channelPurpose: {color: colors.textSecondary, fontSize: 13, marginTop: 4},
  channelRightWrap: {alignItems: 'flex-end'},
  channelIndex: {color: colors.accent, fontSize: 14, fontWeight: '900'},
  smallTypeText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 5,
  },
  smallTypeTextPrivate: {color: colors.warning},
});
