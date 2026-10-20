import {
  BushMeshFileContentType,
  BushMeshFileSendProgress,
} from '../protocol';
import {
  BushMeshFileCheckpointRuntime,
  BushMeshFileCheckpointStore,
} from './BushMeshFileCheckpointRuntime';
import {BushMeshFileTransferManager} from './BushMeshFileTransferManager';

export type BushMeshPersistentFileCoordinatorSnapshot = {
  restoredTransferIds: number[];
  activeTransferIds: number[];
};

/**
 * Connects persistent file checkpoints to the live file-transfer manager.
 *
 * The checkpoint codec and the active sender previously existed independently.
 * This coordinator restores saved sender state into live sessions, records
 * acknowledgement progress, and removes checkpoints after completion/cancel.
 */
export class BushMeshPersistentFileCoordinator {
  readonly checkpoints: BushMeshFileCheckpointRuntime;
  private restoredTransferIds: number[] = [];

  constructor(
    store?: BushMeshFileCheckpointStore,
    options?: {
      storeKey?: string;
      maxFileBytes?: number;
      maxTotalBytes?: number;
      maxTransfers?: number;
      maxAgeMs?: number;
    },
  ) {
    this.checkpoints = new BushMeshFileCheckpointRuntime(
      store,
      options?.storeKey,
      {
        maxFileBytes: options?.maxFileBytes,
        maxTotalBytes: options?.maxTotalBytes,
        maxTransfers: options?.maxTransfers,
        maxAgeMs: options?.maxAgeMs,
      },
    );
  }

  async initialize(
    manager: BushMeshFileTransferManager,
    now = Date.now(),
  ): Promise<number[]> {
    await this.checkpoints.initialize(now);
    const restored: number[] = [];

    for (const checkpoint of this.checkpoints.snapshot()) {
      const saved = this.checkpoints.restore(checkpoint.transferId);
      if (!saved) {
        continue;
      }

      manager.restoreOutgoing(
        saved.transfer,
        checkpoint.acknowledgedChunkIndexes,
        true,
      );
      restored.push(checkpoint.transferId);
    }

    this.restoredTransferIds = restored.sort((a, b) => a - b);
    return [...this.restoredTransferIds];
  }

  async registerOutgoing(
    manager: BushMeshFileTransferManager,
    transferId: number,
    data: number[],
    options?: {
      chunkSize?: number;
      contentType?: BushMeshFileContentType | number;
      fileName?: string;
      now?: number;
    },
  ): Promise<BushMeshFileSendProgress> {
    const saved = await this.checkpoints.create(transferId, data, options);
    return manager.restoreOutgoing(saved.transfer, [], false);
  }

  async recordProgress(
    manager: BushMeshFileTransferManager,
    transferId: number,
    now = Date.now(),
  ): Promise<BushMeshFileSendProgress | null> {
    const progress = manager.outgoingProgress(transferId);
    if (!progress) {
      return null;
    }

    const checkpoint = this.checkpoints.restore(transferId)?.checkpoint;
    if (!checkpoint) {
      return progress;
    }

    const pending = new Set(progress.pendingChunkIndexes);
    const acknowledged: number[] = [];
    for (let index = 0; index < progress.chunkCount; index += 1) {
      if (!pending.has(index)) {
        acknowledged.push(index);
      }
    }

    await this.checkpoints.updateProgress(
      transferId,
      acknowledged,
      progress.pendingChunkIndexes[0] ?? progress.chunkCount,
      now,
    );

    if (progress.complete) {
      await this.checkpoints.remove(transferId);
      this.restoredTransferIds = this.restoredTransferIds.filter(
        id => id !== transferId,
      );
    }

    return progress;
  }

  async cancel(
    manager: BushMeshFileTransferManager,
    transferId: number,
  ): Promise<boolean> {
    const cancelled = manager.cancel(transferId);
    const removed = await this.checkpoints.remove(transferId);
    this.restoredTransferIds = this.restoredTransferIds.filter(
      id => id !== transferId,
    );
    return cancelled || removed;
  }

  async prune(now = Date.now()): Promise<number[]> {
    const removed = await this.checkpoints.prune(now);
    if (removed.length > 0) {
      const removedSet = new Set(removed);
      this.restoredTransferIds = this.restoredTransferIds.filter(
        id => !removedSet.has(id),
      );
    }
    return removed;
  }

  snapshot(manager: BushMeshFileTransferManager): BushMeshPersistentFileCoordinatorSnapshot {
    return {
      restoredTransferIds: [...this.restoredTransferIds],
      activeTransferIds: manager.activeOutgoingTransferIds(),
    };
  }
}
