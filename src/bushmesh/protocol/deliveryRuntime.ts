import {BushMeshDeliveryQueue, BushMeshQueueEnqueueOptions, BushMeshQueuedMessage} from './deliveryQueue';
import {BushMeshKeyValueStore, restoreDeliveryQueue, saveDeliveryQueue} from './persistence';

export type BushMeshDeliverySendResult = {
  sentMessageIds: number[];
  failedMessageIds: number[];
  expiredMessageIds: number[];
};

export type BushMeshDeliverySender = (
  message: BushMeshQueuedMessage,
) => Promise<void>;

export class BushMeshPersistentDeliveryRuntime {
  readonly queue: BushMeshDeliveryQueue;
  private initialized = false;

  constructor(
    private readonly store: BushMeshKeyValueStore,
    options?: {
      storageKey?: string;
      queue?: BushMeshDeliveryQueue;
      baseRetryDelayMs?: number;
      maxRetryDelayMs?: number;
    },
  ) {
    this.queue = options?.queue ?? new BushMeshDeliveryQueue();
    this.storageKey = options?.storageKey ?? 'bushmesh.deliveryQueue.v1';
    this.baseRetryDelayMs = options?.baseRetryDelayMs ?? 2000;
    this.maxRetryDelayMs = options?.maxRetryDelayMs ?? 5 * 60 * 1000;

    if (!Number.isFinite(this.baseRetryDelayMs) || this.baseRetryDelayMs < 0) {
      throw new Error('Base delivery retry delay cannot be negative.');
    }
    if (
      !Number.isFinite(this.maxRetryDelayMs) ||
      this.maxRetryDelayMs < this.baseRetryDelayMs
    ) {
      throw new Error('Maximum delivery retry delay is invalid.');
    }
  }

  private readonly storageKey: string;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;

  async initialize(now = Date.now()): Promise<number> {
    const restored = await restoreDeliveryQueue(this.queue, this.store, {
      key: this.storageKey,
      now,
    });
    this.initialized = true;
    await this.persist();
    return restored;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async enqueue(
    messageId: number,
    wireBytes: number[],
    options?: BushMeshQueueEnqueueOptions,
  ): Promise<BushMeshQueuedMessage> {
    const queued = this.queue.enqueue(messageId, wireBytes, options);
    await this.persist();
    return queued;
  }

  async acknowledge(messageId: number): Promise<boolean> {
    const removed = this.queue.acknowledge(messageId);
    if (removed) {
      await this.persist();
    }
    return removed;
  }

  async flushReady(
    sender: BushMeshDeliverySender,
    options?: {now?: number; maxMessages?: number},
  ): Promise<BushMeshDeliverySendResult> {
    const now = options?.now ?? Date.now();
    const maxMessages = options?.maxMessages ?? Number.POSITIVE_INFINITY;
    const expiredMessageIds = this.queue.pruneExpired(now);
    const sentMessageIds: number[] = [];
    const failedMessageIds: number[] = [];
    const ready = this.queue.ready(now).slice(0, maxMessages);

    for (const message of ready) {
      try {
        await sender(message);
        sentMessageIds.push(message.messageId);
        this.queue.acknowledge(message.messageId);
      } catch {
        failedMessageIds.push(message.messageId);
        const retryDelayMs = Math.min(
          this.maxRetryDelayMs,
          this.baseRetryDelayMs * Math.pow(2, message.attempts),
        );
        this.queue.markAttempt(message.messageId, {now, retryDelayMs});
      }
    }

    await this.persist();
    return {sentMessageIds, failedMessageIds, expiredMessageIds};
  }

  async markDisconnectedAttempt(
    messageId: number,
    now = Date.now(),
  ): Promise<BushMeshQueuedMessage | null> {
    const message = this.queue.snapshot().find(item => item.messageId === messageId);
    if (!message) {
      return null;
    }
    const retryDelayMs = Math.min(
      this.maxRetryDelayMs,
      this.baseRetryDelayMs * Math.pow(2, message.attempts),
    );
    const updated = this.queue.markAttempt(messageId, {now, retryDelayMs});
    await this.persist();
    return updated;
  }

  async clear(): Promise<void> {
    this.queue.clear();
    await this.persist();
  }

  private async persist(): Promise<void> {
    await saveDeliveryQueue(this.queue, this.store, this.storageKey);
  }
}
