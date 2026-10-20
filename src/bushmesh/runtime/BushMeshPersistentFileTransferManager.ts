import {
  BushMeshFileContentType,
  BushMeshFileFrameType,
  BushMeshFileSendProgress,
  decodeFileChunk,
  decodeFileEnd,
  decodeFileStart,
} from '../protocol';
import {
  BushMeshFileCheckpointStore,
} from './BushMeshFileCheckpointRuntime';
import {
  BushMeshFileManagerResult,
  BushMeshFileTransferManager,
} from './BushMeshFileTransferManager';
import {BushMeshPersistentFileCoordinator} from './BushMeshPersistentFileCoordinator';

type IncomingCheckpoint = {
  transferId: number;
  startFrame: number[];
  chunkFrames: Array<{index: number; frame: number[]}>;
  updatedAt: number;
};

type IncomingSnapshot = {
  version: 1;
  sessions: IncomingCheckpoint[];
};

const DEFAULT_INCOMING_KEY = 'bushmesh.incomingFileTransfers.v1';
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 8;

/**
 * File manager with durable sender and receiver state. Incoming sessions persist
 * the original protocol frames, then reconstruct the normal receiver by replaying
 * them at startup. This avoids maintaining a second file-reassembly algorithm.
 */
export class BushMeshPersistentFileTransferManager extends BushMeshFileTransferManager {
  readonly outgoingPersistence: BushMeshPersistentFileCoordinator;

  private readonly incomingCheckpoints = new Map<number, IncomingCheckpoint>();
  private persistenceChain: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(
    private readonly store?: BushMeshFileCheckpointStore,
    private readonly incomingStoreKey = DEFAULT_INCOMING_KEY,
    private readonly maxIncomingAgeMs = DEFAULT_MAX_AGE_MS,
    private readonly maxIncomingSessions = DEFAULT_MAX_SESSIONS,
  ) {
    super();
    this.outgoingPersistence = new BushMeshPersistentFileCoordinator(store);
  }

  async initialize(now = Date.now()): Promise<{
    outgoingTransferIds: number[];
    incomingTransferIds: number[];
  }> {
    if (this.initialized) {
      return {
        outgoingTransferIds: this.activeOutgoingTransferIds(),
        incomingTransferIds: this.activeIncomingTransferIds(),
      };
    }

    const outgoingTransferIds = await this.outgoingPersistence.initialize(this, now);
    const incomingTransferIds = await this.restoreIncoming(now);
    this.initialized = true;
    return {outgoingTransferIds, incomingTransferIds};
  }

  async createOutgoingPersistent(
    transferId: number,
    data: number[],
    options?: {
      chunkSize?: number;
      contentType?: BushMeshFileContentType | number;
      fileName?: string;
      now?: number;
    },
  ): Promise<BushMeshFileSendProgress> {
    return this.outgoingPersistence.registerOutgoing(
      this,
      transferId,
      data,
      options,
    );
  }

  override acceptFrame(frame: number[]): BushMeshFileManagerResult {
    const now = Date.now();

    if (frame[0] === BushMeshFileFrameType.Start) {
      const metadata = decodeFileStart(frame);
      const existing = this.incomingCheckpoints.get(metadata.transferId);

      // Restored senders deliberately re-announce FILE_START. If this receiver
      // retained the same transfer, keep all reconstructed chunks intact.
      if (existing && this.sameStart(existing.startFrame, frame)) {
        existing.updatedAt = now;
        this.queueIncomingPersist(now);
        return {
          transferId: metadata.transferId,
          event: 'started',
          responseFrames: [],
          progress: this.incomingProgress(metadata.transferId) ?? undefined,
        };
      }
    }

    const result = super.acceptFrame(frame);

    try {
      switch (frame[0]) {
        case BushMeshFileFrameType.Start:
          this.rememberIncomingStart(frame, now);
          break;
        case BushMeshFileFrameType.Chunk:
          this.rememberIncomingChunk(frame, now);
          break;
        case BushMeshFileFrameType.Ack:
        case BushMeshFileFrameType.ResumeRequest:
          this.queueOutgoingProgress(result.transferId, now);
          break;
        case BushMeshFileFrameType.End:
          if (result.event === 'complete') {
            this.incomingCheckpoints.delete(decodeFileEnd(frame).transferId);
          }
          break;
      }
    } finally {
      this.queueIncomingPersist(now);
    }

    return result;
  }

  async recordOutgoingProgress(
    transferId: number,
    now = Date.now(),
  ): Promise<BushMeshFileSendProgress | null> {
    return this.outgoingPersistence.recordProgress(this, transferId, now);
  }

  async cancelPersistent(transferId: number): Promise<boolean> {
    const hadIncoming = this.incomingCheckpoints.delete(transferId);
    const cancelledOutgoing = await this.outgoingPersistence.cancel(this, transferId);
    const cancelledRuntime = super.cancel(transferId);
    await this.persistIncoming();
    return hadIncoming || cancelledOutgoing || cancelledRuntime;
  }

