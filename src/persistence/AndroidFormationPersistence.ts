import {NativeModules, Platform} from 'react-native';

export type BushMeshFormationPersistence = {
  supported: boolean;
  load: () => Promise<string | null>;
  save: (serializedSnapshot: string) => Promise<void>;
  clear: () => Promise<void>;
  resetUnreadableStorage: () => Promise<void>;
};

type NativeFormationPersistenceModule = {
  loadFormation: () => Promise<string | null>;
  saveFormation: (serializedSnapshot: string) => Promise<boolean>;
  clearFormation: () => Promise<boolean>;
  resetFormationStorage: () => Promise<boolean>;
};

const nativeModule = NativeModules.BushMeshPersistence as
  | NativeFormationPersistenceModule
  | undefined;

export const androidFormationPersistence: BushMeshFormationPersistence = {
  supported: Platform.OS === 'android' && nativeModule !== undefined,

  async load(): Promise<string | null> {
    if (!this.supported || !nativeModule) {
      return null;
    }
    return nativeModule.loadFormation();
  },

  async save(serializedSnapshot: string): Promise<void> {
    if (!this.supported || !nativeModule) {
      return;
    }
    await nativeModule.saveFormation(serializedSnapshot);
  },

  async clear(): Promise<void> {
    if (!this.supported || !nativeModule) {
      return;
    }
    await nativeModule.clearFormation();
  },

  async resetUnreadableStorage(): Promise<void> {
    if (!this.supported || !nativeModule) {
      return;
    }
    await nativeModule.resetFormationStorage();
  },
};
