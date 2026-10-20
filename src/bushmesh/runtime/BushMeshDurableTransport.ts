import {
  BushMeshPacketType,
  decodeBushMeshTextCarrier,
  decodeBushMeshWire,
} from '../protocol';
import {BushMeshOutbox, BushMeshOutboxFlushResult, BushMeshOutboxStore} from './BushMeshOutbox';
import {BushMeshRuntimeTransport} from './BushMeshNetworkRuntime';

export type BushMeshDurableTransportEvents = {
  onQueued?: (id: string, channelIndex: number) => void;
  onFlushed?: (result: BushMeshOutboxFlushResult) => void;
  onError?: (message: string) => void;
};

export type BushMeshDurableTransportSnapshot = {
  running: boolean;
  queuedFrames: number;
};

export class BushMeshDurableTransport {
  readonly outbox: BushMeshOutbox;
  readonly transport: BushMeshRuntimeTransport;

  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushInProgress = false;
  private running = false;

  constructor(
    private readonly baseTransport: BushMeshRuntimeTransport,
    store?: BushMeshOutboxStore,
    private readonly events: BushMeshDurableTransportEvents = {},
  ) {
    this.outbox = new BushMeshOutbox(store, 'bushmesh.transportOutbox.v1');
    this.transport = {
      sendTextChannelMessage: (channelIndex, text) =>
        this.sendTextOrQueue(channelIndex, text),
      sendBinaryChannelPayload: baseTransport.sendBinaryChannelPayload
        ? (channelIndex, payloadBytes) =>
            this.sendBinaryOrQueue(channelIndex, payloadBytes)
        : undefined,
    };
  }

  async initialize(now = Date.now()): Promise<number> {
    return this.outbox.initialize(now);
  }

  startAutoFlush(intervalMs = 5000): void {
    if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
      throw new Error('Durable transport flush interval must be at least one second.');
    }

    this.stopAutoFlush();
    this.running = true;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, intervalMs);
  }

  stopAutoFlush(): void {
    this.running = false;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async flush(): Promise<BushMeshOutboxFlushResult> {
    if (this.flushInProgress) {
      return {sentIds: [], failedIds: [], expiredIds: []};
    }

    this.flushInProgress = true;
    try {
      const result = await this.outbox.flush(this.baseTransport, {
        maxItems: 16,
        baseRetryDelayMs: 3000,
        maxRetryDelayMs: 5 * 60 * 1000,
      });

      if (
        result.sentIds.length > 0 ||
        result.failedIds.length > 0 ||
        result.expiredIds.length > 0
      ) {
        this.events.onFlushed?.(result);
      }

      return result;
    } finally {
      this.flushInProgress = false;
    }
  }

  stop(): void {
    this.stopAutoFlush();
  }

  snapshot(): BushMeshDurableTransportSnapshot {
    return {
      running: this.running,
      queuedFrames: this.outbox.size(),
    };
  }

  private async sendTextOrQueue(
    channelIndex: number,
    text: string,
  ): Promise<unknown> {
    try {
      return await this.baseTransport.sendTextChannelMessage(channelIndex, text);
    } catch (error) {
      const queuePolicy = this.textQueuePolicy(text);
      if (!queuePolicy) {
        throw error;
      }

      const queued = await this.outbox.enqueueText(channelIndex, text, {
        priority: queuePolicy.priority,
        ttlMs: queuePolicy.ttlMs,
      });
      this.events.onQueued?.(queued.id, channelIndex);
      this.events.onError?.(
        `BushMesh transport unavailable; queued frame ${queued.id} for retry.`,
      );
      return {queued: true, id: queued.id};
    }
  }

  private async sendBinaryOrQueue(
    channelIndex: number,
    payloadBytes: number[],
  ): Promise<unknown> {
    const sendBinary = this.baseTransport.sendBinaryChannelPayload;
    if (!sendBinary) {
      throw new Error('Binary BushMesh transport is unavailable.');
    }

    try {
      return await sendBinary(channelIndex, payloadBytes);
    } catch (error) {
      const queuePolicy = this.wireQueuePolicy(payloadBytes);
      if (!queuePolicy) {
        throw error;
      }

      const queued = await this.outbox.enqueueBinary(channelIndex, payloadBytes, {
        priority: queuePolicy.priority,
        ttlMs: queuePolicy.ttlMs,
      });
      this.events.onQueued?.(queued.id, channelIndex);
      this.events.onError?.(
        `BushMesh binary transport unavailable; queued frame ${queued.id} for retry.`,
      );
      return {queued: true, id: queued.id};
    }
  }

  private textQueuePolicy(
    text: string,
  ): {priority: number; ttlMs: number} | null {
    try {
      return this.wireQueuePolicy(decodeBushMeshTextCarrier(text));
    } catch {
      return null;
    }
  }

  private wireQueuePolicy(
    wireBytes: number[],
  ): {priority: number; ttlMs: number} | null {
    try {
      const decoded = decodeBushMeshWire(wireBytes);
      const isFragment = decoded.envelope.type === BushMeshPacketType.Fragment;

      if (!decoded.envelope.storeAndForward && !isFragment) {
        return null;
      }

      return {
        priority: decoded.envelope.priority,
        ttlMs: isFragment ? 10 * 60 * 1000 : 24 * 60 * 60 * 1000,
      };
    } catch {
      return null;
    }
  }
}
