import {NativeModules, Platform} from 'react-native';

export type BushMeshPersistentKeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

type NativeBushMeshStorageModule = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

function nativeModule(): NativeBushMeshStorageModule | null {
  const module = NativeModules.BushMeshStorage as
    | NativeBushMeshStorageModule
    | undefined;

  if (
    !module ||
    typeof module.getItem !== 'function' ||
    typeof module.setItem !== 'function' ||
    typeof module.removeItem !== 'function'
  ) {
    return null;
  }

  return module;
}

export function isBushMeshPersistentStoreAvailable(): boolean {
  return nativeModule() !== null;
}

export function bushMeshPersistentStorePlatform(): string {
  if (nativeModule()) {
    return Platform.OS === 'android'
      ? 'Android SharedPreferences'
      : `${Platform.OS} native storage`;
  }

  return 'Unavailable';
}

/**
 * Returns a durable key/value store backed by the native BushMesh storage
 * module. Android builds register this module using SharedPreferences.
 *
 * A null result is intentional: callers can continue with in-memory behavior
 * on unsupported platforms rather than failing application startup.
 */
export function getBushMeshPersistentStore(): BushMeshPersistentKeyValueStore | null {
  const module = nativeModule();
  if (!module) {
    return null;
  }

  return {
    getItem: async key => module.getItem(key),
    setItem: async (key, value) => {
      await module.setItem(key, value);
    },
    removeItem: async key => {
      await module.removeItem(key);
    },
  };
}
