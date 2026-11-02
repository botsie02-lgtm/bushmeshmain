import {BushMeshPeerRegistry, BushMeshPeerRegistrySnapshot} from './BushMeshPeerRegistry';
import {BushMeshPersistentKeyValueStore} from './BushMeshPersistentStore';

const DEFAULT_STORAGE_KEY = 'bushmesh.peerRegistry.v1';

/**
 * Persists peer capability/link hints and learned routes. The data is only a
 * warm-start hint: normal discovery and route expiry continue to decide what is
 * usable after restart.
 */
export class BushMeshPersistentPeerRegistry {
  constructor(
    private readonly store?: BushMeshPersistentKeyValueStore,
    private readonly storageKey = DEFAULT_STORAGE_KEY,
  ) {}

  isPersistent(): boolean {
    return Boolean(this.store);
  }

  async restore(
    registry: BushMeshPeerRegistry,
    now = Date.now(),
  ): Promise<{peers: number; routes: number}> {
    if (!this.store) {
      return {peers: 0, routes: 0};
    }

    const raw = await this.store.getItem(this.storageKey);
    if (!raw) {
      return {peers: 0, routes: 0};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.store.removeItem(this.storageKey);
      return {peers: 0, routes: 0};
    }

    try {
      return registry.restore(parsed as BushMeshPeerRegistrySnapshot, {
        now,
        replace: true,
      });
    } catch {
      await this.store.removeItem(this.storageKey);
      return {peers: 0, routes: 0};
    }
  }

  async persist(registry: BushMeshPeerRegistry, now = Date.now()): Promise<void> {
    if (!this.store) {
      return;
    }

    await this.store.setItem(
      this.storageKey,
      JSON.stringify(registry.snapshot(now)),
    );
  }

  async clear(): Promise<void> {
    if (!this.store) {
      return;
    }

    await this.store.removeItem(this.storageKey);
  }
}
