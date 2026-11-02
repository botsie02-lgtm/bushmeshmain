import {BushMeshPriority, assertBytes, assertIntegerInRange} from '../protocol';
import {BushMeshRuntimeTransport} from './BushMeshNetworkRuntime';

export type BushMeshOutboxMode = 'text' | 'binary';

export type BushMeshOutboxItem = {
  id: string;
  channelIndex: number;
  mode: BushMeshOutboxMode;
  text?: string;
  bytes?: number[];
  priority: BushMeshPriority | number;
  createdAt: number;
  expiresAt: number;
  nextAttemptAt: number;
  attempts: number;
  maxAttempts: number;
};

export type BushMeshOutboxStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

export type BushMeshOutboxFlushResult = {
  sentIds: string[];
  failedIds: string[];
  expiredIds: string[];
};

const OUTBOX_VERSION = 1;
const DEFAULT_KEY = 'bushmesh.outbox.v1';

function cloneItem(item: BushMeshOutboxItem): BushMeshOutboxItem {
  return {
    ...item,
    bytes: item.bytes ? [...item.bytes] : undefined,
  };
}

function validateItem(item: BushMeshOutboxItem): void {
  if (!item.id) {
    throw new Error('BushMesh outbox item is missing an ID.');
  }

  assertIntegerInRange(item.channelIndex, 0, 255, 'Outbox channel index');
  assertIntegerInRange(item.priority, 0, 7, 'Outbox priority');
  assertIntegerInRange(item.attempts, 0, 255, 'Outbox attempts');
  assertIntegerInRange(item.maxAttempts, 1, 255, 'Outbox max attempts');

  if (item.mode === 'text') {
    if (!item.text) {
      throw new Error('Text outbox item is missing carrier text.');
    }
  } else if (item.mode === 'binary') {
    if (!item.bytes) {
      throw new Error('Binary outbox item is missing bytes.');
    }
    assertBytes(item.bytes, 'outbox bytes');
  } else {
    throw new Error('BushMesh outbox item has an unsupported mode.');
  }

  for (const value of [
    item.createdAt,
    item.expiresAt,
    item.nextAttemptAt,
  ]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('BushMesh outbox timestamps must be finite and non-negative.');
    }
  }
}

export class BushMeshOutbox {
  private readonly items = new Map<string, BushMeshOutboxItem>();
  private nextLocalId = 1;

  constructor(
    private readonly store?: BushMeshOutboxStore,
    private readonly key = DEFAULT_KEY,
  ) {}

  async initialize(now = Date.now()): Promise<number> {
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
      throw new Error('Stored BushMesh outbox is not valid JSON.');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Stored BushMesh outbox has invalid shape.');
    }

    const envelope = parsed as {
      version?: number;
      items?: BushMeshOutboxItem[];
    };

    if (envelope.version !== OUTBOX_VERSION || !Array.isArray(envelope.items)) {
      throw new Error('Stored BushMesh outbox version is unsupported.');
    }

    this.items.clear();
    let restored = 0;

    for (const item of envelope.items) {
      validateItem(item);
      if (item.expiresAt <= now || item.attempts >= item.maxAttempts) {
        continue;
      }
      this.items.set(item.id, cloneItem(item));
      restored += 1;
    }

