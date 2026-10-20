import React, {useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  BushMeshChannel,
  BushMeshChannelMessage,
  useBushMesh,
} from '../state/BushMeshContext';
import {colors} from '../theme/colors';

function isPrivateChannel(channel: BushMeshChannel): boolean {
  return (
    channel.secret !== 'Empty / Public' &&
    channel.secret !== 'Unknown' &&
    channel.secret.length > 0
  );
}

function deliveryLabel(message: BushMeshChannelMessage): string {
  if (message.direction === 'received') {
    return 'RECEIVED';
  }

  switch (message.status) {
    case 'pending':
      return 'PENDING';
    case 'accepted':
      return 'RADIO ACCEPTED';
    case 'confirmed':
      return 'PEER CONFIRMED';
    case 'failed':
      return 'FAILED';
  }
}

function deliveryColor(message: BushMeshChannelMessage): string {
  if (message.direction === 'received' || message.status === 'confirmed') {
    return colors.success;
  }
  if (message.status === 'failed') {
    return colors.danger;
  }
  if (message.status === 'accepted') {
    return colors.accent;
  }
  return colors.warning;
}

export function RadioScreen(): React.JSX.Element {
  const {
    connectionStatus,
    connectedDeviceName,
    channels,
    activeChannelIndex,
    activeChannel,
    channelMessages,
    canSendChannelMessage,
    sendChannelMessage,
    addLocalChannelMessage,
    setActiveChannelIndex,
  } = useBushMesh();
  const [messageText, setMessageText] = useState('');
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const visibleChannels = useMemo(
    () =>
      channels.filter(
        channel => channel.channelName && channel.channelName !== 'Empty',
      ),
    [channels],
  );
  const activeHistory = useMemo(
    () =>
      activeChannel
        ? channelMessages.filter(
            message => message.channelIndex === activeChannel.channelIndex,
          )
        : channelMessages,
    [activeChannel, channelMessages],
  );

  const cleanMessage = messageText.trim();
  const canSend =
    activeChannel !== null &&
    canSendChannelMessage &&
    cleanMessage.length > 0 &&
    cleanMessage.length <= 133 &&
    !isSending;

  const handleSend = async () => {
    if (!activeChannel || !canSend) {
      return;
    }

    const channelIndex = Number(activeChannel.channelIndex);
    if (!Number.isInteger(channelIndex)) {
      setSendStatus('Active channel index is invalid.');
      return;
    }

    setIsSending(true);
    setSendStatus(`Submitting to ${activeChannel.channelName}…`);

    try {
      await sendChannelMessage(channelIndex, cleanMessage);
      addLocalChannelMessage({
        channelIndex: activeChannel.channelIndex,
        channelName: activeChannel.channelName,
        text: cleanMessage,
        direction: 'sent',
        status: 'accepted',
      });
      setMessageText('');
      setSendStatus(
        'Accepted by MeshCore for transmission. Peer delivery is not yet confirmed.',
      );
    } catch (error) {
      addLocalChannelMessage({
        channelIndex: activeChannel.channelIndex,
        channelName: activeChannel.channelName,
        text: cleanMessage,
        direction: 'sent',
        status: 'failed',
      });
      setSendStatus(
        error instanceof Error ? error.message : 'Radio submission failed.',
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <View style={styles.heroRow}>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>RADIO</Text>
            <Text style={styles.title}>Convoy comms</Text>
          </View>
          <View
            style={[
              styles.linkPill,
              connectionStatus === 'Connected'
                ? styles.linkReady
                : styles.linkOffline,
            ]}>
            <Text style={styles.linkText}>
              {connectionStatus === 'Connected' ? 'NODE ONLINE' : 'OFFLINE'}
            </Text>
          </View>
        </View>
        <Text style={styles.body}>
          Bushmesh separates radio acceptance from delivery. A message is only
          labelled peer-confirmed after MeshCore reports the matching ACK.
        </Text>
        {connectedDeviceName ? (
          <Text style={styles.nodeText}>Companion: {connectedDeviceName}</Text>
        ) : null}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Active group</Text>
        <Text style={styles.sectionMeta}>{visibleChannels.length} available</Text>
      </View>

      {activeChannel ? (
        <View style={styles.activeCard}>
          <View style={styles.activeRow}>
            <View style={styles.activeCopy}>
              <Text style={styles.activeName}>{activeChannel.channelName}</Text>
              <Text style={styles.activeMeta}>
                Channel #{activeChannel.channelIndex} ·{' '}
                {isPrivateChannel(activeChannel) ? 'PRIVATE' : 'PUBLIC'}
              </Text>
            </View>
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>ACTIVE</Text>
            </View>
          </View>
          <Text style={styles.securityText}>
            Channel key material is hidden from the driver-facing radio screen.
          </Text>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No convoy channel selected</Text>
          <Text style={styles.emptyText}>
            Connect a MeshCore companion node and let Bushmesh load its configured
            channels.
          </Text>
        </View>
      )}

      {visibleChannels.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.channelStrip}>
          {visibleChannels.map(channel => {
            const active = channel.channelIndex === activeChannelIndex;
            return (
              <TouchableOpacity
                key={channel.channelIndex}
                style={[styles.channelChip, active && styles.channelChipActive]}
                onPress={() => setActiveChannelIndex(channel.channelIndex)}>
                <Text
                  style={[
                    styles.channelChipName,
                    active && styles.channelChipNameActive,
                  ]}>
                  {channel.channelName}
                </Text>
                <Text style={styles.channelChipMeta}>#{channel.channelIndex}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={styles.composeCard}>
        <Text style={styles.sectionTitle}>Message</Text>
        <TextInput
          style={styles.input}
          value={messageText}
          onChangeText={setMessageText}
          placeholder={
            activeChannel ? `Message ${activeChannel.channelName}` : 'Select a channel first'
          }
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={133}
          editable={activeChannel !== null}
        />
        <View style={styles.composeMeta}>
          <Text style={styles.characterCount}>{cleanMessage.length}/133</Text>
          <Text style={styles.transportState}>
            {canSendChannelMessage ? 'MESHCORE READY' : 'RADIO NOT READY'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          disabled={!canSend}
          onPress={() => {
            handleSend().catch(() => undefined);
          }}>
          <Text style={styles.sendButtonText}>
            {isSending ? 'SUBMITTING…' : 'SEND OVER LORA'}
          </Text>
        </TouchableOpacity>
        {sendStatus ? <Text style={styles.sendStatus}>{sendStatus}</Text> : null}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Radio history</Text>
        <Text style={styles.sectionMeta}>{activeHistory.length} messages</Text>
      </View>

      {activeHistory.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No stored messages for this channel yet.
          </Text>
        </View>
      ) : (
        activeHistory.map(message => (
          <View key={message.id} style={styles.messageCard}>
            <View style={styles.messageTopRow}>
              <Text style={styles.messageChannel}>
                {message.channelName} #{message.channelIndex}
              </Text>
              <Text
                style={[
                  styles.deliveryState,
                  {color: deliveryColor(message)},
                ]}>
                {deliveryLabel(message)}
              </Text>
            </View>
            <Text style={styles.messageText}>{message.text}</Text>
            <Text style={styles.messageTime}>
              {new Date(message.createdAt).toLocaleString()}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 38},
  heroCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 18,
    marginBottom: 18,
  },
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroCopy: {flex: 1},
  eyebrow: {color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.2},
  title: {color: colors.textPrimary, fontSize: 27, fontWeight: '900', marginTop: 4},
  body: {color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 10},
  nodeText: {color: colors.textMuted, fontSize: 11, marginTop: 9},
  linkPill: {borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6},
  linkReady: {borderColor: colors.success},
  linkOffline: {borderColor: colors.border},
  linkText: {color: colors.textPrimary, fontSize: 9, fontWeight: '900'},
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 9,
  },
  sectionTitle: {color: colors.textPrimary, fontSize: 17, fontWeight: '900'},
  sectionMeta: {color: colors.textMuted, fontSize: 11, fontWeight: '700'},
  activeCard: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 18,
    padding: 15,
    marginBottom: 11,
  },
  activeRow: {flexDirection: 'row', alignItems: 'center', gap: 10},
  activeCopy: {flex: 1},
  activeName: {color: colors.textPrimary, fontSize: 21, fontWeight: '900'},
  activeMeta: {color: colors.textSecondary, fontSize: 11, fontWeight: '700', marginTop: 3},
  activeBadge: {backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5},
  activeBadgeText: {color: colors.background, fontSize: 8, fontWeight: '900'},
  securityText: {color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 10},
  emptyCard: {backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 14},
  emptyTitle: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  emptyText: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 3},
  channelStrip: {gap: 8, paddingBottom: 16},
  channelChip: {
    minWidth: 115,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  channelChipActive: {borderColor: colors.accent, backgroundColor: colors.surfaceSoft},
  channelChipName: {color: colors.textSecondary, fontSize: 12, fontWeight: '800'},
  channelChipNameActive: {color: colors.textPrimary},
  channelChipMeta: {color: colors.textMuted, fontSize: 9, marginTop: 3},
  composeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 15,
    marginBottom: 20,
  },
  input: {
    minHeight: 92,
    marginTop: 10,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    textAlignVertical: 'top',
    fontSize: 15,
  },
  composeMeta: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 7},
  characterCount: {color: colors.textMuted, fontSize: 10, fontWeight: '700'},
  transportState: {color: colors.textMuted, fontSize: 9, fontWeight: '900'},
  sendButton: {
    minHeight: 50,
    marginTop: 12,
    backgroundColor: colors.accent,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {opacity: 0.35},
  sendButtonText: {color: colors.background, fontSize: 13, fontWeight: '900'},
  sendStatus: {color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 9},
  messageCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 9,
  },
  messageTopRow: {flexDirection: 'row', alignItems: 'center', gap: 9},
  messageChannel: {flex: 1, color: colors.textMuted, fontSize: 10, fontWeight: '800'},
  deliveryState: {fontSize: 9, fontWeight: '900'},
  messageText: {color: colors.textPrimary, fontSize: 15, lineHeight: 21, marginTop: 7},
  messageTime: {color: colors.textMuted, fontSize: 9, marginTop: 8},
});
