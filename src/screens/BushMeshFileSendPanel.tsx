import {Buffer} from 'buffer';
import React, {useMemo, useState} from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {BushMeshFileContentType} from '../bushmesh/protocol';
import {useBushMesh} from '../state/BushMeshContext';
import {colors} from '../theme/colors';
import {BushMeshPacketWorkbench} from './BushMeshPacketWorkbench';

const MAX_TEXT_FILE_BYTES = 4 * 1024;
const FILE_CHUNK_BYTES = 32;

export function BushMeshFileSendPanel(): React.JSX.Element {
  const {
    activeChannel,
    canSendBushMeshFile,
    sendBushMeshFile,
    addLocalChannelMessage,
  } = useBushMesh();
  const [fileName, setFileName] = useState('bushmesh-note.txt');
  const [text, setText] = useState('');
  const [status, setStatus] = useState(
    'Small text files are broadcast on the active BushMesh channel and use selective ACK/resume handling.',
  );
  const [sending, setSending] = useState(false);

  const payloadBytes = useMemo(() => Array.from(Buffer.from(text, 'utf8')), [text]);
  const fileNameBytes = useMemo(
    () => Buffer.byteLength(fileName.trim(), 'utf8'),
    [fileName],
  );
  const payloadTooLarge = payloadBytes.length > MAX_TEXT_FILE_BYTES;
  const fileNameInvalid = fileNameBytes < 1 || fileNameBytes > 120;
  const channelIndex = activeChannel ? Number(activeChannel.channelIndex) : NaN;
  const canSend =
    canSendBushMeshFile &&
    Number.isInteger(channelIndex) &&
    payloadBytes.length > 0 &&
    !payloadTooLarge &&
    !fileNameInvalid &&
    !sending;

  const sendFile = async () => {
    if (!canSend || !activeChannel || !Number.isInteger(channelIndex)) {
      return;
    }

    try {
      setSending(true);
      setStatus(`Starting ${fileName.trim()} on ${activeChannel.channelName}...`);
      const transferId = await sendBushMeshFile(channelIndex, payloadBytes, {
        fileName: fileName.trim(),
        contentType: BushMeshFileContentType.Text,
        chunkSize: FILE_CHUNK_BYTES,
        initialChunkFrames: 8,
      });

      addLocalChannelMessage({
        channelIndex: activeChannel.channelIndex,
        channelName: activeChannel.channelName,
        text: `File transfer ${transferId}: ${fileName.trim()} (${payloadBytes.length} bytes)`,
        direction: 'sent',
        status: 'sent',
        protocol: 'bushmesh',
      });
      setStatus(
        `Transfer ${transferId} started. BushMesh will advance through 8-chunk windows as receiver ACKs arrive.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Failed to start BushMesh file transfer.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.title}>Send Small Text File</Text>
        <Text style={styles.body}>
          This is intentionally limited to {MAX_TEXT_FILE_BYTES / 1024} KB until
          real-radio airtime and reliability measurements are available.
        </Text>

        <Text style={styles.label}>File name</Text>
        <TextInput
          style={styles.input}
          value={fileName}
          onChangeText={setFileName}
          maxLength={120}
          placeholder="bushmesh-note.txt"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
        />

        <Text style={styles.label}>Contents</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={text}
          onChangeText={setText}
          multiline
          textAlignVertical="top"
          placeholder="Type text to transfer over BushMesh"
          placeholderTextColor={colors.textMuted}
        />

        <View style={styles.metaRow}>
          <Text style={[styles.meta, payloadTooLarge && styles.errorText]}>
            {payloadBytes.length}/{MAX_TEXT_FILE_BYTES} bytes
          </Text>
          <Text style={[styles.meta, fileNameInvalid && styles.errorText]}>
            Name {fileNameBytes}/120 bytes
          </Text>
        </View>

        <Text style={styles.status}>{status}</Text>

        <TouchableOpacity
          style={[styles.sendButton, !canSend && styles.buttonDisabled]}
          disabled={!canSend}
          onPress={sendFile}>
          <Text style={styles.sendButtonText}>
            {sending
              ? 'Starting transfer...'
              : activeChannel
                ? `Send on ${activeChannel.channelName}`
                : 'Select an active channel'}
          </Text>
        </TouchableOpacity>
      </View>

      <BushMeshPacketWorkbench />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
  body: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 5,
  },
  input: {
    backgroundColor: colors.background,
    color: colors.textPrimary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 13,
  },
  textArea: {
    minHeight: 110,
  },
  metaRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 10,
  },
  errorText: {
    color: colors.danger,
  },
  status: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 10,
  },
  sendButton: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sendButtonText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: '900',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
});
