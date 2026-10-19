import {Buffer} from 'buffer';

import {
  BushMeshFileContentType,
  PreparedBushMeshFileTransfer,
  decodeFileAck,
  decodeFileResumeRequest,
  prepareFileTransfer,
} from '../protocol';

export type BushMeshFileCheckpointStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

export type BushMeshOutgoingFileCheckpoint = {
  transferId: number;
  dataBase64: string;
  chunkSize: number;
  contentType: number;
  fileName?: string;
  acknowledgedChunkIndexes: number[];
  nextMissingChunkIndex: number;
  createdAt: number;
  updatedAt: number;
};

export type BushMeshRestoredFileTransfer = {
  checkpoint: BushMeshOutgoingFileCheckpoint;
  transfer: PreparedBushMeshFileTransfer;
};

const CHECKPOINT_VERSION = 1;
const DEFAULT_KEY = 'bushmesh.fileCheckpoints.v1';

export class BushMeshFileCheckpointRuntime {
  private readonly checkpoints = new Map<number, BushMeshOutgoingFileCheckpoint>();

  constructor(
    private readonly store?: BushMeshFileCheckpointStore,
    private readonly key = DEFAULT_KEY,
  ) {}

  async initialize(): Promise<number> {
    if (!this.store) {
      return 0;
    }

    const raw = await this.store.getItem(this.key);
    if (!raw) {
      return 0;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Stored BushMesh file checkpoints are invalid JSON.');
    }

    const envelope = parsed as {
      version?: number;
      checkpoints?: BushMeshOutgoingFileCheckpoint[];
    };

    if (
      !envelope ||
      envelope.version !== CHECKPOINT_VERSION ||
      !Array.isArray(envelope.checkpoints)
    ) {
      throw new Error('Stored BushMesh file checkpoint version is unsupported.');
    }

    this.checkpoints.clear();
    for (const checkpoint of envelope.checkpoints) {
      this.validateCheckpoint(checkpoint);
      this.checkpoints.set(checkpoint.transferId, this.clone(checkpoint));
    }

    return this.checkpoints.size;
  }

