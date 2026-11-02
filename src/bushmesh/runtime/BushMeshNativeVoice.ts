import {
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

import {
  BushMeshSpeechRecognitionResult,
  BushMeshSpeechRecognizer,
  BushMeshSpeechSynthesizer,
} from './BushMeshVoicePipeline';

type BushMeshVoiceNativeModule = {
  recognizeOnce: () => Promise<BushMeshSpeechRecognitionResult>;
  cancelRecognition?: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  stopSpeaking?: () => Promise<void>;
};

function nativeVoice(): BushMeshVoiceNativeModule | null {
  const module = NativeModules.BushMeshVoice as BushMeshVoiceNativeModule | undefined;
  if (
    !module ||
    typeof module.recognizeOnce !== 'function' ||
    typeof module.speak !== 'function'
  ) {
    return null;
  }
  return module;
}

export function isBushMeshNativeVoiceAvailable(): boolean {
  return nativeVoice() !== null;
}

export async function ensureBushMeshMicrophonePermission(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(permission)) {
    return;
  }

  const result = await PermissionsAndroid.request(permission, {
    title: 'BushMesh voice messaging',
    message:
      'BushMesh uses the microphone only to convert your speech to text on the phone. Audio is not transmitted over LoRa.',
    buttonPositive: 'Allow microphone',
    buttonNegative: 'Cancel',
  });

  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Microphone permission is required for BushMesh speech-to-text.');
  }
}

export function createBushMeshNativeSpeechRecognizer(): BushMeshSpeechRecognizer {
  return {
    recognizeOnce: async () => {
      const module = nativeVoice();
      if (!module) {
        throw new Error('Native BushMesh speech recognition is unavailable on this device.');
      }

      await ensureBushMeshMicrophonePermission();
      const result = await module.recognizeOnce();
      const text = result?.text?.trim();
      if (!text) {
        throw new Error('Speech recognition returned an empty transcript.');
      }

      return {
        text,
        confidence:
          typeof result.confidence === 'number' && Number.isFinite(result.confidence)
            ? result.confidence
            : undefined,
      };
    },
  };
}

export function createBushMeshNativeSpeechSynthesizer(): BushMeshSpeechSynthesizer {
  return {
    speak: async text => {
      const module = nativeVoice();
      if (!module) {
        throw new Error('Native BushMesh text-to-speech is unavailable on this device.');
      }
      await module.speak(text.trim());
    },
    stop: async () => {
      await nativeVoice()?.stopSpeaking?.();
    },
  };
}

export async function cancelBushMeshNativeRecognition(): Promise<void> {
  await nativeVoice()?.cancelRecognition?.();
}
