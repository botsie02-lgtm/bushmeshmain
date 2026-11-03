import {NativeModules, Platform} from 'react-native';

type SensitiveClipboardModule = {
  copySensitiveTextToClipboard?: (text: string) => Promise<boolean>;
};

const module = NativeModules.BushMeshRadioService as
  | SensitiveClipboardModule
  | undefined;

export const sensitiveClipboard = {
  isSupported(): boolean {
    return (
      Platform.OS === 'android' &&
      typeof module?.copySensitiveTextToClipboard === 'function'
    );
  },

  async copy(text: string): Promise<void> {
    if (!text) {
      throw new Error('There is no carrier PSK to copy.');
    }
    if (!this.isSupported() || !module?.copySensitiveTextToClipboard) {
      throw new Error(
        'Secure clipboard copy is unavailable on this platform. Select and copy the PSK manually.',
      );
    }
    const accepted = await module.copySensitiveTextToClipboard(text);
    if (!accepted) {
      throw new Error('The carrier PSK could not be copied to the clipboard.');
    }
  },
};
