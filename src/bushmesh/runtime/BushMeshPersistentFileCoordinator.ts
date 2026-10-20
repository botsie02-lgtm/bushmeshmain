import {
  BushMeshFileContentType,
  BushMeshFileSendProgress,
  encodeFileAck,
  encodeFileResumeRequest,
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

      // Re-send FILE_START after process restart. A peer that retained receive
      // state can treat it idempotently, while a restarted peer can recreate its
      // receiver before missing chunks are retried.
      manager.restoreOutgoing(
        saved.transfer,
        checkpoint.acknowledgedChunkIndexes,
        false,
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

    // Persist ACK state in the same 64-chunk windows used over the wire. This
    // keeps checkpoint semantics aligned with the actual FILE_ACK protocol.
    for (let base = 0; base < progress.chunkCount; base += 64) {
      const bitCount = Math.min(64, progress.chunkCount - base);
      const received: number[] = [];

      for (let index = base; index < base + bitCount; index += 1) {
        if (!pending.has(index)) {
          received.push(index);
        }
      }

      await this.checkpoints.applyAckFrame(
        encodeFileAck(transferId, base, bitCount, received),
        now,
      );
    }

    // ACK windows can advance independently, so finish by pinning the resume
    // cursor to the true first missing chunk from the live sender state.
    await this.checkpoints.applyResumeFrame(
      encodeFileResumeRequest({
        transferId,
        nextMissingChunkIndex:
          progress.pendingChunkIndexes[0] ?? progress.chunkCount,
      }),
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
