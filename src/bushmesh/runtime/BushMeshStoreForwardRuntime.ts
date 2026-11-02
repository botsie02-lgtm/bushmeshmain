import {
  BushMeshPriority,
  decodeBushMeshWire,
} from '../protocol';
import {BushMeshNetworkRuntime} from './BushMeshNetworkRuntime';

export type BushMeshStoreForwardItem = {
  id: string;
  channelIndex: number;
  wireBytes: number[];
  priority: number;
  createdAt: number;
  expiresAt: number;
  nextAttemptAt: number;
  attempts: number;
  maxAttempts: number;
};

export type BushMeshStoreForwardStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

export type BushMeshStoreForwardFlushResult = {
  sentIds: string[];
  failedIds: string[];
  expiredIds: string[];
  deferredIds?: string[];
};

const STORE_VERSION = 1;
const DEFAULT_STORE_KEY = 'bushmesh.storeForward.v1';

function cloneItem(item: BushMeshStoreForwardItem): BushMeshStoreForwardItem {
  return {...item, wireBytes: [...item.wireBytes]};
}

export class BushMeshStoreForwardRuntime {
  private readonly items = new Map<string, BushMeshStoreForwardItem>();
  private sequence = 1;

  constructor(
    private readonly network: BushMeshNetworkRuntime,
    private readonly store?: BushMeshStoreForwardStore,
    private readonly storeKey = DEFAULT_STORE_KEY,
  ) {}

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
      throw new Error('Stored BushMesh store-and-forward state is invalid JSON.');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Stored BushMesh store-and-forward state has invalid shape.');
    }

    const envelope = parsed as {
      version?: number;
      items?: BushMeshStoreForwardItem[];
    };

    if (envelope.version !== STORE_VERSION || !Array.isArray(envelope.items)) {
      throw new Error('Unsupported BushMesh store-and-forward snapshot.');
    }

    this.items.clear();
    let restored = 0;

    for (const item of envelope.items) {
      this.validate(item);
      if (item.expiresAt <= now || item.attempts >= item.maxAttempts) {
        continue;
      }
      this.items.set(item.id, cloneItem(item));
      restored += 1;
    }

    return restored;
  }

  async enqueue(
    channelIndex: number,
    wireBytes: number[],
    options?: {
      id?: string;
      now?: number;
      ttlMs?: number;
      maxAttempts?: number;
    },
  ): Promise<BushMeshStoreForwardItem> {
    const decoded = decodeBushMeshWire(wireBytes);

    if (!decoded.envelope.storeAndForward) {
      throw new Error('Only store-and-forward BushMesh packets may enter the delayed queue.');
    }

    const now = options?.now ?? Date.now();
    const ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000;
    const maxAttempts = options?.maxAttempts ?? 12;

    if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 255) {
      throw new Error('Store-and-forward channel must be an integer from 0 to 255.');
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('Store-and-forward TTL must be greater than zero.');
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 255) {
      throw new Error('Store-and-forward max attempts must be from 1 to 255.');
    }

    const id =
      options?.id ??
      `${decoded.envelope.messageId.toString(36)}-${now.toString(36)}-${this.sequence++}`;
    const item: BushMeshStoreForwardItem = {
      id,
      channelIndex,
      wireBytes: [...wireBytes],
      priority: decoded.envelope.priority,
      createdAt: now,
      expiresAt: now + ttlMs,
      nextAttemptAt: now,
      attempts: 0,
      maxAttempts,
    };

    this.items.set(id, item);
    await this.persist();
    return cloneItem(item);
  }

  ready(now = Date.now()): BushMeshStoreForwardItem[] {
    this.pruneExpired(now);

    return Array.from(this.items.values())
      .filter(item => item.nextAttemptAt <= now && item.attempts < item.maxAttempts)
      .sort((a, b) =>
        a.priority !== b.priority
          ? a.priority - b.priority
          : a.createdAt !== b.createdAt
            ? a.createdAt - b.createdAt
            : a.id.localeCompare(b.id),
      )
      .map(cloneItem);
  }

  async flush(
    options?: {
      now?: number;
      maxMessages?: number;
      baseRetryDelayMs?: number;
      maxRetryDelayMs?: number;
      canSend?: (item: BushMeshStoreForwardItem) => boolean | Promise<boolean>;
    },
  ): Promise<BushMeshStoreForwardFlushResult> {
    const now = options?.now ?? Date.now();
    const expiredIds = this.pruneExpired(now);
    const ready = this.ready(now).slice(0, options?.maxMessages ?? 8);
    const sentIds: string[] = [];
    const failedIds: string[] = [];
    const deferredIds: string[] = [];

    for (const item of ready) {
      if (options?.canSend && !(await options.canSend(cloneItem(item)))) {
        deferredIds.push(item.id);
        continue;
      }

      try {
        await this.network.sendWire(item.channelIndex, item.wireBytes);
        this.items.delete(item.id);
        sentIds.push(item.id);
      } catch {
        const stored = this.items.get(item.id);
        if (!stored) {
          continue;
        }

        stored.attempts += 1;
        const baseDelay = options?.baseRetryDelayMs ?? 5000;
        const maxDelay = options?.maxRetryDelayMs ?? 10 * 60 * 1000;
        stored.nextAttemptAt =
          now +
          Math.min(
            maxDelay,
            baseDelay * Math.pow(2, Math.max(0, stored.attempts - 1)),
          );
        failedIds.push(item.id);
      }
    }

    await this.persist();

    return deferredIds.length > 0
      ? {sentIds, failedIds, expiredIds, deferredIds}
      : {sentIds, failedIds, expiredIds};
  }

  async acknowledge(id: string): Promise<boolean> {
    const removed = this.items.delete(id);
    if (removed) {
      await this.persist();
    }
    return removed;
  }

  snapshot(): BushMeshStoreForwardItem[] {
    return Array.from(this.items.values()).map(cloneItem);
  }

  size(): number {
    return this.items.size;
  }

  pruneExpired(now = Date.now()): string[] {
    const removed: string[] = [];

    for (const [id, item] of this.items.entries()) {
      if (item.expiresAt <= now || item.attempts >= item.maxAttempts) {
        this.items.delete(id);
        removed.push(id);
      }
    }

    return removed;
  }

  async clear(): Promise<void> {
    this.items.clear();

    if (this.store?.removeItem) {
      await this.store.removeItem(this.storeKey);
      return;
    }

    await this.persist();
  }

  private validate(item: BushMeshStoreForwardItem): void {
    if (!item.id) {
      throw new Error('Store-and-forward item is missing an ID.');
    }
    if (!Number.isInteger(item.channelIndex) || item.channelIndex < 0 || item.channelIndex > 255) {
      throw new Error('Stored channel index is invalid.');
    }
    if (!Array.isArray(item.wireBytes)) {
      throw new Error('Stored wire bytes are missing.');
    }

    const decoded = decodeBushMeshWire(item.wireBytes);
    if (!decoded.envelope.storeAndForward) {
      throw new Error('Stored packet is not marked store-and-forward.');
    }
    if (
      !Number.isInteger(item.priority) ||
      item.priority < BushMeshPriority.Emergency ||
      item.priority > 7
    ) {
      throw new Error('Stored packet priority is invalid.');
    }
    if (!Number.isInteger(item.attempts) || item.attempts < 0) {
      throw new Error('Stored packet attempt count is invalid.');
    }
    if (!Number.isInteger(item.maxAttempts) || item.maxAttempts < 1) {
      throw new Error('Stored packet max attempts is invalid.');
    }
  }

  private async persist(): Promise<void> {
    if (!this.store) {
      return;
    }

    await this.store.setItem(
      this.storeKey,
      JSON.stringify({version: STORE_VERSION, items: this.snapshot()}),
    );
  }
}
