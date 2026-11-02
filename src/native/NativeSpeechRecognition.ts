import {NativeModules, Platform} from 'react-native';

export type NativeSpeechRecognitionStatus = {
  supported: boolean;
  listening: boolean;
  apiLevel: number;
  reason: string | null;
};

export type NativeSpeechRecognitionResult = {
  text: string;
  confidence: number;
  durationMs: number;
  alternatives: string[];
};

type NativeSpeechRecognitionModule = {
  getStatus: () => Promise<NativeSpeechRecognitionStatus>;
  recognizeOnce: (
    localeTag: string | null,
  ) => Promise<NativeSpeechRecognitionResult>;
  stopListening: () => Promise<boolean>;
  cancel: () => Promise<boolean>;
};

const module = NativeModules.BushMeshSpeechRecognition as
  | NativeSpeechRecognitionModule
  | undefined;

const unsupportedStatus: NativeSpeechRecognitionStatus = {
  supported: false,
  listening: false,
  apiLevel: 0,
  reason: 'On-device speech recognition is only available in the Android build.',
};

export const nativeSpeechRecognition = {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  },

  async getStatus(): Promise<NativeSpeechRecognitionStatus> {
    if (!this.isSupported() || !module) {
      return {...unsupportedStatus};
    }
    return module.getStatus();
  },

  async recognizeOnce(
    localeTag: string | null = null,
  ): Promise<NativeSpeechRecognitionResult> {
    if (!this.isSupported() || !module) {
      throw new Error('Strict on-device speech recognition is unavailable.');
    }
    return module.recognizeOnce(localeTag);
  },

  async stopListening(): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.stopListening();
  },

  async cancel(): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.cancel();
  },
};
