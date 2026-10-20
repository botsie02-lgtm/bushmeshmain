import {NativeModules, Platform} from 'react-native';

export type NativeBleRuntimeState =
  | 'disconnected'
  | 'disconnecting'
  | 'connecting'
  | 'negotiating-mtu'
  | 'discovering-services'
  | 'enabling-notifications'
  | 'ready'
  | 'reconnecting'
  | 'error'
  | string;

export type NativeBackgroundInboxFrame = {
  receivedAtMs: number;
  frameBase64: string;
};

export type NativeRadioServiceStatus = {
  running: boolean;
  radioRequested?: boolean;
  locationRequested?: boolean;
  deviceLabel: string | null;
  startedAtMs: number;
  ownership: 'react-native-session' | 'native-service' | string;
  nativeBleState?: NativeBleRuntimeState;
  nativeBleDeviceAddress?: string | null;
  nativeBleDeviceLabel?: string | null;
  nativeBleMtu?: number;
  nativeBleReconnectAttempt?: number;
  nativeBleConnectedAtMs?: number;
  nativeBleLastError?: string | null;
  nativeBleQueuedWrites?: number;
  nativeBleBufferedFrames?: number;
  nativeBackgroundInboxCount?: number;
  outboxLeaseOwner?: 'foreground' | 'background' | string;
  outboxLeaseEpoch?: number;
};

type NativeRadioServiceModule = {
  start: (deviceLabel: string | null) => Promise<boolean>;
  startNativeBle: (
    deviceAddress: string,
    deviceLabel: string | null,
  ) => Promise<boolean>;
  stop: () => Promise<boolean>;
  enqueueNativeBleWrite: (base64Frame: string) => Promise<boolean>;
  drainNativeBleFrames: (maxFrames: number) => Promise<string[]>;
  drainBackgroundInbox: (maxFrames: number) => Promise<NativeBackgroundInboxFrame[]>;
  getStatus: () => Promise<NativeRadioServiceStatus>;
};

const module = NativeModules.BushMeshRadioService as
  | NativeRadioServiceModule
  | undefined;

const unsupportedStatus: NativeRadioServiceStatus = {
  running: false,
  radioRequested: false,
  locationRequested: false,
  deviceLabel: null,
  startedAtMs: 0,
  ownership: 'unsupported',
  nativeBleState: 'disconnected',
  nativeBleDeviceAddress: null,
  nativeBleDeviceLabel: null,
  nativeBleMtu: 0,
  nativeBleReconnectAttempt: 0,
  nativeBleConnectedAtMs: 0,
  nativeBleLastError: null,
  nativeBleQueuedWrites: 0,
  nativeBleBufferedFrames: 0,
  nativeBackgroundInboxCount: 0,
  outboxLeaseOwner: 'foreground',
  outboxLeaseEpoch: 0,
};

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

  async startNativeBle(
    deviceAddress: string,
    deviceLabel: string | null,
  ): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }

    const address = deviceAddress.trim();
    if (!address) {
      throw new Error('Native BLE ownership requires a Bluetooth device address.');
    }

    return module.startNativeBle(address, deviceLabel);
  },

  async stop(): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.stop();
  },

  async enqueueNativeBleWrite(base64Frame: string): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    if (!base64Frame) {
      throw new Error('Native BLE writes require a non-empty base64 frame.');
    }
    return module.enqueueNativeBleWrite(base64Frame);
  },

  async drainNativeBleFrames(maxFrames = 32): Promise<string[]> {
    if (!this.isSupported() || !module) {
      return [];
    }
    const boundedMax = Math.max(0, Math.min(128, Math.floor(maxFrames)));
    return module.drainNativeBleFrames(boundedMax);
  },

  async drainBackgroundInbox(maxFrames = 128): Promise<NativeBackgroundInboxFrame[]> {
    if (!this.isSupported() || !module) {
      return [];
    }
    const boundedMax = Math.max(0, Math.min(128, Math.floor(maxFrames)));
    const frames = await module.drainBackgroundInbox(boundedMax);
    return frames.filter(
      frame =>
        Number.isFinite(frame.receivedAtMs) &&
        frame.receivedAtMs >= 0 &&
        typeof frame.frameBase64 === 'string' &&
        frame.frameBase64.length > 0,
    );
  },

  async getStatus(): Promise<NativeRadioServiceStatus> {
    if (!this.isSupported() || !module) {
      return {...unsupportedStatus};
    }
    return module.getStatus();
  },
};
