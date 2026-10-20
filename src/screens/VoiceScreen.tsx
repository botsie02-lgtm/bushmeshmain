import React, {useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  BushMeshVoicePipeline,
  createBushMeshNativeSpeechRecognizer,
  createBushMeshNativeSpeechSynthesizer,
  isBushMeshNativeVoiceAvailable,
} from '../bushmesh/runtime';
import {useBushMesh} from '../state/BushMeshContext';
import {colors} from '../theme/colors';

function profileLabel(profile: number): string {
  switch (profile) {
    case 0:
      return 'Raw UTF-8';
    case 1:
      return 'Dictionary';
    case 7:
      return 'Semantic';
    default:
      return `Profile ${profile}`;
  }
}

export function VoiceScreen(): React.JSX.Element {
  const {
    connectionStatus,
    activeChannel,
    canSendBushMeshMessage,
    sendBushMeshMessage,
    addLocalChannelMessage,
    channelMessages,
  } = useBushMesh();
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastEncoding, setLastEncoding] = useState('No voice message captured yet.');
  const [status, setStatus] = useState(
    isBushMeshNativeVoiceAvailable()
      ? 'Ready for local speech-to-text.'
      : 'Native speech services are unavailable on this platform/build.',
  );

  const pipeline = useMemo(
    () =>
      new BushMeshVoicePipeline(
        createBushMeshNativeSpeechRecognizer(),
        createBushMeshNativeSpeechSynthesizer(),
        {
          sendText: async (channelIndex, text) =>
            sendBushMeshMessage(channelIndex, text),
        },
      ),
    [sendBushMeshMessage],
  );

  const channelIndex = activeChannel ? Number(activeChannel.channelIndex) : NaN;
  const canCapture =
    isBushMeshNativeVoiceAvailable() &&
    connectionStatus === 'Connected' &&
    canSendBushMeshMessage &&
    Number.isInteger(channelIndex) &&
    channelIndex >= 0 &&
    channelIndex <= 255 &&
    !listening;

  const captureAndSend = async () => {
    if (!canCapture || !activeChannel) {
      setStatus('Connect a device and select an active channel first.');
      return;
    }

    try {
      setListening(true);
      setStatus('Listening locally… speak one short message.');
      const result = await pipeline.captureAndSend(channelIndex);
      const preview = result.preview;
      setLastTranscript(result.recognition.text);
      setLastEncoding(
        `${profileLabel(preview.suggestedProfile)} • ${preview.rawBytes} → ${preview.encodedPayloadBytes} payload bytes${
          preview.semantic ? ' • semantic intent' : ''
        }`,
      );

      addLocalChannelMessage({
        channelIndex: activeChannel.channelIndex,
        channelName: activeChannel.channelName,
        text: result.recognition.text,
        direction: 'sent',
        status: 'sent',
        protocol: 'bushmesh',
      });
      setStatus('Voice converted to text and sent over BushMesh. No voice audio was transmitted.');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Voice message failed.',
      );
    } finally {
      setListening(false);
    }
  };

  const speakLatestReceived = async () => {
    const latest = channelMessages.find(message => message.direction === 'received');
    if (!latest) {
      setStatus('No received channel message is available to speak.');
      return;
    }

    try {
      setSpeaking(true);
      await pipeline.speakReceived(latest.text, {
        senderLabel: latest.channelName || 'BushMesh',
      });
      setStatus('Speaking the latest received message locally.');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Text-to-speech failed.',
      );
    } finally {
      setSpeaking(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Voice</Text>
        <Text style={styles.title}>Semantic Voice Messaging</Text>
        <Text style={styles.body}>
          Your phone converts speech to text locally, BushMesh compresses the
          text for LoRa, and the receiving phone can speak the decoded message.
          Voice audio itself is never sent over LoRa.
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Active path</Text>
        <Text style={styles.detailText}>
          Device: {connectionStatus} • Channel:{' '}
          {activeChannel
            ? `${activeChannel.channelName} #${activeChannel.channelIndex}`
            : 'None'}
        </Text>
        <Text style={styles.detailText}>
          Native speech: {isBushMeshNativeVoiceAvailable() ? 'Available' : 'Unavailable'}
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Push to message</Text>
        <Text style={styles.sectionBody}>
          Tap once, speak a short message, and the local recognizer returns a
          transcript. Known phrases can collapse into a few semantic bytes;
          everything else falls back to dictionary or raw text.
        </Text>

        <TouchableOpacity
          style={[styles.voiceButton, !canCapture && styles.disabled]}
          disabled={!canCapture}
          onPress={captureAndSend}>
          <Text style={styles.voiceButtonText}>
            {listening ? 'Listening…' : 'Speak & Send'}
          </Text>
        </TouchableOpacity>

        <View style={styles.transcriptCard}>
          <Text style={styles.fieldLabel}>Last transcript</Text>
          <Text style={styles.transcriptText}>
            {lastTranscript || 'Nothing captured yet.'}
          </Text>
          <Text style={styles.fieldLabel}>Encoding</Text>
          <Text style={styles.encodingText}>{lastEncoding}</Text>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.sectionTitle}>Receive speech</Text>
            <Text style={styles.sectionBody}>
              Text-to-speech happens on this phone after BushMesh decodes the
              received text.
            </Text>
          </View>
          <Switch value={autoSpeak} onValueChange={setAutoSpeak} />
        </View>

        <Text style={styles.noteText}>
          Auto-speak preference is prepared here but remains manual until the
          receive lifecycle has foreground/background audio controls.
        </Text>

        <TouchableOpacity
          style={[styles.secondaryButton, speaking && styles.disabled]}
          disabled={speaking}
          onPress={speakLatestReceived}>
          <Text style={styles.secondaryButtonText}>
            {speaking ? 'Speaking…' : 'Speak Latest Received'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Voice status</Text>
        <Text style={styles.statusText}>{status}</Text>
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
  sectionBody: {color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6},
  detailText: {color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 6},
  voiceButton: {
    marginTop: 16,
    backgroundColor: colors.accent,
    borderRadius: 999,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceButtonText: {color: colors.background, fontSize: 18, fontWeight: '900'},
  disabled: {opacity: 0.4},
  transcriptCard: {
    marginTop: 14,
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  fieldLabel: {color: colors.textMuted, fontSize: 11, fontWeight: '900', marginTop: 6},
  transcriptText: {color: colors.textPrimary, fontSize: 15, lineHeight: 21, marginTop: 5},
  encodingText: {color: colors.accent, fontSize: 12, lineHeight: 18, marginTop: 5},
  rowBetween: {flexDirection: 'row', alignItems: 'center', gap: 12},
  flexOne: {flex: 1},
  noteText: {color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 10},
  secondaryButton: {
    marginTop: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {color: colors.accent, fontSize: 13, fontWeight: '900'},
  statusCard: {
    marginTop: 16,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusTitle: {color: colors.textPrimary, fontSize: 13, fontWeight: '900'},
  statusText: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 5},
});
