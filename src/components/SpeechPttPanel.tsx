import React, {useEffect, useRef, useState} from 'react';
import {
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  NativeSpeechRecognitionStatus,
  nativeSpeechRecognition,
} from '../native/NativeSpeechRecognition';
import {useBushMesh} from '../state/BushMeshContext';
import {useSpeech} from '../state/SpeechContext';
import {colors} from '../theme/colors';

type PttPhase =
  | 'checking'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'draft'
  | 'sending'
  | 'unavailable'
  | 'error';

function confidenceLabel(confidence: number | null): string {
  if (confidence === null || confidence < 0) {
    return 'confidence unavailable';
  }
  return `${Math.round(confidence * 100)}% confidence`;
}

export function SpeechPttPanel(): React.JSX.Element | null {
  const {
    activeChannel,
    canSendChannelMessage,
    sendChannelMessage,
    addLocalChannelMessage,
  } = useBushMesh();
  const {languageTag} = useSpeech();
  const [phase, setPhase] = useState<PttPhase>('checking');
  const [status, setStatus] = useState<NativeSpeechRecognitionStatus | null>(null);
  const [draft, setDraft] = useState('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [detail, setDetail] = useState('Checking on-device speech recognition…');
  const heldRef = useRef(false);
  const recognitionActiveRef = useRef(false);

  const bridgeSupported = nativeSpeechRecognition.isSupported();

  useEffect(() => {
    let active = true;

    if (!bridgeSupported) {
      setPhase('unavailable');
      setDetail('On-device PTT speech is only available in the Android build.');
      return () => {
        active = false;
      };
    }

    nativeSpeechRecognition
      .getStatus()
      .then(next => {
        if (!active) {
          return;
        }
        setStatus(next);
        if (next.supported) {
          setPhase('ready');
          setDetail('Hold PTT, speak, then release. Review the draft before sending.');
        } else {
          setPhase('unavailable');
          setDetail(next.reason ?? 'No strict on-device recognizer is installed.');
        }
      })
      .catch(error => {
        if (!active) {
          return;
        }
        setPhase('error');
        setDetail(
          error instanceof Error
            ? error.message
            : 'Could not inspect on-device speech recognition.',
        );
      });

    return () => {
      active = false;
      heldRef.current = false;
      if (recognitionActiveRef.current) {
        nativeSpeechRecognition.cancel().catch(() => undefined);
      }
    };
  }, [bridgeSupported]);

  if (Platform.OS !== 'android') {
    return null;
  }

  const requestMicrophone = async (): Promise<boolean> => {
    const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    const alreadyGranted = await PermissionsAndroid.check(permission);
    if (alreadyGranted) {
      return true;
    }

    const result = await PermissionsAndroid.request(permission, {
      title: 'Bushmesh PTT microphone',
      message:
        'Bushmesh uses the microphone only while PTT is held to create an on-device text draft.',
      buttonPositive: 'Allow microphone',
      buttonNegative: 'Not now',
    });
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const beginPtt = async () => {
    heldRef.current = true;

    if (!status?.supported || recognitionActiveRef.current || phase === 'sending') {
      return;
    }

    try {
      const microphoneAllowed = await requestMicrophone();
      if (!microphoneAllowed) {
        setPhase('error');
        setDetail('Microphone permission is required for hold-to-talk dictation.');
        return;
      }
      if (!heldRef.current) {
        return;
      }

      setDraft('');
      setConfidence(null);
      setPhase('listening');
      setDetail('Listening locally… release PTT when finished.');
      recognitionActiveRef.current = true;

      nativeSpeechRecognition
        .recognizeOnce(languageTag)
        .then(result => {
          recognitionActiveRef.current = false;
          setDraft(result.text);
          setConfidence(result.confidence);
          setPhase('draft');
          setDetail(
            `On-device transcript ready · ${confidenceLabel(result.confidence)} · review before sending.`,
          );
        })
        .catch(error => {
          recognitionActiveRef.current = false;
          const message =
            error instanceof Error ? error.message : 'On-device recognition failed.';
          if (message.toLowerCase().includes('cancel')) {
            setPhase('ready');
            setDetail('PTT cancelled. Hold to try again.');
            return;
          }
          setPhase('error');
          setDetail(message);
        });
    } catch (error) {
      recognitionActiveRef.current = false;
      setPhase('error');
      setDetail(
        error instanceof Error ? error.message : 'Could not start Bushmesh PTT.',
      );
    }
  };

  const endPtt = async () => {
    heldRef.current = false;
    if (!recognitionActiveRef.current) {
      return;
    }

    setPhase('processing');
    setDetail('Finishing local transcription…');
    try {
      await nativeSpeechRecognition.stopListening();
    } catch (error) {
      recognitionActiveRef.current = false;
      setPhase('error');
      setDetail(
        error instanceof Error ? error.message : 'Could not finish PTT transcription.',
      );
    }
  };

  const cancelDraft = async () => {
    heldRef.current = false;
    if (recognitionActiveRef.current) {
      await nativeSpeechRecognition.cancel().catch(() => undefined);
      recognitionActiveRef.current = false;
    }
    setDraft('');
    setConfidence(null);
    setPhase(status?.supported ? 'ready' : 'unavailable');
    setDetail(
      status?.supported
        ? 'Hold PTT, speak, then release. Review the draft before sending.'
        : status?.reason ?? 'On-device speech recognition is unavailable.',
    );
  };

  const cleanDraft = draft.trim();
  const activeChannelIndex = activeChannel ? Number(activeChannel.channelIndex) : NaN;
  const canSendDraft =
    phase !== 'sending' &&
    cleanDraft.length > 0 &&
    cleanDraft.length <= 133 &&
    Number.isInteger(activeChannelIndex) &&
    canSendChannelMessage;

  const sendDraft = async () => {
    if (!activeChannel || !canSendDraft) {
      return;
    }

    setPhase('sending');
    setDetail(`Submitting speech draft to ${activeChannel.channelName}…`);
    try {
      await sendChannelMessage(activeChannelIndex, cleanDraft);
      addLocalChannelMessage({
        channelIndex: activeChannel.channelIndex,
        channelName: activeChannel.channelName,
        text: cleanDraft,
        direction: 'sent',
        status: 'accepted',
      });
      setDraft('');
      setConfidence(null);
      setPhase('ready');
      setDetail(
        'Speech text accepted by MeshCore for transmission. Peer delivery is not yet confirmed.',
      );
    } catch (error) {
      setPhase('draft');
      setDetail(
        error instanceof Error ? error.message : 'Speech message submission failed.',
      );
    }
  };

  const pttEnabled = status?.supported === true && phase !== 'sending';
  const listening = phase === 'listening' || phase === 'processing';

  return (
    <View style={styles.panel}>
      <View style={styles.topRow}>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>SPEECH RADIO</Text>
          <Text style={styles.title}>
            {status?.supported ? 'ON-DEVICE PTT' : 'PTT UNAVAILABLE'}
          </Text>
          <Text style={styles.detail} numberOfLines={3}>
            {detail}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.ptt,
            listening && styles.pttListening,
            !pttEnabled && styles.pttDisabled,
          ]}
          disabled={!pttEnabled}
          onPressIn={() => {
            beginPtt().catch(() => undefined);
          }}
          onPressOut={() => {
            endPtt().catch(() => undefined);
          }}>
          <Text style={styles.pttText}>{listening ? 'LISTENING' : 'HOLD PTT'}</Text>
        </TouchableOpacity>
      </View>

      {draft.length > 0 ? (
        <View style={styles.draftBox}>
          <TextInput
            style={styles.draftInput}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={240}
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.draftMetaRow}>
            <Text
              style={[
                styles.draftMeta,
                cleanDraft.length > 133 && styles.draftTooLong,
              ]}>
              {cleanDraft.length}/133 · {confidenceLabel(confidence)}
            </Text>
            <Text style={styles.draftMeta}>
              {activeChannel ? activeChannel.channelName : 'NO CHANNEL'}
            </Text>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelDraft}>
              <Text style={styles.cancelText}>DISCARD</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendButton, !canSendDraft && styles.sendDisabled]}
              disabled={!canSendDraft}
              onPress={() => {
                sendDraft().catch(() => undefined);
              }}>
              <Text style={styles.sendText}>SEND SPEECH TEXT</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: {flex: 1},
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 3,
  },
  ptt: {
    minWidth: 96,
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  pttListening: {
    backgroundColor: colors.danger,
  },
  pttDisabled: {
    opacity: 0.4,
  },
  pttText: {
    color: colors.background,
    fontSize: 11,
    fontWeight: '900',
  },
  draftBox: {
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginTop: 10,
  },
  draftInput: {
    minHeight: 52,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    textAlignVertical: 'top',
  },
  draftMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 5,
  },
  draftMeta: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
  },
  draftTooLong: {
    color: colors.danger,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  cancelButton: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '900',
  },
  sendButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  sendDisabled: {
    opacity: 0.35,
  },
  sendText: {
    color: colors.background,
    fontSize: 10,
    fontWeight: '900',
  },
});
