import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';

export type NativeSpeechRecognitionStatus = {
  supported: boolean;
  listening: boolean;
  apiLevel: number;
  reason: string | null;
  foreground?: boolean;
  permissionGranted?: boolean;
  microphoneOwner?: 'command' | 'hold-to-talk' | 'wake-detector' | null;
  playbackActive?: boolean;
  lastFailure?: string | null;
};

export type NativeHandsFreeStatus = {
  available: boolean;
  active: boolean;
  offlineModelReady: boolean;
  backgroundCaptureSupported: boolean;
  reason: string | null;
};

export type HeldSpeechPartial = {requestId: string; text: string};

export type NativeSpeechRecognitionResult = {
  text: string;
  confidence: number;
  durationMs: number;
  alternatives: string[];
};

type NativeSpeechRecognitionModule = {
  getStatus: () => Promise<NativeSpeechRecognitionStatus>;
  checkLanguage?: (locale:string)=>Promise<'installed'|'download-required'|'unknown'>;
  recognizeOnce: (
    localeTag: string | null,
  ) => Promise<NativeSpeechRecognitionResult>;
  recognizeHeld?: (localeTag: string | null, requestId: string) => Promise<NativeSpeechRecognitionResult>;
  finishHeld?: (requestId: string, cancel: boolean) => Promise<boolean>;
  getHandsFreeStatus?: () => Promise<NativeHandsFreeStatus>;
  activateHandsFree?: () => Promise<NativeHandsFreeStatus>;
  deactivateHandsFree?: () => Promise<boolean>;
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

  async checkLanguage(locale:string){return module?.checkLanguage?module.checkLanguage(locale):'unknown' as const;},
  async recognizeOnce(
    localeTag: string | null = null,
  ): Promise<NativeSpeechRecognitionResult> {
    if (!this.isSupported() || !module) {
      throw new Error('Strict on-device speech recognition is unavailable.');
    }
    return module.recognizeOnce(localeTag);
  },

  supportsHeldRecognition(): boolean {
    return this.isSupported() && !!module?.recognizeHeld && !!module?.finishHeld;
  },

  async recognizeHeld(localeTag: string | null, requestId: string): Promise<NativeSpeechRecognitionResult> {
    if (!this.supportsHeldRecognition() || !module?.recognizeHeld) {
      throw new Error('Scoped on-device held recognition is unavailable.');
    }
    return module.recognizeHeld(localeTag, requestId);
  },

  async finishHeld(requestId: string, cancel: boolean): Promise<boolean> {
    return this.supportsHeldRecognition() && module?.finishHeld
      ? module.finishHeld(requestId, cancel) : false;
  },

  subscribeHeldPartial(listener: (value: HeldSpeechPartial) => void): () => void {
    if (!this.supportsHeldRecognition()) {
      return () => undefined;
    }
    const subscription = DeviceEventEmitter.addListener('BushMeshHeldSpeechPartial', listener);
    return () => subscription.remove();
  },

  async getHandsFreeStatus(): Promise<NativeHandsFreeStatus> {
    if (this.isSupported() && module?.getHandsFreeStatus) {
      return module.getHandsFreeStatus();
    }
    return {
      available: false, active: false, offlineModelReady: false,
      backgroundCaptureSupported: false, reason: 'native-session-unavailable',
    };
  },

  async activateHandsFree(): Promise<NativeHandsFreeStatus> {
    if (!this.isSupported() || !module?.activateHandsFree) {
      throw new Error('Offline wake detection is unavailable.');
    }
    return module.activateHandsFree();
  },

  async deactivateHandsFree(): Promise<boolean> {
    return this.isSupported() && module?.deactivateHandsFree
      ? module.deactivateHandsFree() : false;
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
