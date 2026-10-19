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

type SendMode = 'bushmesh' | 'meshcore';

function isPrivateChannel(channel: BushMeshChannel): boolean {
  return (
    channel.secret !== 'Empty / Public' &&
    channel.secret !== 'Unknown' &&
    channel.secret.length > 0
  );
}

export function ChannelsScreen(): React.JSX.Element {
  const {
    connectionStatus,
    connectedDeviceName,
    channels,
    activeChannelIndex,
    activeChannel,
    channelMessages,
    canSendChannelMessage,
    canSendBushMeshMessage,
    bushMeshNetworkStatus,
    sendChannelMessage,
    sendBushMeshMessage,
    addLocalChannelMessage,
    setActiveChannelIndex,
  } = useBushMesh();

  const [messageText, setMessageText] = useState('Test from BushMesh');
  const [sendMode, setSendMode] = useState<SendMode>('bushmesh');
  const [sendStatus, setSendStatus] = useState<string>(
    'No channel message sent yet.',
  );
  const [isSending, setIsSending] = useState(false);

  const visibleChannels = channels.filter(
    channel => channel.channelName && channel.channelName !== 'Empty',
  );
  const activeIsPrivate = activeChannel ? isPrivateChannel(activeChannel) : false;
  const trimmedMessage = messageText.trim();
  const plainMessageTooLong = sendMode === 'meshcore' && trimmedMessage.length > 133;
  const selectedTransportReady =
    sendMode === 'bushmesh' ? canSendBushMeshMessage : canSendChannelMessage;
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

      if (sendMode === 'bushmesh') {
        setSendStatus(
          `Encoding and sending BushMesh message to ${activeChannel.channelName}...`,
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
        setSendStatus(`Sending plain MeshCore text to ${activeChannel.channelName}...`);
        await sendChannelMessage(channelIndex, trimmedMessage);

        addLocalChannelMessage({
          channelIndex: activeChannel.channelIndex,
          channelName: activeChannel.channelName,
          text: trimmedMessage,
          direction: 'sent',
          status: 'sent',
          protocol: 'meshcore-text',
        });

        setSendStatus(`Plain MeshCore text sent to ${activeChannel.channelName}.`);
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
        <Text style={styles.title}>MeshCore Channels</Text>
        <Text style={styles.body}>
          Select the active channel BushMesh will use for convoy and group
          messages.
        </Text>
      </View>

      <View style={styles.statusCard}>
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
          <View style={styles.protocolStatusTextWrap}>
            <Text style={styles.protocolStatusTitle}>BushMesh Protocol</Text>
            <Text style={styles.statusDetail}>{bushMeshNetworkStatus.detail}</Text>
          </View>
        </View>
      </View>

      <View style={styles.activeCard}>
        <Text style={styles.sectionTitle}>Active Channel</Text>

        {activeChannel ? (
          <>
            <View style={styles.activeTopRow}>
              <View style={styles.activeNameWrap}>
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

            <View style={styles.messageReadyCard}>
              <Text style={styles.messageReadyTitle}>Protocol-ready</Text>
              <Text style={styles.messageReadyText}>
                BushMesh can encode semantic/dictionary messages and fragment
                longer payloads while using the text-safe MeshCore carrier.
              </Text>
            </View>

            <View style={styles.detailGrid}>
              <View style={styles.detailBox}>
                <Text style={styles.detailLabel}>Channel Index</Text>
                <Text style={styles.detailValue}>
                  {activeChannel.channelIndex}
                </Text>
              </View>

              <View style={styles.detailBox}>
                <Text style={styles.detailLabel}>Type</Text>
                <Text style={styles.detailValue}>
                  {activeIsPrivate ? 'Private' : 'Public'}
                </Text>
              </View>
            </View>

            <View style={styles.secretBox}>
              <Text style={styles.secretLabel}>Secret</Text>
              <Text style={styles.secretValue}>{activeChannel.secret}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.emptyText}>
            No active channel selected yet. Connect to your companion node and
            let startup sync load channels.
          </Text>
        )}
      </View>

      <View style={styles.sendCard}>
        <Text style={styles.sectionTitle}>Send Message</Text>
        <Text style={styles.body}>
          BushMesh Protocol is the compact application-layer format. Plain
          MeshCore Text remains available as a compatibility fallback.
        </Text>

        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[
              styles.modeButton,
              sendMode === 'bushmesh' && styles.modeButtonActive,
            ]}
            onPress={() => setSendMode('bushmesh')}>
            <Text
              style={[
                styles.modeButtonText,
                sendMode === 'bushmesh' && styles.modeButtonTextActive,
              ]}>
              BushMesh Protocol
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeButton,
              sendMode === 'meshcore' && styles.modeButtonActive,
            ]}
            onPress={() => setSendMode('meshcore')}>
            <Text
              style={[
                styles.modeButtonText,
                sendMode === 'meshcore' && styles.modeButtonTextActive,
              ]}>
              Plain MeshCore Text
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.modeHelp}>
          {sendMode === 'bushmesh'
            ? 'Uses semantic/dictionary compression where useful and fragments automatically when required.'
            : 'Sends the message exactly as normal MeshCore channel text and is limited to 133 characters.'}
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
              : sendMode === 'bushmesh'
                ? 'Send via BushMesh Protocol'
                : 'Send Plain MeshCore Text'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.messageHistoryCard}>
        <Text style={styles.sectionTitle}>Channel Messages</Text>

        {channelMessages.length === 0 ? (
          <Text style={styles.emptyText}>No local messages yet.</Text>
        ) : (
          channelMessages.map(message => (
            <View key={message.id} style={styles.messageBubble}>
              <View style={styles.messageBubbleTopRow}>
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
                  {message.protocol === 'bushmesh'
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

        {channels.length === 0 ? (
          <Text style={styles.emptyText}>
            No channels loaded yet. Connect from the Device tab. Startup sync
            should load channels automatically.
          </Text>
        ) : null}

        {visibleChannels.length > 0 ? (
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
                <View style={styles.channelTopRow}>
                  <View style={styles.channelNameWrap}>
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
        ) : channels.length > 0 ? (
          <Text style={styles.emptyText}>
            Channel sync finished, but no named channels were found.
          </Text>
        ) : null}
      </View>

      {channels.length > 0 ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>All Channel Slots</Text>

          {channels.map(channel => {
            const isActive = channel.channelIndex === activeChannelIndex;
            const canSelect =
              channel.channelName && channel.channelName !== 'Empty';

            return (
              <TouchableOpacity
                key={`slot-${channel.channelIndex}`}
                style={[styles.slotRow, isActive && styles.slotRowActive]}
                disabled={!canSelect}
                onPress={() => setActiveChannelIndex(channel.channelIndex)}>
                <Text
                  style={[
                    styles.slotText,
                    isActive && styles.slotTextActive,
                    !canSelect && styles.slotTextDisabled,
                  ]}>
                  Channel {channel.channelIndex}: {channel.channelName}
                  {isActive ? '  • Active' : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
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
    padding: 20,
    paddingBottom: 40,
  },
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
  body: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  statusCard: {
    marginTop: 16,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  statusDetail: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
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
  protocolDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
  },
  protocolStatusTextWrap: {
    flex: 1,
  },
  protocolStatusTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  activeCard: {
    marginTop: 18,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  activeNameWrap: {
    flex: 1,
  },
  activeName: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
  },
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
  channelTypePillPrivate: {
    backgroundColor: colors.warning,
  },
  channelTypeText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: '900',
  },
  messageReadyCard: {
    marginTop: 14,
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageReadyTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 6,
  },
  messageReadyText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  detailGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  detailBox: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
  },
  detailValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  secretBox: {
    marginTop: 12,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secretLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  secretValue: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  sendCard: {
    marginTop: 18,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  modeButton: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 10,
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
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  modeButtonTextActive: {
    color: colors.accent,
  },
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
  messageMetaRow: {
    marginTop: 8,
    gap: 6,
  },
  messageCount: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  messageCountError: {
    color: colors.danger,
  },
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
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
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
  messageBubbleTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
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
  },
  messageFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  messageTime: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  protocolLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
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
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
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
  channelTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  channelNameWrap: {
    flex: 1,
  },
  channelName: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
  },
  channelPurpose: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 5,
    lineHeight: 20,
  },
  channelRightWrap: {
    alignItems: 'flex-end',
  },
  channelIndex: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '900',
  },
  smallTypeText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 5,
  },
  smallTypeTextPrivate: {
    color: colors.warning,
  },
  slotRow: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  slotRowActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceSoft,
  },
  slotText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  slotTextActive: {
    color: colors.textPrimary,
  },
  slotTextDisabled: {
    color: colors.textMuted,
  },
});
