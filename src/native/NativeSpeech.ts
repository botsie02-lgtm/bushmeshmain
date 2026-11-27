import {NativeModules, Platform} from 'react-native';

export type NativeSpeechStatus = {
  initialized: boolean;
  initializing: boolean;
  failed: boolean;
  languageTag: string | null;
  offlineVoice?: boolean;
  speaking?: boolean;
  criticalAlertsEnabled: boolean;
  radioMessagesEnabled: boolean;
};

type NativeSpeechModule = {
  speak: (text: string, interrupt: boolean) => Promise<boolean>;
  stop: () => Promise<boolean>;
  speakOrdinaryAndWait?: (text: string) => Promise<boolean>;
  stopOrdinary?: () => Promise<boolean>;
  getStatus: () => Promise<NativeSpeechStatus>;
  setCriticalAlertsEnabled: (enabled: boolean) => Promise<boolean>;
  getCriticalAlertsEnabled: () => Promise<boolean>;
  setRadioMessagesEnabled: (enabled: boolean) => Promise<boolean>;
  getRadioMessagesEnabled: () => Promise<boolean>;
};

const module = NativeModules.BushMeshSpeech as NativeSpeechModule | undefined;

const unsupportedStatus: NativeSpeechStatus = {
  initialized: false,
  initializing: false,
  failed: true,
  languageTag: null,
  criticalAlertsEnabled: false,
  radioMessagesEnabled: false,
};

export const nativeSpeech = {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  },

  async speak(text: string, interrupt = true): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }

    const clean = text.trim();
    if (!clean) {
      return false;
    }

    return module.speak(clean, interrupt);
  },

  async speakOrdinaryAndWait(text: string): Promise<boolean> {
    if (!module?.speakOrdinaryAndWait) throw new Error('Offline speech output unavailable.');
    return module.speakOrdinaryAndWait(text);
  },
  async stopOrdinary(): Promise<boolean> {
    return module?.stopOrdinary ? module.stopOrdinary() : false;
  },
  async stop(): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.stop();
  },

  async getStatus(): Promise<NativeSpeechStatus> {
    if (!this.isSupported() || !module) {
      return {...unsupportedStatus};
    }
    return module.getStatus();
  },

  async getCriticalAlertsEnabled(): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.getCriticalAlertsEnabled();
  },

  async setCriticalAlertsEnabled(enabled: boolean): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.setCriticalAlertsEnabled(enabled);
  },

  async getRadioMessagesEnabled(): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.getRadioMessagesEnabled();
  },

  async setRadioMessagesEnabled(enabled: boolean): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.setRadioMessagesEnabled(enabled);
  },
};