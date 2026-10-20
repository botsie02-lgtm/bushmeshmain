import {
  BushMeshInventorySummary,
  BushMeshSyncNamespace,
} from '../protocol';
import {BushMeshPersistentSync} from './BushMeshPersistentSync';
import {getBushMeshPersistentStore} from './BushMeshPersistentStore';
import {
  BushMeshSyncManager,
  BushMeshSyncManagerSnapshot,
} from './BushMeshSyncManager';

/**
 * Shared sync manager variant that automatically checkpoints local inventory
 * generations and remote Bloom summaries after mutations. Restore is merge-only
 * so live app state always wins if startup work races with persistence loading.
 */
export class BushMeshDurableSyncManager extends BushMeshSyncManager {
  private persistence: BushMeshPersistentSync | null = null;
  private initializePromise: Promise<void> | null = null;

  ensurePersistenceInitialized(): Promise<void> {
    if (this.initializePromise) {
      return this.initializePromise;
    }

    const store = getBushMeshPersistentStore();
    this.persistence = new BushMeshPersistentSync(this, store ?? undefined);
    this.initializePromise = this.persistence
      .initialize({merge: true})
      .then(() => undefined)
      .catch(() => undefined);
    return this.initializePromise;
  }

  override setInventory(
    namespace: BushMeshSyncNamespace | number,
    itemIds: number[],
    generation = 1,
  ): void {
    super.setInventory(namespace, itemIds, generation);
    this.schedulePersist();
  }

  override addItem(
    namespace: BushMeshSyncNamespace | number,
    itemId: number,
  ): number {
    const generation = super.addItem(namespace, itemId);
    this.schedulePersist();
    return generation;
  }

  override removeItem(
    namespace: BushMeshSyncNamespace | number,
    itemId: number,
  ): number {
    const generation = super.removeItem(namespace, itemId);
    this.schedulePersist();
    return generation;
  }

  override acceptRemoteSummary(summary: BushMeshInventorySummary): void {
    super.acceptRemoteSummary(summary);
    this.schedulePersist();
  }

  override clearRemote(namespace?: BushMeshSyncNamespace | number): void {
    super.clearRemote(namespace);
    this.schedulePersist();
  }

  override clear(): void {
    super.clear();
    this.schedulePersist();
  }

  override restore(
    snapshot: BushMeshSyncManagerSnapshot,
    options?: {replace?: boolean},
  ): {inventories: number; remoteSummaries: number} {
    // Restore itself must not immediately re-write the same snapshot while the
    // coordinator is still initializing.
    return super.restore(snapshot, options);
  }

  async flushPersistence(): Promise<void> {
    await this.ensurePersistenceInitialized();
    await this.persistence?.flush();
  }

  private schedulePersist(): void {
    void this.ensurePersistenceInitialized().then(() => {
      this.persistence?.schedulePersist();
    });
  }
}