    return restored;
  }

  async enqueueText(
    channelIndex: number,
    text: string,
    options?: {
      priority?: BushMeshPriority | number;
      ttlMs?: number;
      maxAttempts?: number;
      now?: number;
      id?: string;
    },
  ): Promise<BushMeshOutboxItem> {
    if (!text) {
      throw new Error('Cannot queue an empty BushMesh carrier.');
    }

    return this.enqueue(
      {
        mode: 'text',
        channelIndex,
        text,
      },
      options,
    );
  }

  async enqueueBinary(
    channelIndex: number,
    bytes: number[],
    options?: {
      priority?: BushMeshPriority | number;
      ttlMs?: number;
      maxAttempts?: number;
      now?: number;
      id?: string;
    },
  ): Promise<BushMeshOutboxItem> {
    assertBytes(bytes, 'outbox bytes');
    return this.enqueue(
      {
        mode: 'binary',
        channelIndex,
        bytes: [...bytes],
      },
      options,
    );
  }

  ready(now = Date.now()): BushMeshOutboxItem[] {
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
    transport: BushMeshRuntimeTransport,
    options?: {
      now?: number;
      maxItems?: number;
      baseRetryDelayMs?: number;
      maxRetryDelayMs?: number;
    },
  ): Promise<BushMeshOutboxFlushResult> {
    const now = options?.now ?? Date.now();
    const expiredIds = this.pruneExpired(now);
    const ready = this.ready(now).slice(0, options?.maxItems ?? 20);
    const sentIds: string[] = [];
    const failedIds: string[] = [];

    for (const item of ready) {
      try {
        if (item.mode === 'binary') {
          if (!transport.sendBinaryChannelPayload || !item.bytes) {
            throw new Error('Binary BushMesh transport is unavailable.');
          }
          await transport.sendBinaryChannelPayload(item.channelIndex, item.bytes);
        } else {
          await transport.sendTextChannelMessage(item.channelIndex, item.text ?? '');
        }

        this.items.delete(item.id);
        sentIds.push(item.id);
      } catch {
        const stored = this.items.get(item.id);
        if (!stored) {
          continue;
        }

        stored.attempts += 1;
        const base = options?.baseRetryDelayMs ?? 3000;
        const max = options?.maxRetryDelayMs ?? 5 * 60 * 1000;
        const delay = Math.min(max, base * Math.pow(2, Math.max(0, stored.attempts - 1)));
        stored.nextAttemptAt = now + delay;
        failedIds.push(item.id);
      }
    }

    await this.persist();
    return {sentIds, failedIds, expiredIds};
  }

  async acknowledge(id: string): Promise<boolean> {
    const removed = this.items.delete(id);
    if (removed) {
      await this.persist();
    }
    return removed;
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

  snapshot(): BushMeshOutboxItem[] {
    return Array.from(this.items.values()).map(cloneItem);
  }

  size(): number {
    return this.items.size;
  }

  async clear(): Promise<void> {
    this.items.clear();

    if (this.store?.removeItem) {
      await this.store.removeItem(this.key);
    } else {
      await this.persist();
    }
  }

  private async enqueue(
    payload:
      | {mode: 'text'; channelIndex: number; text: string}
      | {mode: 'binary'; channelIndex: number; bytes: number[]},
    options?: {
      priority?: BushMeshPriority | number;
      ttlMs?: number;
      maxAttempts?: number;
      now?: number;
      id?: string;
    },
  ): Promise<BushMeshOutboxItem> {
    const now = options?.now ?? Date.now();
    const ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000;
    const maxAttempts = options?.maxAttempts ?? 12;
    const priority = options?.priority ?? BushMeshPriority.DirectMessage;
    const id = options?.id ?? `${now.toString(36)}-${this.nextLocalId++}`;

    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('BushMesh outbox TTL must be positive.');
    }

    assertIntegerInRange(maxAttempts, 1, 255, 'Outbox max attempts');
    assertIntegerInRange(priority, 0, 7, 'Outbox priority');

    const item: BushMeshOutboxItem = {
      id,
      channelIndex: payload.channelIndex,
      mode: payload.mode,
      text: payload.mode === 'text' ? payload.text : undefined,
      bytes: payload.mode === 'binary' ? [...payload.bytes] : undefined,
      priority,
      createdAt: now,
      expiresAt: now + ttlMs,
      nextAttemptAt: now,
      attempts: 0,
      maxAttempts,
    };

    validateItem(item);
    this.items.set(id, item);
    await this.persist();
    return cloneItem(item);
  }

  private async persist(): Promise<void> {
    if (!this.store) {
      return;
    }

    await this.store.setItem(
      this.key,
      JSON.stringify({
        version: OUTBOX_VERSION,
        items: this.snapshot(),
      }),
    );
  }
}
