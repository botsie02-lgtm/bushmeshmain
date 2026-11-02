import {NativeModules, Platform} from 'react-native';

import {
  BushMeshTrackSnapshotV1,
  decodeTrackSnapshot,
  encodeTrackSnapshot,
} from './trackSnapshot';

type NativeTrackPersistenceModule = {
  loadTrack: () => Promise<string | null>;
  saveTrack: (serializedSnapshot: string) => Promise<boolean>;
  clearTrack: () => Promise<boolean>;
  resetTrackStorage: () => Promise<boolean>;
};

const module = NativeModules.BushMeshPersistence as
  | NativeTrackPersistenceModule
  | undefined;

export class AndroidTrackPersistence {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  }

  async load(): Promise<BushMeshTrackSnapshotV1 | null> {
    if (!this.isSupported() || !module) {
      return null;
    }

    const serialized = await module.loadTrack();
    return serialized === null ? null : decodeTrackSnapshot(serialized);
  }

  async save(snapshot: BushMeshTrackSnapshotV1): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.saveTrack(encodeTrackSnapshot(snapshot));
  }

  async clear(): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.clearTrack();
  }

  async resetSecureStorage(): Promise<void> {
    if (!this.isSupported() || !module) {
      return;
    }

    await module.resetTrackStorage();
  }
}

export const androidTrackPersistence = new AndroidTrackPersistence();
