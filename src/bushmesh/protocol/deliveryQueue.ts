import {
  BushMeshPriority,
  assertBytes,
  assertIntegerInRange,
} from './codec';

export type BushMeshQueuedMessage = {
  messageId: number;
  wireBytes: number[];
  priority: BushMeshPriority | number;
  createdAt: number;
  expiresAt: number;
  nextAttemptAt: number;
  attempts: number;
  maxAttempts: number;
};

export type BushMeshQueueEnqueueOptions = {
  priority?: BushMeshPriority | number;
  now?: number;
  ttlMs?: number;
  maxAttempts?: number;
};

export class BushMeshDeliveryQueue {
  private readonly messages = new Map<number, BushMeshQueuedMessage>();

  enqueue(
    messageId: number,
    wireBytes: number[],
    options?: BushMeshQueueEnqueueOptions,
  ): BushMeshQueuedMessage {
    assertIntegerInRange(messageId, 0, 0xffffffff, 'Message ID');
    assertBytes(wireBytes, 'wire bytes');

    const existing = this.messages.get(messageId);

    if (existing) {
      return {...existing, wireBytes: [...existing.wireBytes]};
    }

    const now = options?.now ?? Date.now();
    const ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000;
    const maxAttempts = options?.maxAttempts ?? 8;
    const priority = options?.priority ?? BushMeshPriority.DirectMessage;

    assertIntegerInRange(priority, 0, 7, 'Priority');
    assertIntegerInRange(maxAttempts, 1, 255, 'Max attempts');

    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('Queue TTL must be greater than zero.');
    }

    const message: BushMeshQueuedMessage = {
      messageId,
      wireBytes: [...wireBytes],
      priority,
      createdAt: now,
      expiresAt: now + ttlMs,
      nextAttemptAt: now,
      attempts: 0,
      maxAttempts,
    };

    this.messages.set(messageId, message);
    return {...message, wireBytes: [...message.wireBytes]};
  }

  ready(now = Date.now()): BushMeshQueuedMessage[] {
    this.pruneExpired(now);

    return Array.from(this.messages.values())
      .filter(
        message =>
          message.nextAttemptAt <= now && message.attempts < message.maxAttempts,
      )
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }

        if (a.createdAt !== b.createdAt) {
          return a.createdAt - b.createdAt;
        }

        return a.messageId - b.messageId;
      })
      .map(message => ({...message, wireBytes: [...message.wireBytes]}));
  }

  next(now = Date.now()): BushMeshQueuedMessage | null {
    return this.ready(now)[0] ?? null;
  }

  markAttempt(
    messageId: number,
    options?: {now?: number; retryDelayMs?: number},
  ): BushMeshQueuedMessage | null {
    const message = this.messages.get(messageId);

    if (!message) {
      return null;
    }

    const now = options?.now ?? Date.now();
    const retryDelayMs = options?.retryDelayMs ?? 30000;

    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
      throw new Error('Retry delay cannot be negative.');
    }

    message.attempts += 1;
    message.nextAttemptAt = now + retryDelayMs;

    return {...message, wireBytes: [...message.wireBytes]};
  }

  acknowledge(messageId: number): boolean {
    return this.messages.delete(messageId);
  }

  pruneExpired(now = Date.now()): number[] {
    const removed: number[] = [];

    for (const [messageId, message] of this.messages.entries()) {
      if (message.expiresAt <= now || message.attempts >= message.maxAttempts) {
        this.messages.delete(messageId);
        removed.push(messageId);
      }
    }

    return removed;
  }

  has(messageId: number): boolean {
    return this.messages.has(messageId);
  }

  size(): number {
    return this.messages.size;
  }

  snapshot(): BushMeshQueuedMessage[] {
    return Array.from(this.messages.values()).map(message => ({
      ...message,
      wireBytes: [...message.wireBytes],
    }));
  }

  clear(): void {
    this.messages.clear();
  }
}
