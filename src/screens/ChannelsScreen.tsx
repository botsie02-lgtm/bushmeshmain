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
    ? 'Waiting for identity'
    : nodeId.toString(16).padStart(8, '0').toUpperCase();
}

export function ChannelsScreen(): React.JSX.Element {
  const {
    connectionStatus,
    connectedDeviceName,
    localBushMeshNodeId,
    knownBushMeshPeers,
    bushMeshRuntimeStats,
    bushMeshDeliveryStatus,
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
    flushBushMeshQueuedMessages,
    addLocalChannelMessage,
    setActiveChannelIndex,
  } = useBushMesh();

  const [messageText, setMessageText] = useState('Test from BushMesh');
  const [sendMode, setSendMode] = useState<SendMode>('mesh');
  const [sendStatus, setSendStatus] = useState('No message sent yet.');
  const [isSending, setIsSending] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);

  const visibleChannels = channels.filter(
    channel => channel.channelName && channel.channelName !== 'Empty',
  );
  const trimmedMessage = messageText.trim();
  const plainTooLong = sendMode === 'meshcore' && trimmedMessage.length > 133;
  const modeReady =
    sendMode === 'mesh'
      ? canSendBushMeshRoutedMessage
      : sendMode === 'bushmesh'
        ? canSendBushMeshMessage
        : canSendChannelMessage;
  const canSend =
    !!activeChannel &&
    modeReady &&
    trimmedMessage.length > 0 &&
    !plainTooLong &&
    !isSending;

  const sendMessage = async () => {
    if (!activeChannel) {
      setSendStatus('Select an active channel first.');
      return;
    }

    const channelIndex = Number(activeChannel.channelIndex);
    if (!Number.isInteger(channelIndex)) {
      setSendStatus('Active channel index is invalid.');
      return;
    }

    try {
      setIsSending(true);

      if (sendMode === 'mesh') {
        setSendStatus('Sending routed BushMesh message...');
        const result = await sendBushMeshRoutedMessage(
          channelIndex,
          trimmedMessage,
        );

        addLocalChannelMessage({
          channelIndex: activeChannel.channelIndex,
          channelName: activeChannel.channelName,
          text: trimmedMessage,
          direction: 'sent',
          status: result.state === 'sent' ? 'sent' : 'pending',
          protocol: 'bushmesh-routed',
          bushMeshMessageId: result.messageId,
          deliveryQueueId: result.queueId ?? undefined,
        });

        if (result.state === 'queued') {
          setSendStatus(
            `Routed message ${result.messageId} could not transmit now and was saved for retry${result.queueId ? ` as ${result.queueId}` : ''}.`,
          );
        } else {
          setSendStatus(
            `Routed message ${result.messageId} sent in ${result.frameCount ?? 0} frame(s).`,
          );
        }
      } else if (sendMode === 'bushmesh') {
        setSendStatus('Sending compact BushMesh packet...');
        const result = await sendBushMeshMessage(channelIndex, trimmedMessage);
        addLocalChannelMessage({
          channelIndex: activeChannel.channelIndex,
          channelName: activeChannel.channelName,
          text: trimmedMessage,
          direction: 'sent',
          status: 'sent',
          protocol: 'bushmesh',
          bushMeshMessageId: result.messageId,
        });
        setSendStatus(
          `BushMesh message ${result.messageId} sent in ${result.frameCount} frame(s) via ${result.transport}.`,
        );
      } else {
        setSendStatus('Sending plain MeshCore text...');
        await sendChannelMessage(channelIndex, trimmedMessage);
        addLocalChannelMessage({
          channelIndex: activeChannel.channelIndex,
          channelName: activeChannel.channelName,
          text: trimmedMessage,
          direction: 'sent',
          status: 'sent',
          protocol: 'meshcore-text',
        });
        setSendStatus('Plain MeshCore text sent.');
      }

      setMessageText('');
    } catch (error) {
      setSendStatus(
        error instanceof Error ? error.message : 'Message send failed.',
      );
    } finally {
      setIsSending(false);
    }
  };

  const flushQueue = async () => {
    try {
      setIsFlushing(true);
      await flushBushMeshQueuedMessages();
      setSendStatus('Requested an immediate retry of queued BushMesh messages.');
    } catch (error) {
      setSendStatus(
        error instanceof Error ? error.message : 'Queue retry failed.',
      );
    } finally {
      setIsFlushing(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Channels</Text>
        <Text style={styles.title}>BushMesh Messaging</Text>
        <Text style={styles.body}>
          Routed mesh is the normal BushMesh mode. Compact packets keep protocol
          features without routing, while plain MeshCore text remains available
          for compatibility.
        </Text>
      </View>

      <View style={styles.statusCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.label}>Connection</Text>
            <Text
              style={[
                styles.statusValue,
                connectionStatus === 'Connected' && styles.online,
              ]}>
              {connectionStatus}
            </Text>
            <Text style={styles.detail}>
              {connectedDeviceName ?? 'No companion node connected'}
            </Text>
          </View>
          <View style={styles.rightSummary}>
            <Text style={styles.label}>Node ID</Text>
            <Text style={styles.nodeId}>{nodeIdLabel(localBushMeshNodeId)}</Text>
          </View>
        </View>
        <Text style={styles.runtimeText}>{bushMeshNetworkStatus.detail}</Text>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.sectionTitle}>Delivery Queue</Text>
            <Text style={styles.detail}>{bushMeshDeliveryStatus.detail}</Text>
          </View>
          <View style={styles.queueCountBox}>
            <Text style={styles.queueCount}>{bushMeshDeliveryStatus.queuedMessages}</Text>
            <Text style={styles.queueCountLabel}>queued</Text>
          </View>
        </View>
        <Text style={styles.storageText}>
          Storage: {bushMeshDeliveryStatus.storageLabel}
          {bushMeshDeliveryStatus.persistentStorageAvailable
            ? ' • survives Android app restart'
            : ' • memory-only'}
        </Text>
        <TouchableOpacity
          style={[
            styles.secondaryButton,
            (bushMeshDeliveryStatus.queuedMessages === 0 || isFlushing) &&
              styles.disabled,
          ]}
          disabled={
            bushMeshDeliveryStatus.queuedMessages === 0 || isFlushing
          }
          onPress={flushQueue}>
          <Text style={styles.secondaryButtonText}>
            {isFlushing ? 'Retrying...' : 'Retry queued messages now'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Runtime</Text>
        <View style={styles.metricGrid}>
          <Metric label="TX frames" value={bushMeshRuntimeStats.sentFrames} />
          <Metric label="RX frames" value={bushMeshRuntimeStats.receivedFrames} />
          <Metric label="Peers" value={knownBushMeshPeers.length} />
          <Metric label="Retries" value={bushMeshRuntimeStats.retransmittedFrames} />
          <Metric label="ACK TX" value={bushMeshRuntimeStats.ackFramesSent} />
          <Metric label="ACK RX" value={bushMeshRuntimeStats.ackFramesReceived} />
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Active Channel</Text>
        {activeChannel ? (
          <View style={styles.rowBetween}>
            <View style={styles.flexOne}>
              <Text style={styles.activeName}>{activeChannel.channelName}</Text>
              <Text style={styles.detail}>Channel #{activeChannel.channelIndex}</Text>
            </View>
            <View style={styles.pill}>
              <Text style={styles.pillText}>
                {isPrivateChannel(activeChannel) ? 'Private' : 'Public'}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.emptyText}>No active channel is loaded.</Text>
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Send Message</Text>
        <View style={styles.modeRow}>
          <ModeButton
            label="Routed Mesh"
            active={sendMode === 'mesh'}
            onPress={() => setSendMode('mesh')}
          />
          <ModeButton
            label="BushMesh"
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
            ? 'Adds source identity, hop TTL and forwarding. Failed store-and-forward sends can be queued for retry.'
            : sendMode === 'bushmesh'
              ? 'Uses compact BushMesh encoding and fragmentation without the routed wrapper.'
              : 'Sends standard MeshCore channel text and keeps the 133-character limit.'}
        </Text>

        <TextInput
          style={styles.input}
          value={messageText}
          onChangeText={setMessageText}
          placeholder="Type a message"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={1000}
        />
        <Text style={[styles.counter, plainTooLong && styles.errorText]}>
          {trimmedMessage.length}
          {sendMode === 'meshcore' ? '/133' : ' characters'}
        </Text>
        <Text style={styles.sendStatus}>{sendStatus}</Text>

        <TouchableOpacity
          style={[styles.primaryButton, !canSend && styles.disabled]}
          disabled={!canSend}
          onPress={sendMessage}>
          <Text style={styles.primaryButtonText}>
            {isSending ? 'Sending...' : 'Send'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Recent Messages</Text>
        {channelMessages.length === 0 ? (
          <Text style={styles.emptyText}>No local message history yet.</Text>
        ) : (
          channelMessages.slice(0, 30).map(message => (
            <View key={message.id} style={styles.messageCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.messageChannel}>
                  {message.channelName} #{message.channelIndex}
                </Text>
                <Text
                  style={[
                    styles.messageState,
                    message.status === 'pending' && styles.pending,
                    message.status === 'failed' && styles.failed,
                  ]}>
                  {message.status === 'pending'
                    ? 'Queued'
                    : message.status === 'failed'
                      ? 'Failed'
                      : message.direction === 'received'
                        ? 'Received'
                        : 'Sent'}
                </Text>
              </View>
              <Text style={styles.messageText}>{message.text}</Text>
              <Text style={styles.messageMeta}>
                {message.protocol ?? 'local'}
                {message.bushMeshMessageId !== undefined
                  ? ` • #${message.bushMeshMessageId}`
                  : ''}
                {' • '}
                {new Date(message.createdAt).toLocaleTimeString()}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Available Channels</Text>
        {visibleChannels.length === 0 ? (
          <Text style={styles.emptyText}>No named channels are loaded.</Text>
        ) : (
          visibleChannels.map(channel => {
            const selected = channel.channelIndex === activeChannelIndex;
            return (
              <TouchableOpacity
                key={channel.channelIndex}
                style={[styles.channelCard, selected && styles.channelSelected]}
                onPress={() => setActiveChannelIndex(channel.channelIndex)}>
                <View style={styles.rowBetween}>
                  <View style={styles.flexOne}>
                    <Text style={styles.channelName}>{channel.channelName}</Text>
                    <Text style={styles.detail}>
                      {selected ? 'Active channel' : 'Tap to make active'}
                    </Text>
                  </View>
                  <Text style={styles.channelIndex}>#{channel.channelIndex}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function Metric({label, value}: {label: string; value: number}) {
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
}) {
  return (
    <TouchableOpacity
      style={[styles.modeButton, active && styles.modeButtonActive]}
      onPress={onPress}>
      <Text style={[styles.modeText, active && styles.modeTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 20, paddingBottom: 40},
  flexOne: {flex: 1},
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
  title: {color: colors.textPrimary, fontSize: 24, fontWeight: '900'},
  body: {color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 8},
  statusCard: {
    marginTop: 16,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionCard: {
    marginTop: 16,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBetween: {flexDirection: 'row', alignItems: 'center', gap: 12},
  label: {color: colors.textMuted, fontSize: 11, fontWeight: '800'},
  statusValue: {color: colors.textSecondary, fontSize: 18, fontWeight: '900', marginTop: 3},
  online: {color: colors.success},
  detail: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4},
  runtimeText: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 12},
  rightSummary: {maxWidth: '55%', alignItems: 'flex-end'},
  nodeId: {color: colors.accent, fontSize: 13, fontWeight: '900', marginTop: 4},
  sectionTitle: {color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginBottom: 10},
  queueCountBox: {alignItems: 'center', minWidth: 54},
  queueCount: {color: colors.accent, fontSize: 24, fontWeight: '900'},
  queueCountLabel: {color: colors.textMuted, fontSize: 10, fontWeight: '800'},
  storageText: {color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 10},
  metricGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  metricBox: {width: '31%', flexGrow: 1, backgroundColor: colors.background, borderRadius: 12, padding: 10},
  metricValue: {color: colors.textPrimary, fontSize: 18, fontWeight: '900'},
  metricLabel: {color: colors.textMuted, fontSize: 10, fontWeight: '800', marginTop: 3},
  activeName: {color: colors.textPrimary, fontSize: 20, fontWeight: '900'},
  pill: {backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6},
  pillText: {color: colors.background, fontSize: 11, fontWeight: '900'},
  modeRow: {flexDirection: 'row', gap: 7},
  modeButton: {flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6},
  modeButtonActive: {borderColor: colors.accent},
  modeText: {color: colors.textSecondary, fontSize: 11, fontWeight: '800'},
  modeTextActive: {color: colors.accent},
  modeHelp: {color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 10},
  input: {marginTop: 12, minHeight: 90, backgroundColor: colors.background, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, color: colors.textPrimary, fontSize: 15, textAlignVertical: 'top'},
  counter: {color: colors.textMuted, fontSize: 11, marginTop: 7},
  errorText: {color: colors.danger},
  sendStatus: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 8},
  primaryButton: {marginTop: 12, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 13, alignItems: 'center'},
  primaryButtonText: {color: colors.background, fontSize: 14, fontWeight: '900'},
  secondaryButton: {marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, paddingVertical: 11, alignItems: 'center'},
  secondaryButtonText: {color: colors.accent, fontSize: 12, fontWeight: '900'},
  disabled: {opacity: 0.4},
  emptyText: {color: colors.textMuted, fontSize: 13, lineHeight: 19},
  messageCard: {backgroundColor: colors.background, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 8},
  messageChannel: {color: colors.accent, fontSize: 11, fontWeight: '900', flex: 1},
  messageState: {color: colors.success, fontSize: 11, fontWeight: '900'},
  pending: {color: colors.warning},
  failed: {color: colors.danger},
  messageText: {color: colors.textPrimary, fontSize: 14, lineHeight: 20, marginTop: 7},
  messageMeta: {color: colors.textMuted, fontSize: 10, marginTop: 7},
  channelCard: {backgroundColor: colors.background, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 13, marginTop: 8},
  channelSelected: {borderColor: colors.accent},
  channelName: {color: colors.textPrimary, fontSize: 16, fontWeight: '900'},
  channelIndex: {color: colors.accent, fontSize: 13, fontWeight: '900'},
});
