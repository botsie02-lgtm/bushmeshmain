import {
  BushMeshRangeRequest,
  BushMeshSyncNamespace,
  BushMeshSyncRecordBatch,
  decodeBushMeshSyncRecordBatch,
  encodeBushMeshSyncRecordBatch,
} from '../protocol';
import {BushMeshSyncManager} from './BushMeshSyncManager';

export type BushMeshSyncApplyResult = {
  namespace: number;
  generation: number;
  addedIds: number[];
  unchangedIds: number[];
  conflictingIds: number[];
};

/**
 * Concrete payload store for opportunistic synchronization. By default remote
 * records only fill locally-missing IDs; an existing different payload is
 * reported as a conflict rather than overwritten silently.
 */
export class BushMeshSyncRecordStore {
  private readonly records = new Map<number, Map<number, number[]>>();

  constructor(private readonly sync: BushMeshSyncManager) {}

  setLocalRecord(
    namespace: BushMeshSyncNamespace | number,
    itemId: number,
    payload: number[],
  ): void {
    let namespaceRecords = this.records.get(namespace);
    if (!namespaceRecords) {
      namespaceRecords = new Map<number, number[]>();
      this.records.set(namespace, namespaceRecords);
    }

    namespaceRecords.set(itemId, [...payload]);
    this.sync.addItem(namespace, itemId);
  }

  removeLocalRecord(
    namespace: BushMeshSyncNamespace | number,
    itemId: number,
  ): boolean {
    const namespaceRecords = this.records.get(namespace);
    const removed = namespaceRecords?.delete(itemId) ?? false;

    if (removed) {
      this.sync.removeItem(namespace, itemId);
      if (namespaceRecords?.size === 0) {
        this.records.delete(namespace);
      }
    }

    return removed;
  }

  get(
    namespace: BushMeshSyncNamespace | number,
    itemId: number,
  ): number[] | null {
    const payload = this.records.get(namespace)?.get(itemId);
    return payload ? [...payload] : null;
  }

  buildBatchForRangeRequest(
    request: BushMeshRangeRequest,
    options?: {
      maxRecords?: number;
      maxEncodedBytes?: number;
    },
  ): BushMeshSyncRecordBatch {
    const ids = this.sync.idsForRangeRequest(request);
    const namespaceRecords = this.records.get(request.namespace);
    const maxRecords = Math.max(1, Math.min(64, options?.maxRecords ?? 32));
    const maxEncodedBytes = Math.max(32, options?.maxEncodedBytes ?? 4096);
    const records: BushMeshSyncRecordBatch['records'] = [];

    for (const itemId of ids) {
      const payload = namespaceRecords?.get(itemId);
      if (!payload) {
        continue;
      }

      const candidate = {
        namespace: request.namespace,
        generation: this.sync.generation(request.namespace),
        records: [...records, {itemId, payload: [...payload]}],
      };

      if (
        candidate.records.length > maxRecords ||
        encodeBushMeshSyncRecordBatch(candidate).length > maxEncodedBytes
      ) {
        break;
      }

      records.push({itemId, payload: [...payload]});
    }

    return {
      namespace: request.namespace,
      generation: this.sync.generation(request.namespace),
      records,
    };
  }

  encodeBatchForRangeRequest(
    request: BushMeshRangeRequest,
    options?: {
      maxRecords?: number;
      maxEncodedBytes?: number;
    },
  ): number[] {
    return encodeBushMeshSyncRecordBatch(
      this.buildBatchForRangeRequest(request, options),
    );
  }

  applyEncodedBatch(
    bytes: number[],
    options?: {allowOverwrite?: boolean},
  ): BushMeshSyncApplyResult {
    return this.applyBatch(decodeBushMeshSyncRecordBatch(bytes), options);
  }

  applyBatch(
    batch: BushMeshSyncRecordBatch,
    options?: {allowOverwrite?: boolean},
  ): BushMeshSyncApplyResult {
    let namespaceRecords = this.records.get(batch.namespace);
    if (!namespaceRecords) {
      namespaceRecords = new Map<number, number[]>();
      this.records.set(batch.namespace, namespaceRecords);
    }

    const addedIds: number[] = [];
    const unchangedIds: number[] = [];
    const conflictingIds: number[] = [];

    for (const record of batch.records) {
      const existing = namespaceRecords.get(record.itemId);

      if (!existing) {
        namespaceRecords.set(record.itemId, [...record.payload]);
        this.sync.addItem(batch.namespace, record.itemId);
        addedIds.push(record.itemId);
        continue;
      }

      if (this.bytesEqual(existing, record.payload)) {
        unchangedIds.push(record.itemId);
        continue;
      }

      if (options?.allowOverwrite === true) {
        namespaceRecords.set(record.itemId, [...record.payload]);
        this.sync.addItem(batch.namespace, record.itemId);
        addedIds.push(record.itemId);
      } else {
        conflictingIds.push(record.itemId);
      }
    }

    return {
      namespace: batch.namespace,
      generation: batch.generation,
      addedIds,
      unchangedIds,
      conflictingIds,
    };
  }

  inventory(
    namespace: BushMeshSyncNamespace | number,
  ): Array<{itemId: number; payload: number[]}> {
    return Array.from(this.records.get(namespace)?.entries() ?? [])
      .sort((a, b) => a[0] - b[0])
      .map(([itemId, payload]) => ({itemId, payload: [...payload]}));
  }

  clear(namespace?: BushMeshSyncNamespace | number): void {
    if (namespace === undefined) {
      this.records.clear();
      return;
    }
    this.records.delete(namespace);
  }

  private bytesEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
}
