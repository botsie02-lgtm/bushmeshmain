import type {BushMeshRuntimePersistence} from '../bushmesh/runtime/public';
import {androidBushMeshPersistence} from '../persistence/AndroidBushMeshPersistence';

export const BUSHMESH_CANONICAL_RUNTIME_STATE_KEY = 'bushmesh.runtime.dedup.v1';

export type RadioCoreCanonicalRuntimeStateStore = {
  loadCanonicalRuntimeState(): Promise<string | null>;
  saveCanonicalRuntimeState(serializedState: string): Promise<void>;
  clearCanonicalRuntimeState(): Promise<void>;
};

/**
 * Adapts the canonical runtime's AsyncStorage-shaped persistence port to the
 * radio-core encrypted persistence service. The canonical v1 runtime currently
 * owns one durable dedup/replay snapshot key; unexpected keys fail closed so a
 * future runtime schema expansion cannot silently share the wrong secure slot.
 */
export class RadioCoreBushMeshRuntimePersistence
  implements BushMeshRuntimePersistence
{
  constructor(private readonly store: RadioCoreCanonicalRuntimeStateStore) {}

  async getItem(key: string): Promise<string | null> {
    this.assertSupportedKey(key);
    return this.store.loadCanonicalRuntimeState();
  }

  async setItem(key: string, value: string): Promise<void> {
    this.assertSupportedKey(key);
    await this.store.saveCanonicalRuntimeState(value);
  }

  async removeItem(key: string): Promise<void> {
    this.assertSupportedKey(key);
    await this.store.clearCanonicalRuntimeState();
  }

  private assertSupportedKey(key: string): void {
    if (key !== BUSHMESH_CANONICAL_RUNTIME_STATE_KEY) {
      throw new Error(`Unsupported canonical BushMesh runtime persistence key: ${key}`);
    }
  }
}

export const androidBushMeshRuntimePersistence =
  new RadioCoreBushMeshRuntimePersistence(androidBushMeshPersistence);
