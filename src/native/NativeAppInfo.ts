import {NativeModules, Platform} from 'react-native';

export type BushMeshAppRuntimeInfo = {
  platform: 'android';
  versionName: string;
  versionCode: number;
  apiLevel: number;
  primaryAbi: string;
  debugBuild: boolean;
};

type NativeAppInfoModule = {
  getInfo: () => Promise<unknown>;
};

const module = NativeModules.BushMeshAppInfo as NativeAppInfoModule | undefined;

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

  return {
    platform: 'android',
    versionName: record.versionName,
    versionCode: Math.max(0, Math.floor(record.versionCode)),
    apiLevel: Math.max(0, Math.floor(record.apiLevel)),
    primaryAbi: record.primaryAbi,
    debugBuild: record.debugBuild,
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
