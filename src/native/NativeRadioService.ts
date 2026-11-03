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

export type NativeBackgroundChannelInboxFrame = NativeBackgroundInboxFrame & {
  id: string;
};

export type NativeRadioServiceStatus = {
  running: boolean;
  radioRequested?: boolean;
  locationRequested?: boolean;
  deviceLabel: string | null;
  deviceAddress?: string | null;
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
  nativeBackgroundChannelInboxCount?: number;
  persistedNativeTargetPresent?: boolean;
  outboxLeaseOwner?: 'foreground' | 'background' | string;
  outboxLeaseEpoch?: number;
};

export type NativeRadioShutdownWaitOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  getStatus?: () => Promise<NativeRadioServiceStatus>;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
};

type NativeRadioServiceModule = {
  start: (deviceLabel: string | null) => Promise<boolean>;
  startNativeBle: (
    deviceAddress: string,
    deviceLabel: string | null,
  ) => Promise<boolean>;
  stop: () => Promise<boolean>;
  secureRandomBytes: (length: number) => Promise<number[]>;
  enqueueNativeBleWrite: (base64Frame: string) => Promise<boolean>;
  drainNativeBleFrames: (maxFrames: number) => Promise<string[]>;
  drainBackgroundInbox: (maxFrames: number) => Promise<NativeBackgroundInboxFrame[]>;
  listBackgroundChannelInbox: (
    maxFrames: number,
  ) => Promise<NativeBackgroundChannelInboxFrame[]>;
  acknowledgeBackgroundChannelInboxJson: (idsJson: string) => Promise<number>;
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
  deviceAddress: null,
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
  nativeBackgroundChannelInboxCount: 0,
  persistedNativeTargetPresent: false,
  outboxLeaseOwner: 'foreground',
  outboxLeaseEpoch: 0,
};

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 6_000;
const DEFAULT_SHUTDOWN_POLL_INTERVAL_MS = 100;

function validBackgroundFrames(
  frames: NativeBackgroundInboxFrame[],
): NativeBackgroundInboxFrame[] {
  return frames.filter(
    frame =>
      Number.isFinite(frame.receivedAtMs) &&
      frame.receivedAtMs >= 0 &&
      typeof frame.frameBase64 === 'string' &&
      frame.frameBase64.length > 0,
  );
}

function validChannelInboxFrames(
  frames: NativeBackgroundChannelInboxFrame[],
): NativeBackgroundChannelInboxFrame[] {
  return frames.filter(
    frame =>
      /^[0-9a-f]{64}$/i.test(frame.id) &&
      Number.isFinite(frame.receivedAtMs) &&
      frame.receivedAtMs >= 0 &&
      typeof frame.frameBase64 === 'string' &&
      frame.frameBase64.length > 0,
  );
}

export function isNativeRadioShutdownConfirmed(
  status: NativeRadioServiceStatus,
): boolean {
  return (
    status.radioRequested === false &&
    status.ownership !== 'native-service' &&
    !status.deviceAddress &&
    !status.deviceLabel &&
    status.nativeBleState === 'disconnected' &&
    !status.nativeBleDeviceAddress &&
    !status.nativeBleDeviceLabel &&
    status.persistedNativeTargetPresent === false
  );
}

function shutdownStatusSummary(status: NativeRadioServiceStatus): string {
  return [
    `radioRequested=${String(status.radioRequested)}`,
    `ownership=${status.ownership}`,
    `serviceTarget=${status.deviceAddress ?? status.deviceLabel ?? 'none'}`,
    `nativeBleState=${status.nativeBleState ?? 'unknown'}`,
    `nativeTarget=${status.nativeBleDeviceAddress ?? status.nativeBleDeviceLabel ?? 'none'}`,
    `persistedTarget=${String(status.persistedNativeTargetPresent)}`,
  ].join(', ');
}

