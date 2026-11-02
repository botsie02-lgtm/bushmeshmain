import {NativeModules, Platform} from 'react-native';

export type NativeExportResult = {
  displayName: string;
  uri: string;
  location: string;
};

type NativeExportModule = {
  saveGpx: (displayName: string, content: string) => Promise<NativeExportResult>;
  saveJson: (displayName: string, content: string) => Promise<NativeExportResult>;
};

const module = NativeModules.BushMeshExport as NativeExportModule | undefined;

export const nativeFileExport = {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  },

  async saveGpx(displayName: string, content: string): Promise<NativeExportResult> {
    if (!this.isSupported() || !module) {
      throw new Error('Native GPX export is unavailable on this platform.');
    }
    return module.saveGpx(displayName, content);
  },

  async saveJson(displayName: string, content: string): Promise<NativeExportResult> {
    if (!this.isSupported() || !module) {
      throw new Error('Native JSON export is unavailable on this platform.');
    }
    return module.saveJson(displayName, content);
  },
};