  async flushPersistence(): Promise<void> {
    await this.persistenceChain;
  }

  private rememberIncomingStart(frame: number[], now: number): void {
    const metadata = decodeFileStart(frame);
    this.incomingCheckpoints.set(metadata.transferId, {
      transferId: metadata.transferId,
      startFrame: [...frame],
      chunkFrames: [],
      updatedAt: now,
    });
    this.trimIncoming(now);
  }

  private rememberIncomingChunk(frame: number[], now: number): void {
    const chunk = decodeFileChunk(frame);
    const session = this.incomingCheckpoints.get(chunk.transferId);
    if (!session) {
      return;
    }

    const existing = session.chunkFrames.find(item => item.index === chunk.chunkIndex);
    if (!existing) {
      session.chunkFrames.push({index: chunk.chunkIndex, frame: [...frame]});
      session.chunkFrames.sort((a, b) => a.index - b.index);
    }
    session.updatedAt = now;
  }

  private queueOutgoingProgress(transferId: number, now: number): void {
    this.persistenceChain = this.persistenceChain
      .then(async () => {
        await this.outgoingPersistence.recordProgress(this, transferId, now);
      })
      .catch(() => undefined);
  }

  private queueIncomingPersist(now: number): void {
    this.trimIncoming(now);
    this.persistenceChain = this.persistenceChain
      .then(() => this.persistIncoming())
      .catch(() => undefined);
  }

  private async restoreIncoming(now: number): Promise<number[]> {
    if (!this.store) {
      return [];
    }

    const raw = await this.store.getItem(this.incomingStoreKey);
    if (!raw) {
      return [];
    }

    let snapshot: IncomingSnapshot;
    try {
      snapshot = JSON.parse(raw) as IncomingSnapshot;
    } catch {
      await this.clearIncomingStore();
      return [];
    }

    if (snapshot.version !== 1 || !Array.isArray(snapshot.sessions)) {
      await this.clearIncomingStore();
      return [];
    }

    const restored: number[] = [];
    this.incomingCheckpoints.clear();

    for (const saved of snapshot.sessions) {
      if (
        !saved ||
        !Number.isInteger(saved.transferId) ||
        !Array.isArray(saved.startFrame) ||
        !Array.isArray(saved.chunkFrames) ||
        !Number.isFinite(saved.updatedAt) ||
        now - saved.updatedAt > this.maxIncomingAgeMs
      ) {
        continue;
      }

      try {
        const metadata = decodeFileStart(saved.startFrame);
        if (metadata.transferId !== saved.transferId) {
          continue;
        }

        super.acceptFrame(saved.startFrame);
        const validChunks: Array<{index: number; frame: number[]}> = [];
        for (const item of saved.chunkFrames.sort((a, b) => a.index - b.index)) {
          const chunk = decodeFileChunk(item.frame);
          if (chunk.transferId !== saved.transferId || chunk.chunkIndex !== item.index) {
            continue;
          }
          super.acceptFrame(item.frame);
          validChunks.push({index: item.index, frame: [...item.frame]});
        }

        this.incomingCheckpoints.set(saved.transferId, {
          transferId: saved.transferId,
          startFrame: [...saved.startFrame],
          chunkFrames: validChunks,
          updatedAt: saved.updatedAt,
        });
        restored.push(saved.transferId);
      } catch {
        super.cancel(saved.transferId);
      }
    }

    this.trimIncoming(now);
    await this.persistIncoming();
    return restored.sort((a, b) => a - b);
  }

  private sameStart(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  private trimIncoming(now: number): void {
    for (const [transferId, session] of this.incomingCheckpoints.entries()) {
      if (now - session.updatedAt > this.maxIncomingAgeMs) {
        this.incomingCheckpoints.delete(transferId);
        super.cancel(transferId);
      }
    }

    while (this.incomingCheckpoints.size > this.maxIncomingSessions) {
      const oldest = Array.from(this.incomingCheckpoints.values()).sort(
        (a, b) => a.updatedAt - b.updatedAt,
      )[0];
      if (!oldest) {
        break;
      }
      this.incomingCheckpoints.delete(oldest.transferId);
      super.cancel(oldest.transferId);
    }
  }

  private async persistIncoming(): Promise<void> {
    if (!this.store) {
      return;
    }

    const snapshot: IncomingSnapshot = {
      version: 1,
      sessions: Array.from(this.incomingCheckpoints.values()).map(session => ({
        transferId: session.transferId,
        startFrame: [...session.startFrame],
        chunkFrames: session.chunkFrames.map(item => ({
          index: item.index,
          frame: [...item.frame],
        })),
        updatedAt: session.updatedAt,
      })),
    };
    await this.store.setItem(this.incomingStoreKey, JSON.stringify(snapshot));
  }

  private async clearIncomingStore(): Promise<void> {
    this.incomingCheckpoints.clear();
    if (!this.store) {
      return;
    }
    if (this.store.removeItem) {
      await this.store.removeItem(this.incomingStoreKey);
    } else {
      await this.store.setItem(this.incomingStoreKey, '');
    }
  }
}
