import {NativeModules, Platform} from 'react-native';

type NativeMessageReceiptModule = {
  claimFrame: (base64Frame: string) => Promise<boolean>;
  getCount: () => Promise<number>;
};

const module = NativeModules.BushMeshMessageReceipt as
  | NativeMessageReceiptModule
  | undefined;

export const nativeMessageReceipt = {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  },

  async claimFrame(base64Frame: string): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return true;
    }
    if (!base64Frame.trim()) {
      return false;
    }
    return module.claimFrame(base64Frame);
  },

  async getCount(): Promise<number> {
    if (!this.isSupported() || !module) {
      return 0;
    }
    return module.getCount();
  },
};
