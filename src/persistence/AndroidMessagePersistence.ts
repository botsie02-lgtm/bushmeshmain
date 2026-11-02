import {NativeModules, Platform} from 'react-native';

import {
  BushMeshMessageSnapshotV1,
  decodeMessageSnapshot,
  encodeMessageSnapshot,
} from './messageSnapshot';

type NativePersistenceModule = {
  loadMessages: () => Promise<string | null>;
  saveMessages: (serializedSnapshot: string) => Promise<boolean>;
  clearMessages: () => Promise<boolean>;
  resetMessagesStorage: () => Promise<boolean>;
};

const module = NativeModules.BushMeshPersistence as
  | NativePersistenceModule
  | undefined;

export class AndroidMessagePersistence {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  }

  async load(): Promise<BushMeshMessageSnapshotV1 | null> {
    if (!this.isSupported() || !module) {
      return null;
    }

    const serialized = await module.loadMessages();
    return serialized === null ? null : decodeMessageSnapshot(serialized);
  }

  async save(snapshot: BushMeshMessageSnapshotV1): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.saveMessages(encodeMessageSnapshot(snapshot));
  }

  async clear(): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.clearMessages();
  }

  async resetSecureStorage(): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.resetMessagesStorage();
  }
}

export const androidMessagePersistence = new AndroidMessagePersistence();
