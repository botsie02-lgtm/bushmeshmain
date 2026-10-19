import {NativeModules, Platform} from 'react-native';

import {
  BushMeshContactSnapshotV1,
  decodeContactSnapshot,
  encodeContactSnapshot,
} from './contactSnapshot';

type NativePersistenceModule = {
  loadContacts: () => Promise<string | null>;
  saveContacts: (serializedSnapshot: string) => Promise<boolean>;
  clearContacts: () => Promise<boolean>;
  resetContactsStorage: () => Promise<boolean>;
};

const module = NativeModules.BushMeshPersistence as
  | NativePersistenceModule
  | undefined;

export class AndroidContactPersistence {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  }

  async load(): Promise<BushMeshContactSnapshotV1 | null> {
    if (!this.isSupported() || !module) {
      return null;
    }

    const serialized = await module.loadContacts();
    return serialized === null ? null : decodeContactSnapshot(serialized);
  }

  async save(snapshot: BushMeshContactSnapshotV1): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.saveContacts(encodeContactSnapshot(snapshot));
  }

  async clear(): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.clearContacts();
  }

  async resetSecureStorage(): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.resetContactsStorage();
  }
}

export const androidContactPersistence = new AndroidContactPersistence();
