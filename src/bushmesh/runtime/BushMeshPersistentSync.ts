import {
  BushMeshSyncManager,
  BushMeshSyncManagerSnapshot,
} from './BushMeshSyncManager';

export type BushMeshSyncStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

const SNAPSHOT_VERSION = 1;
const DEFAULT_STORE_KEY = 'bushmesh.syncState.v1';

/**
 * Explicit persistence boundary for sync inventories. Initialization is
 * deliberately async and caller-controlled so restored state cannot race with
 * UI code that is rebuilding contact/channel/message inventories.
 */
export class BushMeshPersistentSync {
  private persistChain: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(
    readonly manager: BushMeshSyncManager,
    private readonly store?: BushMeshSyncStore,
    private readonly storeKey = DEFAULT_STORE_KEY,
  ) {}

  async initialize(options?: {
    merge?: boolean;
  }): Promise<{inventories: number; remoteSummaries: number}> {
    if (this.initialized) {
      const snapshot = this.manager.snapshot();
      return {
        inventories: snapshot.inventories.length,
        remoteSummaries: snapshot.remoteSummaries.length,
      };
    }

    this.initialized = true;
    if (!this.store) {
      return {inventories: 0, remoteSummaries: 0};
    }

    const raw = await this.store.getItem(this.storeKey);
    if (!raw) {
      return {inventories: 0, remoteSummaries: 0};
    }

    try {
      const envelope = JSON.parse(raw) as {
        version?: number;
        snapshot?: BushMeshSyncManagerSnapshot;
      };

      if (envelope.version !== SNAPSHOT_VERSION || !envelope.snapshot) {
        await this.clearStoredOnly();
        return {inventories: 0, remoteSummaries: 0};
      }

      return this.manager.restore(envelope.snapshot, {
        replace: options?.merge !== true,
      });
    } catch {
      await this.clearStoredOnly();
      return {inventories: 0, remoteSummaries: 0};
    }
  }

  schedulePersist(): void {
    if (!this.store) {
      return;
    }

    this.persistChain = this.persistChain
      .then(() => this.persistNow())
      .catch(() => undefined);
  }

  async persistNow(): Promise<void> {
    if (!this.store) {
      return;
    }

    await this.store.setItem(
      this.storeKey,
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        snapshot: this.manager.snapshot(),
      }),
    );
  }

  async flush(): Promise<void> {
    await this.persistChain;
  }

  async clear(options?: {clearManager?: boolean}): Promise<void> {
    if (options?.clearManager !== false) {
      this.manager.clear();
    }
    await this.clearStoredOnly();
  }

  private async clearStoredOnly(): Promise<void> {
    if (!this.store) {
      return;
    }

    if (this.store.removeItem) {
      await this.store.removeItem(this.storeKey);
    } else {
      await this.store.setItem(this.storeKey, '');
    }
  }
}