export async function waitForNativeRadioShutdown(
  options: NativeRadioShutdownWaitOptions = {},
): Promise<NativeRadioServiceStatus> {
  const timeoutMs = Math.max(
    1,
    Math.floor(options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS),
  );
  const pollIntervalMs = Math.max(
    1,
    Math.floor(options.pollIntervalMs ?? DEFAULT_SHUTDOWN_POLL_INTERVAL_MS),
  );
  const getStatus = options.getStatus ?? (() => nativeRadioService.getStatus());
  const now = options.now ?? Date.now;
  const delay =
    options.delay ??
    ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  let lastStatus = await getStatus();

  while (!isNativeRadioShutdownConfirmed(lastStatus)) {
    if (now() >= deadline) {
      throw new Error(
        `Android native radio did not confirm shutdown within ${timeoutMs}ms (${shutdownStatusSummary(
          lastStatus,
        )}).`,
      );
    }
    await delay(pollIntervalMs);
    lastStatus = await getStatus();
  }

  return lastStatus;
}

export const nativeRadioService = {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  },

  async start(deviceLabel: string | null): Promise<boolean> {
    if (!this.isSupported() || !module) return false;
    return module.start(deviceLabel);
  },

  async startNativeBle(
    deviceAddress: string,
    deviceLabel: string | null,
  ): Promise<boolean> {
    if (!this.isSupported() || !module) return false;

    const address = deviceAddress.trim();
    if (!address) {
      throw new Error('Native BLE ownership requires a Bluetooth device address.');
    }

    return module.startNativeBle(address, deviceLabel);
  },

  async stop(): Promise<boolean> {
    if (!this.isSupported() || !module) return false;
    return module.stop();
  },

  async secureRandomBytes(length: number): Promise<Uint8Array> {
    const count = Math.floor(length);
    if (count < 1 || count > 64) {
      throw new Error('Secure random request must be between 1 and 64 bytes.');
    }

    const cryptoProvider = globalThis.crypto as
      | {getRandomValues?: (array: Uint8Array) => Uint8Array}
      | undefined;
    if (typeof cryptoProvider?.getRandomValues === 'function') {
      const bytes = new Uint8Array(count);
      cryptoProvider.getRandomValues(bytes);
      return bytes;
    }

    if (!this.isSupported() || !module) {
      throw new Error('No cryptographically secure random provider is available.');
    }
    const bytes = await module.secureRandomBytes(count);
    if (
      !Array.isArray(bytes) ||
      bytes.length !== count ||
      bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)
    ) {
      throw new Error('Native secure random provider returned invalid bytes.');
    }
    return Uint8Array.from(bytes);
  },

  async enqueueNativeBleWrite(base64Frame: string): Promise<boolean> {
    if (!this.isSupported() || !module) return false;
    if (!base64Frame) {
      throw new Error('Native BLE writes require a non-empty base64 frame.');
    }
    return module.enqueueNativeBleWrite(base64Frame);
  },

  async drainNativeBleFrames(maxFrames = 32): Promise<string[]> {
    if (!this.isSupported() || !module) return [];
    const boundedMax = Math.max(0, Math.min(128, Math.floor(maxFrames)));
    return module.drainNativeBleFrames(boundedMax);
  },

  async drainBackgroundInbox(maxFrames = 128): Promise<NativeBackgroundInboxFrame[]> {
    if (!this.isSupported() || !module) return [];
    const boundedMax = Math.max(0, Math.min(128, Math.floor(maxFrames)));
    return validBackgroundFrames(await module.drainBackgroundInbox(boundedMax));
  },

  async listBackgroundChannelInbox(
    maxFrames = 128,
  ): Promise<NativeBackgroundChannelInboxFrame[]> {
    if (!this.isSupported() || !module) return [];
    const boundedMax = Math.max(0, Math.min(128, Math.floor(maxFrames)));
    return validChannelInboxFrames(
      await module.listBackgroundChannelInbox(boundedMax),
    );
  },

  async acknowledgeBackgroundChannelInbox(ids: string[]): Promise<number> {
    if (!this.isSupported() || !module) return 0;
    const normalized = Array.from(
      new Set(
        ids
          .map(id => id.trim().toLowerCase())
          .filter(id => /^[0-9a-f]{64}$/.test(id)),
      ),
    );
    if (normalized.length === 0) return 0;
    return module.acknowledgeBackgroundChannelInboxJson(JSON.stringify(normalized));
  },

  async getStatus(): Promise<NativeRadioServiceStatus> {
    if (!this.isSupported() || !module) return {...unsupportedStatus};
    return module.getStatus();
  },
};
