import {nativeAppInfo} from '../native/NativeAppInfo';

export type SupportRuntimeMetadata = {
  platform: string;
  appVersion: string | null;
  buildNumber: number | null;
  platformApiLevel: number | null;
  architecture: string | null;
  debugBuild: boolean | null;
  phoneBatteryPercent: number | null;
  charging: boolean | null;
  powerSaveMode: boolean | null;
  thermalStatus: number | null;
};

export async function loadSupportRuntimeMetadata(): Promise<SupportRuntimeMetadata> {
  const info = await nativeAppInfo.getInfo();
  if (!info) {
    return {
      platform: 'unknown',
      appVersion: null,
      buildNumber: null,
      platformApiLevel: null,
      architecture: null,
      debugBuild: null,
      phoneBatteryPercent: null,
      charging: null,
      powerSaveMode: null,
      thermalStatus: null,
    };
  }

  return {
    platform: info.platform,
    appVersion: info.versionName || null,
    buildNumber: info.versionCode,
    platformApiLevel: info.apiLevel,
    architecture: info.primaryAbi || null,
    debugBuild: info.debugBuild,
    phoneBatteryPercent: info.phoneBatteryPercent,
    charging: info.charging,
    powerSaveMode: info.powerSaveMode,
    thermalStatus: info.thermalStatus,
  };
}
