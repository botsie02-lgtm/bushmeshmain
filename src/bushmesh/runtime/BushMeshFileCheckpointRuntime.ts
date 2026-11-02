import {Buffer} from 'buffer';

import {
  BushMeshFileContentType,
  PreparedBushMeshFileTransfer,
  decodeFileAck,
  decodeFileResumeRequest,
  prepareFileTransfer,
} from '../protocol';

export type BushMeshFileTransferCheckpoint = {
  transferId: number;
  dataBase64: string;
  chunkSize: number;
  contentType: BushMeshFileContentType | number;
  fileName?: string;
  acknowledgedChunkIndexes: number[];
  nextMissingChunkIndex: number;
  createdAt: number;
  updatedAt: number;
};

export type BushMeshFileCheckpointStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

export type BushMeshRestoredFileTransfer = {
  checkpoint: BushMeshFileTransferCheckpoint;
  transfer: PreparedBushMeshFileTransfer;
};

export type BushMeshFileCheckpointLimits = {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxTransfers?: number;
  maxAgeMs?: number;
};

const SNAPSHOT_VERSION = 1;
const DEFAULT_STORE_KEY = 'bushmesh.fileTransfers.v1';
const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024;
const DEFAULT_MAX_TRANSFERS = 8;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class BushMeshFileCheckpointRuntime {
  private readonly checkpoints = new Map<number, BushMeshFileTransferCheckpoint>();
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;
  private readonly maxTransfers: number;
  private readonly maxAgeMs: number;

  constructor(
    private readonly store?: BushMeshFileCheckpointStore,
    private readonly storeKey = DEFAULT_STORE_KEY,
    limits?: BushMeshFileCheckpointLimits,
  ) {
    this.maxFileBytes = limits?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxTotalBytes = limits?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.maxTransfers = limits?.maxTransfers ?? DEFAULT_MAX_TRANSFERS;
    this.maxAgeMs = limits?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

    for (const [label, value] of [
      ['maxFileBytes', this.maxFileBytes],
      ['maxTotalBytes', this.maxTotalBytes],
      ['maxTransfers', this.maxTransfers],
      ['maxAgeMs', this.maxAgeMs],
    ] as const) {
      if (!Number.isFinite(value) || value < 1) {
        throw new Error(`BushMesh file checkpoint ${label} must be positive.`);
      }
    }
  }

  async initialize(now = Date.now()): Promise<number> {
    if (!this.store) {
      return 0;
    }

    const raw = await this.store.getItem(this.storeKey);
    if (!raw) {
      return 0;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Stored BushMesh file checkpoints are invalid JSON.');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Stored BushMesh file checkpoints have invalid shape.');
    }

    const snapshot = parsed as {
      version?: number;
      checkpoints?: BushMeshFileTransferCheckpoint[];
    };

    if (
      snapshot.version !== SNAPSHOT_VERSION ||
      !Array.isArray(snapshot.checkpoints)
    ) {
      throw new Error('Unsupported BushMesh file checkpoint snapshot.');
    }

    this.checkpoints.clear();
    for (const checkpoint of snapshot.checkpoints) {
      try {
        this.validate(checkpoint);
      } catch {
        continue;
      }

      if (now - checkpoint.updatedAt > this.maxAgeMs) {
        continue;
      }

      const dataBytes = this.dataByteLength(checkpoint);
      if (dataBytes > this.maxFileBytes) {
        continue;
      }

      this.checkpoints.set(checkpoint.transferId, this.clone(checkpoint));
    }

    const trimmed = this.trimToLimits(now);
    if (trimmed.length > 0 || this.checkpoints.size !== snapshot.checkpoints.length) {
      await this.persist();
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
    if (data.length > this.maxFileBytes) {
      throw new Error(
        `BushMesh file checkpoint payload exceeds ${this.maxFileBytes} bytes.`,
      );
    }

    const transfer = prepareFileTransfer(transferId, data, options);
    const now = options?.now ?? Date.now();
    const checkpoint: BushMeshFileTransferCheckpoint = {
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
    this.trimToLimits(now);

    if (!this.checkpoints.has(transferId)) {
      throw new Error(
        'BushMesh file checkpoint could not be retained within the configured storage limits.',
      );
    }

    await this.persist();
    return {checkpoint: this.clone(checkpoint), transfer};
  }

  restore(transferId: number): BushMeshRestoredFileTransfer | null {
    const checkpoint = this.checkpoints.get(transferId);
    if (!checkpoint) {
      return null;
    }

    const data = Array.from(Buffer.from(checkpoint.dataBase64, 'base64'));
    if (data.length > this.maxFileBytes) {
      return null;
    }

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
      Math.max(checkpoint.nextMissingChunkIndex, ack.baseChunkIndex + ack.bitCount);
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

  progress(transferId: number): {
    acknowledgedChunks: number;
    nextMissingChunkIndex: number;
    complete: boolean;
  } | null {
    const restored = this.restore(transferId);
    if (!restored) {
      return null;
    }

    const acknowledged = new Set(restored.checkpoint.acknowledgedChunkIndexes);
    const chunkCount = restored.transfer.chunkFrames.length;
    return {
      acknowledgedChunks: acknowledged.size,
      nextMissingChunkIndex: restored.checkpoint.nextMissingChunkIndex,
      complete: chunkCount === 0 || acknowledged.size >= chunkCount,
    };
  }

  async prune(now = Date.now()): Promise<number[]> {
    const removed = this.trimToLimits(now);
    if (removed.length > 0) {
      await this.persist();
    }
    return removed;
  }

  async remove(transferId: number): Promise<boolean> {
    const removed = this.checkpoints.delete(transferId);
    if (removed) {
      await this.persist();
    }
    return removed;
  }

  snapshot(): BushMeshFileTransferCheckpoint[] {
    return Array.from(this.checkpoints.values()).map(checkpoint =>
      this.clone(checkpoint),
    );
  }

  private require(transferId: number): BushMeshFileTransferCheckpoint {
    const checkpoint = this.checkpoints.get(transferId);
    if (!checkpoint) {
      throw new Error(`Unknown BushMesh file checkpoint ${transferId}.`);
    }
    return checkpoint;
  }

  private dataByteLength(checkpoint: BushMeshFileTransferCheckpoint): number {
    return Buffer.from(checkpoint.dataBase64, 'base64').length;
  }

  private validate(checkpoint: BushMeshFileTransferCheckpoint): void {
    if (!Number.isInteger(checkpoint.transferId) || checkpoint.transferId < 0) {
      throw new Error('Stored file transfer ID is invalid.');
    }
    if (!checkpoint.dataBase64 || typeof checkpoint.dataBase64 !== 'string') {
      throw new Error('Stored file transfer data is missing.');
    }
    if (!Number.isInteger(checkpoint.chunkSize) || checkpoint.chunkSize < 1) {
      throw new Error('Stored file chunk size is invalid.');
    }
    if (
      typeof checkpoint.contentType !== 'number' ||
      !Number.isFinite(checkpoint.contentType)
    ) {
      throw new Error('Stored file content type is invalid.');
    }
    if (
      checkpoint.fileName !== undefined &&
      typeof checkpoint.fileName !== 'string'
    ) {
      throw new Error('Stored file name is invalid.');
    }
    if (!Array.isArray(checkpoint.acknowledgedChunkIndexes)) {
      throw new Error('Stored acknowledged chunk indexes are invalid.');
    }
    for (const index of checkpoint.acknowledgedChunkIndexes) {
      if (!Number.isInteger(index) || index < 0) {
        throw new Error('Stored acknowledged chunk index is invalid.');
      }
    }
    if (
      !Number.isInteger(checkpoint.nextMissingChunkIndex) ||
      checkpoint.nextMissingChunkIndex < 0
    ) {
      throw new Error('Stored next missing chunk index is invalid.');
    }
    if (
      !Number.isFinite(checkpoint.createdAt) ||
      checkpoint.createdAt < 0 ||
      !Number.isFinite(checkpoint.updatedAt) ||
      checkpoint.updatedAt < checkpoint.createdAt
    ) {
      throw new Error('Stored file checkpoint timestamps are invalid.');
    }

    const data = Array.from(Buffer.from(checkpoint.dataBase64, 'base64'));
    if (data.length > this.maxFileBytes) {
      throw new Error('Stored file checkpoint exceeds maximum file size.');
    }

    const transfer = prepareFileTransfer(checkpoint.transferId, data, {
      chunkSize: checkpoint.chunkSize,
      contentType: checkpoint.contentType,
      fileName: checkpoint.fileName,
    });
    const chunkCount = transfer.chunkFrames.length;

    for (const index of checkpoint.acknowledgedChunkIndexes) {
      if (index >= chunkCount) {
        throw new Error('Stored acknowledged chunk index exceeds transfer size.');
      }
    }
    if (checkpoint.nextMissingChunkIndex > chunkCount) {
      throw new Error('Stored next missing chunk index exceeds transfer size.');
    }
  }

  private trimToLimits(now = Date.now()): number[] {
    const removed: number[] = [];

    for (const [transferId, checkpoint] of this.checkpoints.entries()) {
      if (
        now - checkpoint.updatedAt > this.maxAgeMs ||
        this.dataByteLength(checkpoint) > this.maxFileBytes
      ) {
        this.checkpoints.delete(transferId);
        removed.push(transferId);
      }
    }

    const ordered = Array.from(this.checkpoints.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    let totalBytes = 0;

    for (let index = 0; index < ordered.length; index += 1) {
      const checkpoint = ordered[index];
      const bytes = this.dataByteLength(checkpoint);
      const retain =
        index < this.maxTransfers && totalBytes + bytes <= this.maxTotalBytes;

      if (retain) {
        totalBytes += bytes;
        continue;
      }

      if (this.checkpoints.delete(checkpoint.transferId)) {
        removed.push(checkpoint.transferId);
      }
    }

    return Array.from(new Set(removed));
  }

  private clone(
    checkpoint: BushMeshFileTransferCheckpoint,
  ): BushMeshFileTransferCheckpoint {
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
      this.storeKey,
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        checkpoints: this.snapshot(),
      }),
    );
  }
}
