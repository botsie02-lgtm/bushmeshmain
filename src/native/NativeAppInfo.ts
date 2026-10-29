import {NativeModules, Platform} from 'react-native';

export type BushMeshAppRuntimeInfo = {
  platform: 'android';
  versionName: string;
  versionCode: number;
  apiLevel: number;
  primaryAbi: string;
  debugBuild: boolean;
  phoneBatteryPercent: number | null;
  charging: boolean | null;
  powerSaveMode: boolean | null;
  thermalStatus: number | null;
};

type NativeAppInfoModule = {
  getInfo: () => Promise<unknown>;
};

const module = NativeModules.BushMeshAppInfo as NativeAppInfoModule | undefined;

function nullableBoolean(value: unknown): boolean | null {
  return value === null || value === undefined
    ? null
    : typeof value === 'boolean'
      ? value
      : null;
}

function nullableFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseRuntimeInfo(value: unknown): BushMeshAppRuntimeInfo {
  if (!value || typeof value !== 'object') {
    throw new Error('Android returned invalid Bushmesh app metadata.');
  }

  const record = value as Record<string, unknown>;
  if (
    record.platform !== 'android' ||
    typeof record.versionName !== 'string' ||
    typeof record.versionCode !== 'number' ||
    !Number.isFinite(record.versionCode) ||
    typeof record.apiLevel !== 'number' ||
    !Number.isFinite(record.apiLevel) ||
    typeof record.primaryAbi !== 'string' ||
    typeof record.debugBuild !== 'boolean'
  ) {
    throw new Error('Android returned incomplete Bushmesh app metadata.');
  }

  const phoneBatteryPercent = nullableFiniteNumber(record.phoneBatteryPercent);
  const thermalStatus = nullableFiniteNumber(record.thermalStatus);

  return {
    platform: 'android',
    versionName: record.versionName,
    versionCode: Math.max(0, Math.floor(record.versionCode)),
    apiLevel: Math.max(0, Math.floor(record.apiLevel)),
    primaryAbi: record.primaryAbi,
    debugBuild: record.debugBuild,
    phoneBatteryPercent:
      phoneBatteryPercent !== null &&
      phoneBatteryPercent >= 0 &&
      phoneBatteryPercent <= 100
        ? Math.round(phoneBatteryPercent)
        : null,
    charging: nullableBoolean(record.charging),
    powerSaveMode: nullableBoolean(record.powerSaveMode),
    thermalStatus:
      thermalStatus !== null && thermalStatus >= 0
        ? Math.floor(thermalStatus)
        : null,
  };
}

export const nativeAppInfo = {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  },

  async getInfo(): Promise<BushMeshAppRuntimeInfo | null> {
    if (!this.isSupported() || !module) {
      return null;
    }
    return parseRuntimeInfo(await module.getInfo());
  },
};
