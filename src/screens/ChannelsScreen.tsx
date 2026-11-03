import React, {useState} from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {BushMeshChannel, useBushMesh} from '../state/BushMeshContext';
import {useRadioConnection} from '../state/RadioConnectionContext';
import {colors} from '../theme/colors';

function isPrivateChannel(channel: BushMeshChannel): boolean {
  return channel.secret === 'Configured (redacted)';
}

function optionalSlot(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const slot = Number(trimmed);
  if (!Number.isInteger(slot) || slot < 0) {
    throw new Error('Channel slot must be a non-negative whole number.');
  }
  return slot;
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
    sendChannelMessage,
    addLocalChannelMessage,
    setActiveChannelIndex,
  } = useBushMesh();
  const {
    snapshot,
    refreshChannels,
    createPrivateChannel,
    joinPrivateChannel,
    clearChannel,
    revealChannelSecret,
  } = useRadioConnection();

  const [messageText, setMessageText] = useState('Test from BushMesh');
  const [sendStatus, setSendStatus] = useState('No channel message sent yet.');
  const [isSending, setIsSending] = useState(false);
  const [createName, setCreateName] = useState('BushMesh Convoy');
  const [createSlot, setCreateSlot] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinSecret, setJoinSecret] = useState('');
  const [joinSlot, setJoinSlot] = useState('');
  const [managementStatus, setManagementStatus] = useState(
    'No channel configuration change made yet.',
  );
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revealedSlot, setRevealedSlot] = useState<number | null>(null);

  const canManage = connectionStatus === 'Connected' && !snapshot.isWriting;

  const sendActiveChannelMessage = async () => {
    if (!activeChannel) {
      setSendStatus('No active channel selected.');
      return;
    }
    const channelIndex = Number(activeChannel.channelIndex);
    if (!Number.isInteger(channelIndex)) {
      setSendStatus('Active channel index is invalid.');
      return;
    }
    const clean = messageText.trim();
    if (!clean || clean.length > 133) return;

    try {
      setIsSending(true);
      await sendChannelMessage(channelIndex, clean);
      addLocalChannelMessage({
        channelIndex: activeChannel.channelIndex,
        channelName: activeChannel.channelName,
        text: clean,
        direction: 'sent',
        status: 'sent',
      });
      setSendStatus(`Sent to ${activeChannel.channelName}.`);
      setMessageText('');
    } catch (error) {
      setSendStatus(
        error instanceof Error ? error.message : 'Failed to send message.',
      );
    } finally {
      setIsSending(false);
    }
  };

  const createChannel = async () => {
    try {
      setRevealedSecret(null);
      const result = await createPrivateChannel({
        channelName: createName,
        channelIndex: optionalSlot(createSlot),
      });
      setActiveChannelIndex(String(result.channelIndex));
      setManagementStatus(
        `Created and verified “${result.channelName}” in slot ${result.channelIndex}. Secret remains hidden until Reveal is pressed.`,
      );
      setRevealedSlot(result.channelIndex);
    } catch (error) {
      setManagementStatus(
        error instanceof Error ? error.message : 'Channel creation failed.',
      );
    }
  };

  const joinChannel = async () => {
    try {
      setRevealedSecret(null);
      const result = await joinPrivateChannel({
        channelName: joinName,
        secretHex: joinSecret,
        channelIndex: optionalSlot(joinSlot),
      });
      setActiveChannelIndex(String(result.channelIndex));
      setManagementStatus(
        `Joined and verified “${result.channelName}” in slot ${result.channelIndex}.`,
      );
      setJoinSecret('');
    } catch (error) {
      setManagementStatus(
        error instanceof Error ? error.message : 'Channel join failed.',
      );
    }
  };

  const reveal = async (channelIndex: number) => {
    try {
      const secret = await revealChannelSecret(channelIndex);
      setRevealedSlot(channelIndex);
      setRevealedSecret(secret);
      setManagementStatus(
        'Sensitive carrier secret revealed deliberately. Long-press the value to copy it; hide it again when finished.',
      );
    } catch (error) {
      setManagementStatus(
        error instanceof Error ? error.message : 'Secret reveal failed.',
      );
    }
  };

  const confirmClear = (channelIndex: number, channelName: string) => {
    Alert.alert(
      'Clear channel?',
      `This will erase “${channelName}” from MeshCore slot ${channelIndex}.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearChannel(channelIndex)
              .then(() => {
                setRevealedSecret(null);
                setManagementStatus(
                  `Channel slot ${channelIndex} cleared and verified.`,
                );
              })
              .catch(error =>
                setManagementStatus(
                  error instanceof Error ? error.message : 'Channel clear failed.',
                ),
              );
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.eyebrow}>NODE / CHANNEL MANAGEMENT</Text>
        <Text style={styles.title}>MeshCore Channels</Text>
        <Text style={styles.body}>
          BushMesh reads the node-advertised channel capacity. Private-channel
          secrets are carrier configuration, not Security v1 group keys, and are
          hidden from normal diagnostics.
        </Text>
        <Text style={styles.meta}>
          {connectedDeviceName
            ? `Node: ${connectedDeviceName}`
            : 'No node connected'}{' '}
          · {channels.length} slot(s) loaded
        </Text>
        <TouchableOpacity
          style={[styles.secondaryButton, !canManage && styles.disabled]}
          disabled={!canManage}
          onPress={() => refreshChannels().catch(() => undefined)}>
          <Text style={styles.secondaryButtonText}>Refresh channel slots</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Create private channel</Text>
        <Text style={styles.body}>
          Leave slot blank to use the first empty slot. BushMesh generates a
          cryptographically random 16-byte secret and only succeeds after read-back
          verification.
        </Text>
        <TextInput
          style={styles.input}
          value={createName}
          onChangeText={setCreateName}
          placeholder="Channel name"
          placeholderTextColor={colors.textMuted}
        />
        <TextInput
          style={styles.input}
          value={createSlot}
          onChangeText={setCreateSlot}
          placeholder="Optional slot number"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
        />
        <TouchableOpacity
          style={[styles.primaryButton, !canManage && styles.disabled]}
          disabled={!canManage}
          onPress={createChannel}>
          <Text style={styles.primaryButtonText}>Create and verify</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Join private channel</Text>
        <Text style={styles.body}>
          Enter the existing channel name and exact 16-byte secret (32 hex characters).
        </Text>
        <TextInput
          style={styles.input}
          value={joinName}
          onChangeText={setJoinName}
          placeholder="Channel name"
          placeholderTextColor={colors.textMuted}
        />
        <TextInput
          style={styles.input}
          value={joinSecret}
          onChangeText={setJoinSecret}
          placeholder="32-character secret hex"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          value={joinSlot}
          onChangeText={setJoinSlot}
          placeholder="Optional slot number"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
        />
        <TouchableOpacity
          style={[styles.primaryButton, !canManage && styles.disabled]}
          disabled={!canManage}
          onPress={joinChannel}>
          <Text style={styles.primaryButtonText}>Join and verify</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statusBox}>
        <Text style={styles.statusText}>{managementStatus}</Text>
        {revealedSecret && revealedSlot !== null ? (
          <View style={styles.secretBox}>
            <Text style={styles.secretLabel}>SENSITIVE · SLOT {revealedSlot}</Text>
            <Text selectable style={styles.secretValue}>
              {revealedSecret}
            </Text>
            <TouchableOpacity onPress={() => setRevealedSecret(null)}>
              <Text style={styles.hideText}>Hide secret</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Channel slots</Text>
        {channels.length === 0 ? (
          <Text style={styles.body}>No channel slots loaded yet.</Text>
        ) : null}
        {channels.map(channel => {
          const index = Number(channel.channelIndex);
          const empty = channel.channelName === 'Empty';
          const active = channel.channelIndex === activeChannelIndex;
          return (
            <View
              key={channel.channelIndex}
              style={[styles.channelRow, active && styles.activeRow]}>
              <TouchableOpacity
                style={styles.channelCopy}
                disabled={empty}
                onPress={() => setActiveChannelIndex(channel.channelIndex)}>
                <Text style={styles.channelName}>
                  #{channel.channelIndex} · {channel.channelName}
                </Text>
                <Text style={styles.channelMeta}>
                  {empty
                    ? 'Empty slot'
                    : `${isPrivateChannel(channel) ? 'Private' : 'Public'}${
                        active ? ' · ACTIVE BUSHMESH CARRIER' : ' · tap to activate'
                      }`}
                </Text>
              </TouchableOpacity>
              {!empty ? (
                <View style={styles.rowActions}>
                  <TouchableOpacity disabled={!canManage} onPress={() => reveal(index)}>
                    <Text style={styles.actionText}>Reveal</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={!canManage}
                    onPress={() => confirmClear(index, channel.channelName)}>
                    <Text style={styles.dangerText}>Clear</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Send test message</Text>
        <Text style={styles.body}>
          {activeChannel
            ? `Active carrier: ${activeChannel.channelName} (#${activeChannel.channelIndex})`
            : 'Select a configured channel first.'}
        </Text>
        <TextInput
          style={[styles.input, styles.messageInput]}
          value={messageText}
          onChangeText={setMessageText}
          placeholder="Short channel message"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={133}
        />
        <TouchableOpacity
          style={[
            styles.primaryButton,
            (!activeChannel ||
              !canSendChannelMessage ||
              isSending ||
              !messageText.trim()) &&
              styles.disabled,
          ]}
          disabled={
            !activeChannel ||
            !canSendChannelMessage ||
            isSending ||
            !messageText.trim()
          }
          onPress={sendActiveChannelMessage}>
          <Text style={styles.primaryButtonText}>
            {isSending ? 'Sending…' : 'Send to active channel'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.meta}>{sendStatus}</Text>
      </View>

      {channelMessages.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Channel messages</Text>
          {channelMessages.map(message => (
            <View key={message.id} style={styles.messageBubble}>
              <Text style={styles.channelMeta}>
                {message.channelName} #{message.channelIndex} · {message.direction}
              </Text>
              <Text style={styles.messageText}>{message.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 40, gap: 12},
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    marginTop: 4,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 8,
  },
  body: {color: colors.textSecondary, fontSize: 13, lineHeight: 20},
  meta: {color: colors.textMuted, fontSize: 11, marginTop: 9},
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 10,
  },
  messageInput: {minHeight: 70, textAlignVertical: 'top'},
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 13,
    alignItems: 'center',
    paddingVertical: 13,
    marginTop: 12,
  },
  primaryButtonText: {color: colors.background, fontWeight: '900'},
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 13,
    alignItems: 'center',
    paddingVertical: 11,
    marginTop: 12,
  },
  secondaryButtonText: {color: colors.accent, fontWeight: '900'},
  disabled: {opacity: 0.45},
  statusBox: {backgroundColor: colors.surfaceSoft, borderRadius: 16, padding: 14},
  statusText: {color: colors.textSecondary, fontSize: 12, lineHeight: 18},
  secretBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 12,
    padding: 12,
  },
  secretLabel: {color: colors.warning, fontSize: 10, fontWeight: '900'},
  secretValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 6,
  },
  hideText: {color: colors.accent, fontWeight: '900', marginTop: 10},
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 12,
  },
  activeRow: {backgroundColor: colors.surfaceSoft},
  channelCopy: {flex: 1},
  channelName: {color: colors.textPrimary, fontSize: 14, fontWeight: '900'},
  channelMeta: {color: colors.textMuted, fontSize: 10, marginTop: 3},
  rowActions: {alignItems: 'flex-end', gap: 8, marginLeft: 8},
  actionText: {color: colors.accent, fontWeight: '900', fontSize: 11},
  dangerText: {color: colors.danger, fontWeight: '900', fontSize: 11},
  messageBubble: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 11,
    marginTop: 8,
  },
  messageText: {color: colors.textPrimary, fontSize: 14, marginTop: 4},
});
