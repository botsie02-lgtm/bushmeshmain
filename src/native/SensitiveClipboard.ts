import {NativeModules, Platform} from 'react-native';

type SensitiveClipboardModule = {
  copySensitiveTextToClipboard?: (text: string) => Promise<boolean>;
  showSharedChannelKey?: (secret: string) => Promise<boolean>;
  hideSharedChannelKey?: () => void;
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

/** Native FLAG_SECURE dialog only; never retain plaintext in React state. */
export const protectedChannelKey = {
  supported: () => Platform.OS === 'android' && typeof module?.showSharedChannelKey === 'function',
  async reveal(secret: string): Promise<void> {
    if (!module?.showSharedChannelKey || !await module.showSharedChannelKey(secret)) throw new Error('Protected key reveal unavailable.');
  },
  hide: () => module?.hideSharedChannelKey?.(),
};
