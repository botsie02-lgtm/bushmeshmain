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
  phase?: 'idle' | 'starting' | 'listening' | 'finishing';
};

export type NativeHandsFreeStatus = {
  available: boolean;
  active: boolean;
  offlineModelReady: boolean;
  backgroundCaptureSupported: boolean;
  reason: string | null;
};

export type OfflineLanguageInventory = {
  locale: string;
  status: 'installed' | 'pending' | 'download-required' | 'unsupported' | 'unknown';
  reason: string | null;
  installed: string[];
  pending: string[];
  downloadable: string[];
};

export type ModelDownloadProgress = {requestId: string; percent: number};

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
  getLanguageInventory?: (locale: string) => Promise<OfflineLanguageInventory>;
  downloadLanguage?: (locale: string, requestId: string) => Promise<string>;
  stopDownloadObservation?: (requestId: string) => Promise<boolean>;
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
  async getLanguageInventory(locale: string): Promise<OfflineLanguageInventory | null> {
    return this.isSupported() && module?.getLanguageInventory ? module.getLanguageInventory(locale) : null;
  },
  async downloadLanguage(locale: string, requestId: string): Promise<string> {
    return this.isSupported() && module?.downloadLanguage ? module.downloadLanguage(locale, requestId) : 'unavailable';
  },
  async stopDownloadObservation(requestId: string): Promise<boolean> {
    return module?.stopDownloadObservation ? module.stopDownloadObservation(requestId) : false;
  },
  subscribeModelProgress(listener: (value: ModelDownloadProgress) => void): () => void {
    const subscription = DeviceEventEmitter.addListener('BushMeshSpeechModelProgress', listener);
    return () => subscription.remove();
  },
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

  /** Metadata-only finite recognition transitions; no transcripts or wake events. */
  subscribeSessionState(listener: (status: NativeSpeechRecognitionStatus) => void): () => void {
    if (!this.supportsHeldRecognition()) {
      return () => undefined;
    }
    const subscription = DeviceEventEmitter.addListener('BushMeshSpeechSessionState', listener);
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
