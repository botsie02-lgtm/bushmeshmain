import {NativeModules, Platform} from 'react-native';

import {
  BushMeshMapStateSnapshotV2,
  decodeMapStateSnapshot,
  encodeMapStateSnapshot,
} from './mapStateSnapshot';

type NativeMapStatePersistenceModule = {
  loadMapState: () => Promise<string | null>;
  saveMapState: (serializedSnapshot: string) => Promise<boolean>;
  clearMapState: () => Promise<boolean>;
  resetMapStateStorage: () => Promise<boolean>;
};

const module = NativeModules.BushMeshPersistence as
  | NativeMapStatePersistenceModule
  | undefined;

export class AndroidMapStatePersistence {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  }

  async load(): Promise<BushMeshMapStateSnapshotV2 | null> {
    if (!this.isSupported() || !module) {
      return null;
    }

    const serialized = await module.loadMapState();
    return serialized === null ? null : decodeMapStateSnapshot(serialized);
  }

  async save(snapshot: BushMeshMapStateSnapshotV2): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.saveMapState(encodeMapStateSnapshot(snapshot));
  }

  async clear(): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.clearMapState();
  }

  async resetSecureStorage(): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.resetMapStateStorage();
  }
}

export const androidMapStatePersistence = new AndroidMapStatePersistence();
