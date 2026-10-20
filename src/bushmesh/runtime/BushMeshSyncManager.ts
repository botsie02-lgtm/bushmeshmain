import {
  BushMeshInventorySummary,
  BushMeshRangeRequest,
  BushMeshSyncFrameKind,
  BushMeshSyncNamespace,
  createInventorySummary,
  idsProbablyMissingFromRemote,
  missingIdsToRanges,
  toLegacySyncSummary,
} from '../protocol';

type InventoryState = {
  generation: number;
  ids: Set<number>;
};

export type BushMeshSyncInventorySnapshot = {
  namespace: number;
  generation: number;
  ids: number[];
};

export type BushMeshSyncManagerSnapshot = {
  inventories: BushMeshSyncInventorySnapshot[];
  remoteSummaries: BushMeshInventorySummary[];
};

export class BushMeshSyncManager {
  private readonly inventories = new Map<number, InventoryState>();
  private readonly remoteSummaries = new Map<number, BushMeshInventorySummary>();

  setInventory(
    namespace: BushMeshSyncNamespace | number,
    itemIds: number[],
    generation = 1,
  ): void {
    this.inventories.set(namespace, {
      generation,
      ids: new Set(itemIds),
    });
  }

  addItem(namespace: BushMeshSyncNamespace | number, itemId: number): number {
    const state = this.getOrCreate(namespace);

    if (!state.ids.has(itemId)) {
      state.ids.add(itemId);
      state.generation = this.nextGeneration(state.generation);
    }

    return state.generation;
  }

  removeItem(namespace: BushMeshSyncNamespace | number, itemId: number): number {
    const state = this.getOrCreate(namespace);

    if (state.ids.delete(itemId)) {
      state.generation = this.nextGeneration(state.generation);
    }

    return state.generation;
  }

  createSummary(
    namespace: BushMeshSyncNamespace | number,
    options?: {bloomByteLength?: number; bloomHashCount?: number},
  ): BushMeshInventorySummary {
    const state = this.getOrCreate(namespace);
    return createInventorySummary(
      namespace,
      Array.from(state.ids),
      state.generation,
      options,
    );
  }

  acceptRemoteSummary(summary: BushMeshInventorySummary): void {
    this.remoteSummaries.set(summary.namespace, {
      ...summary,
      bloomBytes: [...summary.bloomBytes],
    });
  }

  remoteSummary(
    namespace: BushMeshSyncNamespace | number,
  ): BushMeshInventorySummary | null {
    const summary = this.remoteSummaries.get(namespace);
    return summary
      ? {...summary, bloomBytes: [...summary.bloomBytes]}
      : null;
  }

  itemsProbablyMissingAtRemote(
    namespace: BushMeshSyncNamespace | number,
  ): number[] {
    const local = this.inventories.get(namespace);
    const remote = this.remoteSummaries.get(namespace);

    if (!local) {
      return [];
    }

    if (!remote) {
      return Array.from(local.ids).sort((a, b) => a - b);
    }

    return idsProbablyMissingFromRemote(
      Array.from(local.ids),
      toLegacySyncSummary(remote),
    );
  }

  createRangeRequest(
    namespace: BushMeshSyncNamespace | number,
    missingIds: number[],
  ): BushMeshRangeRequest {
    const local = this.getOrCreate(namespace);
    return {
      kind: BushMeshSyncFrameKind.RequestRanges,
      namespace,
      generation: local.generation,
      ranges: missingIdsToRanges(missingIds),
    };
  }

  idsForRangeRequest(request: BushMeshRangeRequest): number[] {
    const state = this.inventories.get(request.namespace);

    if (!state) {
      return [];
    }

    const ids = Array.from(state.ids);
    return ids
      .filter(id =>
        request.ranges.some(range => id >= range.start && id <= range.end),
      )
      .sort((a, b) => a - b);
  }

  inventoryIds(namespace: BushMeshSyncNamespace | number): number[] {
    return Array.from(this.inventories.get(namespace)?.ids ?? []).sort(
      (a, b) => a - b,
    );
  }

  generation(namespace: BushMeshSyncNamespace | number): number {
    return this.getOrCreate(namespace).generation;
  }

  clearRemote(namespace?: BushMeshSyncNamespace | number): void {
    if (namespace === undefined) {
      this.remoteSummaries.clear();
      return;
    }

    this.remoteSummaries.delete(namespace);
  }

  snapshot(): BushMeshSyncManagerSnapshot {
    return {
      inventories: Array.from(this.inventories.entries())
        .map(([namespace, state]) => ({
          namespace,
          generation: state.generation,
          ids: Array.from(state.ids).sort((a, b) => a - b),
        }))
        .sort((a, b) => a.namespace - b.namespace),
      remoteSummaries: Array.from(this.remoteSummaries.values())
        .map(summary => ({...summary, bloomBytes: [...summary.bloomBytes]}))
        .sort((a, b) => a.namespace - b.namespace),
    };
  }

  restore(
    snapshot: BushMeshSyncManagerSnapshot,
    options?: {replace?: boolean},
  ): {inventories: number; remoteSummaries: number} {
    if (!snapshot || !Array.isArray(snapshot.inventories) || !Array.isArray(snapshot.remoteSummaries)) {
      throw new Error('BushMesh sync snapshot has invalid shape.');
    }

    if (options?.replace !== false) {
      this.inventories.clear();
      this.remoteSummaries.clear();
    }

    let restoredInventories = 0;
    for (const saved of snapshot.inventories) {
      if (
        !saved ||
        !Number.isInteger(saved.namespace) ||
        saved.namespace < 0 ||
        saved.namespace > 255 ||
        !Number.isInteger(saved.generation) ||
        saved.generation < 1 ||
        saved.generation > 0xffffffff ||
        !Array.isArray(saved.ids)
      ) {
        continue;
      }

      const ids = saved.ids.filter(
        id => Number.isInteger(id) && id >= 0 && id <= 0xffffffff,
      );
      this.inventories.set(saved.namespace, {
        generation: saved.generation,
        ids: new Set(ids),
      });
      restoredInventories += 1;
    }

    let restoredRemoteSummaries = 0;
    for (const summary of snapshot.remoteSummaries) {
      if (
        !summary ||
        !Number.isInteger(summary.namespace) ||
        !Number.isInteger(summary.generation) ||
        !Array.isArray(summary.bloomBytes)
      ) {
        continue;
      }

      this.remoteSummaries.set(summary.namespace, {
        ...summary,
        bloomBytes: [...summary.bloomBytes],
      });
      restoredRemoteSummaries += 1;
    }

    return {
      inventories: restoredInventories,
      remoteSummaries: restoredRemoteSummaries,
    };
  }

  clear(): void {
    this.inventories.clear();
    this.remoteSummaries.clear();
  }

  private getOrCreate(namespace: BushMeshSyncNamespace | number): InventoryState {
    const existing = this.inventories.get(namespace);

    if (existing) {
      return existing;
    }

    const created: InventoryState = {generation: 1, ids: new Set<number>()};
    this.inventories.set(namespace, created);
    return created;
  }

  private nextGeneration(current: number): number {
    const next = (current + 1) >>> 0;
    return next === 0 ? 1 : next;
  }
}
