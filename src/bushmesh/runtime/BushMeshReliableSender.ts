import {decodeBushMeshWire} from '../protocol';
import {
  BushMeshNetworkRuntime,
  BushMeshRuntimeSendResult,
} from './BushMeshNetworkRuntime';
import {
  BushMeshStoreForwardFlushResult,
  BushMeshStoreForwardItem,
  BushMeshStoreForwardRuntime,
} from './BushMeshStoreForwardRuntime';

export type BushMeshReliableSendResult =
  | {
      state: 'sent';
      result: BushMeshRuntimeSendResult;
      queuedId?: never;
    }
  | {
      state: 'queued';
      queuedId: string;
      result?: never;
    };

export class BushMeshReliableSender {
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushInProgress = false;

  constructor(
    readonly network: BushMeshNetworkRuntime,
    readonly storeForward: BushMeshStoreForwardRuntime,
  ) {}

  async queueWire(
    channelIndex: number,
    wireBytes: number[],
    options?: {
      queueTtlMs?: number;
      maxQueueAttempts?: number;
    },
  ): Promise<BushMeshReliableSendResult> {
    const decoded = decodeBushMeshWire(wireBytes);
    if (!decoded.envelope.storeAndForward) {
      throw new Error('BushMesh packet must enable store-and-forward before durable queueing.');
    }

    const queued = await this.storeForward.enqueue(channelIndex, wireBytes, {
      ttlMs: options?.queueTtlMs,
      maxAttempts: options?.maxQueueAttempts,
    });
    return {state: 'queued', queuedId: queued.id};
  }

  async sendWireOrQueue(
    channelIndex: number,
    wireBytes: number[],
    options?: {
      queueTtlMs?: number;
      maxQueueAttempts?: number;
    },
  ): Promise<BushMeshReliableSendResult> {
    const decoded = decodeBushMeshWire(wireBytes);

    try {
      const result = await this.network.sendWire(channelIndex, wireBytes);
      return {state: 'sent', result};
    } catch (error) {
      if (!decoded.envelope.storeAndForward) {
        throw error;
      }

      return this.queueWire(channelIndex, wireBytes, options);
    }
  }

  async flush(
    options?: {
      maxMessages?: number;
      baseRetryDelayMs?: number;
      maxRetryDelayMs?: number;
      canSend?: (item: BushMeshStoreForwardItem) => boolean | Promise<boolean>;
    },
  ): Promise<BushMeshStoreForwardFlushResult> {
    if (this.flushInProgress) {
      return {sentIds: [], failedIds: [], expiredIds: []};
    }

    this.flushInProgress = true;
    try {
      return await this.storeForward.flush(options);
    } finally {
      this.flushInProgress = false;
    }
  }

  startAutoFlush(intervalMs = 5000): void {
    if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
      throw new Error('Reliable sender flush interval must be at least one second.');
    }

    this.stopAutoFlush();
    this.flushTimer = setInterval(() => {
      if (!this.network.isRunning()) {
        return;
      }
      void this.flush();
    }, intervalMs);
  }

  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  stop(): void {
    this.stopAutoFlush();
  }
}
