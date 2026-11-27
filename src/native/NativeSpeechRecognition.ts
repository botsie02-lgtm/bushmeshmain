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
  phase?: 'idle' | 'starting' | 'listening' | 'suspended' | 'handover' | 'stopped';
  sessionId?: string | null;
  handoverId?: string | null;
  handoverClaimed?: boolean;
  captureActive?: boolean;
  captureGeneration?: number;
  captureStarts?: number;
  acceptedWakes?: number;
  modelId?: string | null;
  foreground?: boolean;
  permissionGranted?: boolean;
  backgroundCommandSupported?: boolean;
  microphoneOwner?: 'command' | 'hold-to-talk' | 'wake-detector' | null;
  playbackActive?: boolean;
};

export type HandsFreeHandover = {sessionId: string; handoverId: string};

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
  claimHandsFreeHandover?: (sessionId: string, handoverId: string) => Promise<boolean>;
  completeHandsFreeHandover?: (sessionId: string, handoverId: string) => Promise<boolean>;
  recognizeHandsFreeOnce?: (sessionId: string, handoverId: string, localeTag: string | null) => Promise<NativeSpeechRecognitionResult>;
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

  subscribeHandsFreeSession(listener: (status: NativeHandsFreeStatus) => void): () => void {
    if (!this.isSupported() || !module?.claimHandsFreeHandover) {
      return () => undefined;
    }
    const subscription = DeviceEventEmitter.addListener('BushMeshHandsFreeSessionState', listener);
    return () => subscription.remove();
  },

  async claimHandsFreeHandover(key: HandsFreeHandover): Promise<boolean> {
    return this.isSupported() && module?.claimHandsFreeHandover
      ? module.claimHandsFreeHandover(key.sessionId, key.handoverId) : false;
  },

  async completeHandsFreeHandover(key: HandsFreeHandover): Promise<boolean> {
    return this.isSupported() && module?.completeHandsFreeHandover
      ? module.completeHandsFreeHandover(key.sessionId, key.handoverId) : false;
  },

  async recognizeHandsFreeOnce(key: HandsFreeHandover, localeTag = 'en-AU'): Promise<NativeSpeechRecognitionResult> {
    if (!this.isSupported() || !module?.recognizeHandsFreeOnce) {
      throw new Error('Scoped hands-free recognition unavailable.');
    }
    return module.recognizeHandsFreeOnce(key.sessionId, key.handoverId, localeTag);
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
