import {NativeModules, Platform} from 'react-native';

export type NativeRadioServiceStatus = {
  running: boolean;
  radioRequested: boolean;
  locationRequested: boolean;
  deviceLabel: string | null;
  startedAtMs: number;
  ownership: 'react-native-session' | string;
};

type NativeRadioServiceModule = {
  start: (deviceLabel: string | null) => Promise<boolean>;
  stop: () => Promise<boolean>;
  getStatus: () => Promise<NativeRadioServiceStatus>;
};

const module = NativeModules.BushMeshRadioService as
  | NativeRadioServiceModule
  | undefined;

export const nativeRadioService = {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  },

  async start(deviceLabel: string | null): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.start(deviceLabel);
  },

  async stop(): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.stop();
  },

  async getStatus(): Promise<NativeRadioServiceStatus> {
    if (!this.isSupported() || !module) {
      return {
        running: false,
        radioRequested: false,
        locationRequested: false,
        deviceLabel: null,
        startedAtMs: 0,
        ownership: 'unsupported',
      };
    }
    return module.getStatus();
  },
};
