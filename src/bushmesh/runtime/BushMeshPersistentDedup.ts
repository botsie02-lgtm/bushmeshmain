import {
  BushMeshMessageIdentity,
  BushMeshRecentMessageCache,
  BushMeshSeenMessageSnapshot,
} from '../protocol';

export type BushMeshDedupStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

const SNAPSHOT_VERSION = 1;
const DEFAULT_STORE_KEY = 'bushmesh.seenMessages.v1';

/**
 * Durable wrapper around the forwarding dedup cache. It keeps a short-lived
 * record of recently delivered/forwarded identities across application restart,
 * preventing a reconnect from immediately replaying the same flood traffic.
 */
export class BushMeshPersistentDedup {
  readonly cache: BushMeshRecentMessageCache;

  constructor(
    private readonly store?: BushMeshDedupStore,
    options?: {
      storeKey?: string;
      ttlMs?: number;
      maxEntries?: number;
    },
  ) {
    this.storeKey = options?.storeKey ?? DEFAULT_STORE_KEY;
    this.cache = new BushMeshRecentMessageCache(
      options?.ttlMs ?? 10 * 60 * 1000,
      options?.maxEntries ?? 2048,
    );
  }

  private readonly storeKey: string;

  async initialize(now = Date.now()): Promise<number> {
    if (!this.store) {
      return 0;
    }

    const raw = await this.store.getItem(this.storeKey);
    if (!raw) {
      return 0;
    }

    try {
      const parsed = JSON.parse(raw) as {
        version?: number;
        entries?: BushMeshSeenMessageSnapshot[];
      };

      if (parsed.version !== SNAPSHOT_VERSION || !Array.isArray(parsed.entries)) {
        await this.clear();
        return 0;
      }

      const restored = this.cache.restore(parsed.entries, now, true);
      await this.persist(now);
      return restored;
    } catch {
      await this.clear();
      return 0;
    }
  }

  hasSeen(identity: BushMeshMessageIdentity, now = Date.now()): boolean {
    return this.cache.hasSeen(identity, now);
  }

  async remember(
    identity: BushMeshMessageIdentity,
    now = Date.now(),
  ): Promise<void> {
    this.cache.remember(identity, now);
    await this.persist(now);
  }

  async checkAndRemember(
    identity: BushMeshMessageIdentity,
    now = Date.now(),
  ): Promise<boolean> {
    const duplicate = this.cache.checkAndRemember(identity, now);
    if (!duplicate) {
      await this.persist(now);
    }
    return duplicate;
  }

  async prune(now = Date.now()): Promise<number> {
    const removed = this.cache.prune(now);
    if (removed > 0) {
      await this.persist(now);
    }
    return removed;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    if (!this.store) {
      return;
    }

    if (this.store.removeItem) {
      await this.store.removeItem(this.storeKey);
    } else {
      await this.store.setItem(this.storeKey, '');
    }
  }

  async persist(now = Date.now()): Promise<void> {
    if (!this.store) {
      return;
    }

    await this.store.setItem(
      this.storeKey,
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        entries: this.cache.snapshot(now),
      }),
    );
  }
}
