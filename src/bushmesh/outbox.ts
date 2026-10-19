export type BushMeshOutboxPriority =
  | 'safety'
  | 'control'
  | 'message'
  | 'position'
  | 'bulk';

export type BushMeshOutboxState =
  | 'queued'
  | 'inflight'
  | 'accepted'
  | 'failed'
  | 'cancelled';

export type BushMeshOutboxInput = {
  channelIndex: number;
  dataType: number;
  payload: Uint8Array;
  priority: BushMeshOutboxPriority;
  description: string;
  createdAtMs?: number;
  maxAttempts?: number;
};

export type BushMeshOutboxEntry = BushMeshOutboxInput & {
  id: string;
  createdAtMs: number;
  maxAttempts: number;
  attempts: number;
  state: BushMeshOutboxState;
  nextAttemptAtMs: number;
  lastError: string | null;
  acceptedAtMs: number | null;
};

const PRIORITY_RANK: Record<BushMeshOutboxPriority, number> = {
  safety: 0,
  control: 1,
  message: 2,
  position: 3,
  bulk: 4,
};

const BASE_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;

function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * Math.pow(2, exponent),
  );
}

/**
 * Transport-neutral Bushmesh outbox.
 *
 * This is intentionally in-memory for the foundation phase. The public shape
 * is designed so the same entries can later be persisted in SQLite and drained
 * by the Android foreground radio service without changing delivery semantics.
 */
export class InMemoryBushMeshOutbox {
  private entries: BushMeshOutboxEntry[] = [];
  private nextId = 1;

  enqueue(input: BushMeshOutboxInput): BushMeshOutboxEntry {
    const createdAtMs = input.createdAtMs ?? Date.now();
    const entry: BushMeshOutboxEntry = {
      ...input,
      id: `outbox-${this.nextId++}`,
      payload: Uint8Array.from(input.payload),
      createdAtMs,
      maxAttempts: Math.max(1, input.maxAttempts ?? 5),
      attempts: 0,
      state: 'queued',
      nextAttemptAtMs: createdAtMs,
      lastError: null,
      acceptedAtMs: null,
    };

    this.entries.push(entry);
    return {...entry, payload: Uint8Array.from(entry.payload)};
  }

  list(): BushMeshOutboxEntry[] {
    return this.entries.map(entry => ({
      ...entry,
      payload: Uint8Array.from(entry.payload),
    }));
  }

  nextReady(nowMs = Date.now()): BushMeshOutboxEntry | null {
    const ready = this.entries
      .filter(
        entry => entry.state === 'queued' && entry.nextAttemptAtMs <= nowMs,
      )
      .sort((a, b) => {
        const priorityDifference =
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (priorityDifference !== 0) {
          return priorityDifference;
        }
        return a.createdAtMs - b.createdAtMs;
      })[0];

    return ready
      ? {...ready, payload: Uint8Array.from(ready.payload)}
      : null;
  }

  markAttempt(id: string, nowMs = Date.now()): BushMeshOutboxEntry {
    const entry = this.requireEntry(id);
    if (entry.state !== 'queued') {
      throw new Error(`Outbox entry ${id} is not queued.`);
    }

    entry.attempts += 1;
    entry.state = 'inflight';
    entry.nextAttemptAtMs = nowMs;
    entry.lastError = null;
    return {...entry, payload: Uint8Array.from(entry.payload)};
  }

  markAccepted(id: string, nowMs = Date.now()): BushMeshOutboxEntry {
    const entry = this.requireEntry(id);
    if (entry.state !== 'inflight') {
      throw new Error(`Outbox entry ${id} is not inflight.`);
    }

    entry.state = 'accepted';
    entry.acceptedAtMs = nowMs;
    entry.lastError = null;
    return {...entry, payload: Uint8Array.from(entry.payload)};
  }

  markFailed(
    id: string,
    error: string,
    nowMs = Date.now(),
  ): BushMeshOutboxEntry {
    const entry = this.requireEntry(id);
    if (entry.state !== 'inflight') {
      throw new Error(`Outbox entry ${id} is not inflight.`);
    }

    entry.lastError = error;

    if (entry.attempts >= entry.maxAttempts) {
      entry.state = 'failed';
      entry.nextAttemptAtMs = nowMs;
    } else {
      entry.state = 'queued';
      entry.nextAttemptAtMs = nowMs + retryDelayMs(entry.attempts);
    }

    return {...entry, payload: Uint8Array.from(entry.payload)};
  }

  cancel(id: string): BushMeshOutboxEntry {
    const entry = this.requireEntry(id);
    if (entry.state === 'accepted') {
      throw new Error(`Accepted outbox entry ${id} cannot be cancelled.`);
    }

    entry.state = 'cancelled';
    return {...entry, payload: Uint8Array.from(entry.payload)};
  }

  pruneTerminal(): void {
    this.entries = this.entries.filter(
      entry =>
        entry.state !== 'accepted' &&
        entry.state !== 'failed' &&
        entry.state !== 'cancelled',
    );
  }

  private requireEntry(id: string): BushMeshOutboxEntry {
    const entry = this.entries.find(candidate => candidate.id === id);
    if (!entry) {
      throw new Error(`Unknown outbox entry ${id}.`);
    }
    return entry;
  }
}
