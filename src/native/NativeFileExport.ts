import {NativeModules, Platform} from 'react-native';

export type NativeExportResult = {
  displayName: string;
  uri: string;
  location: string;
};

type NativeExportModule = {
  shareConversationExport?: (uri: string, format: 'txt' | 'json') => Promise<boolean>;
  saveConversationExport?: (content: string, format: 'txt' | 'json') => Promise<NativeExportResult>;
  saveGpx: (displayName: string, content: string) => Promise<NativeExportResult>;
  saveJson: (displayName: string, content: string) => Promise<NativeExportResult>;
};

const module = NativeModules.BushMeshExport as NativeExportModule | undefined;

export const nativeFileExport = {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  },

  conversationShareSupported(): boolean { return Platform.OS === 'android' && typeof module?.shareConversationExport === 'function'; },
  async shareConversation(uri: string, format: 'txt' | 'json'): Promise<void> {
    if (!module?.shareConversationExport || !await module.shareConversationExport(uri, format)) throw new Error('Conversation share unavailable.');
  },
  conversationSupported(): boolean { return Platform.OS === 'android' && typeof module?.saveConversationExport === 'function'; },
  async saveConversation(content: string, format: 'txt' | 'json'): Promise<NativeExportResult> {
    if (!module?.saveConversationExport) throw new Error('Conversation export unavailable.');
    return module.saveConversationExport(content, format);
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
