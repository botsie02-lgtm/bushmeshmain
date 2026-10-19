import {NativeModules, Platform} from 'react-native';

import {BushMeshPersistence} from './BushMeshPersistence';
import {
  BushMeshOutboxSnapshotV1,
  decodeOutboxSnapshot,
  encodeOutboxSnapshot,
} from './outboxSnapshot';

type NativePersistenceModule = {
  loadOutbox: () => Promise<string | null>;
  saveOutbox: (serializedSnapshot: string) => Promise<boolean>;
  clearOutbox: () => Promise<boolean>;
  resetOutboxStorage: () => Promise<boolean>;
};

const module = NativeModules.BushMeshPersistence as
  | NativePersistenceModule
  | undefined;

export class AndroidBushMeshPersistence implements BushMeshPersistence {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  }

  async loadOutbox(): Promise<BushMeshOutboxSnapshotV1 | null> {
    if (!this.isSupported() || !module) {
      return null;
    }

    const serialized = await module.loadOutbox();
    return serialized === null ? null : decodeOutboxSnapshot(serialized);
  }

  async saveOutbox(snapshot: BushMeshOutboxSnapshotV1): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.saveOutbox(encodeOutboxSnapshot(snapshot));
  }

  async clearOutbox(): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.clearOutbox();
  }

  async resetSecureStorage(): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.resetOutboxStorage();
  }
}

export const androidBushMeshPersistence = new AndroidBushMeshPersistence();