  async create(
    transferId: number,
    data: number[],
    options?: {
      chunkSize?: number;
      contentType?: BushMeshFileContentType | number;
      fileName?: string;
      now?: number;
    },
  ): Promise<BushMeshRestoredFileTransfer> {
    const transfer = prepareFileTransfer(transferId, data, options);
    const now = options?.now ?? Date.now();
    const checkpoint: BushMeshOutgoingFileCheckpoint = {
      transferId,
      dataBase64: Buffer.from(data).toString('base64'),
      chunkSize: transfer.metadata.chunkSize,
      contentType: transfer.metadata.contentType,
      fileName: transfer.metadata.fileName,
      acknowledgedChunkIndexes: [],
      nextMissingChunkIndex: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.checkpoints.set(transferId, checkpoint);
    await this.persist();
    return {checkpoint: this.clone(checkpoint), transfer};
  }

  restore(transferId: number): BushMeshRestoredFileTransfer | null {
    const checkpoint = this.checkpoints.get(transferId);
    if (!checkpoint) {
      return null;
    }

    const data = Array.from(Buffer.from(checkpoint.dataBase64, 'base64'));
    const transfer = prepareFileTransfer(transferId, data, {
      chunkSize: checkpoint.chunkSize,
      contentType: checkpoint.contentType,
      fileName: checkpoint.fileName,
    });

    return {checkpoint: this.clone(checkpoint), transfer};
  }

  async applyAckFrame(ackFrame: number[], now = Date.now()): Promise<void> {
    const ack = decodeFileAck(ackFrame);
    const checkpoint = this.require(ack.transferId);
    const acknowledged = new Set(checkpoint.acknowledgedChunkIndexes);

    for (const index of ack.receivedChunkIndexes) {
      acknowledged.add(index);
    }

    checkpoint.acknowledgedChunkIndexes = Array.from(acknowledged).sort(
      (a, b) => a - b,
    );
    checkpoint.nextMissingChunkIndex =
      ack.missingChunkIndexes[0] ??
      Math.max(checkpoint.nextMissingChunkIndex, ack.baseChunkIndex + ack.windowSize);
    checkpoint.updatedAt = now;
    await this.persist();
  }

  async applyResumeFrame(
    resumeFrame: number[],
    now = Date.now(),
  ): Promise<void> {
    const request = decodeFileResumeRequest(resumeFrame);
    const checkpoint = this.require(request.transferId);
    checkpoint.nextMissingChunkIndex = request.nextMissingChunkIndex;
    checkpoint.updatedAt = now;
    await this.persist();
  }

  pendingChunkFrames(
    transferId: number,
    maxFrames = 16,
  ): Array<{chunkIndex: number; frame: number[]}> {
    const restored = this.restore(transferId);
    if (!restored) {
      return [];
    }

    const acknowledged = new Set(
      restored.checkpoint.acknowledgedChunkIndexes,
    );
    const frames: Array<{chunkIndex: number; frame: number[]}> = [];

    for (
      let index = restored.checkpoint.nextMissingChunkIndex;
      index < restored.transfer.chunkFrames.length;
      index += 1
    ) {
      if (acknowledged.has(index)) {
        continue;
      }

      frames.push({
        chunkIndex: index,
        frame: [...restored.transfer.chunkFrames[index]],
      });

      if (frames.length >= maxFrames) {
        break;
      }
    }

    return frames;
  }

  startFrame(transferId: number): number[] | null {
    return this.restore(transferId)?.transfer.startFrame ?? null;
  }

  endFrame(transferId: number): number[] | null {
    return this.restore(transferId)?.transfer.endFrame ?? null;
  }

  async complete(transferId: number): Promise<boolean> {
    const removed = this.checkpoints.delete(transferId);
    if (removed) {
      await this.persist();
    }
    return removed;
  }

  list(): BushMeshOutgoingFileCheckpoint[] {
    return Array.from(this.checkpoints.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(checkpoint => this.clone(checkpoint));
  }

  private require(transferId: number): BushMeshOutgoingFileCheckpoint {
    const checkpoint = this.checkpoints.get(transferId);
    if (!checkpoint) {
      throw new Error(`Unknown BushMesh file checkpoint ${transferId}.`);
    }
    return checkpoint;
  }

  private validateCheckpoint(checkpoint: BushMeshOutgoingFileCheckpoint): void {
    if (!Number.isInteger(checkpoint.transferId) || checkpoint.transferId < 0) {
      throw new Error('Stored file checkpoint transfer ID is invalid.');
    }
    if (!checkpoint.dataBase64 || !Number.isInteger(checkpoint.chunkSize)) {
      throw new Error('Stored file checkpoint payload metadata is invalid.');
    }
    if (
      !Array.isArray(checkpoint.acknowledgedChunkIndexes) ||
      !Number.isInteger(checkpoint.nextMissingChunkIndex)
    ) {
      throw new Error('Stored file checkpoint progress is invalid.');
    }

    // Validate that the payload can still reconstruct the same deterministic
    // transfer metadata before accepting the checkpoint into runtime state.
    const data = Array.from(Buffer.from(checkpoint.dataBase64, 'base64'));
    prepareFileTransfer(checkpoint.transferId, data, {
      chunkSize: checkpoint.chunkSize,
      contentType: checkpoint.contentType,
      fileName: checkpoint.fileName,
    });
  }

  private clone(
    checkpoint: BushMeshOutgoingFileCheckpoint,
  ): BushMeshOutgoingFileCheckpoint {
    return {
      ...checkpoint,
      acknowledgedChunkIndexes: [...checkpoint.acknowledgedChunkIndexes],
    };
  }

  private async persist(): Promise<void> {
    if (!this.store) {
      return;
    }

    await this.store.setItem(
      this.key,
      JSON.stringify({
        version: CHECKPOINT_VERSION,
        checkpoints: this.list(),
      }),
    );
  }
}
