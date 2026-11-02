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
  identityRef?: string | null;
  expiresAtMs?: number | null;
  createdAtMs?: number;
  maxAttempts?: number;
};

export type BushMeshOutboxEntry = Omit<
  BushMeshOutboxInput,
  'identityRef' | 'expiresAtMs'
> & {
  id: string;
  identityRef: string | null;
  expiresAtMs: number | null;
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

const OUTBOX_STATES: BushMeshOutboxState[] = [
  'queued',
  'inflight',
  'accepted',
  'failed',
  'cancelled',
];

const BASE_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;

function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * Math.pow(2, exponent),
  );
}

function validOptionalTimestamp(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value >= 0);
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
    const expiresAtMs = input.expiresAtMs ?? null;
    if (!validOptionalTimestamp(expiresAtMs)) {
      throw new Error('Outbox expiry must be null or a non-negative timestamp.');
    }

    const entry: BushMeshOutboxEntry = {
      channelIndex: input.channelIndex,
      dataType: input.dataType,
      payload: Uint8Array.from(input.payload),
      priority: input.priority,
      description: input.description,
      identityRef: input.identityRef ?? null,
      expiresAtMs,
      id: `outbox-${this.nextId++}`,
      createdAtMs,
      maxAttempts: Math.max(1, input.maxAttempts ?? 5),
      attempts: 0,
      state: 'queued',
      nextAttemptAtMs: createdAtMs,
      lastError: null,
      acceptedAtMs: null,
    };

    this.entries.push(entry);
    return this.clone(entry);
  }

  list(): BushMeshOutboxEntry[] {
    return this.entries.map(entry => this.clone(entry));
  }

  /**
   * Replaces the in-memory queue from an already validated persistence restore.
   * This is intended for cold start before transmissions begin, not live merging.
   */
  replaceEntries(restored: BushMeshOutboxEntry[]): void {
    const ids = new Set<string>();
    let highestGeneratedId = 0;

    const nextEntries = restored.map(entry => {
      this.validateRestoredEntry(entry);
      if (ids.has(entry.id)) {
        throw new Error(`Duplicate restored outbox id ${entry.id}.`);
      }
      ids.add(entry.id);

      const generatedMatch = /^outbox-(\d+)$/.exec(entry.id);
      if (generatedMatch) {
        highestGeneratedId = Math.max(
          highestGeneratedId,
          Number.parseInt(generatedMatch[1], 10),
        );
      }

      return this.clone(entry);
    });

    this.entries = nextEntries;
    this.nextId = Math.max(1, highestGeneratedId + 1);
  }

  nextReady(nowMs = Date.now()): BushMeshOutboxEntry | null {
    this.cancelExpiredQueued(nowMs);

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

    return ready ? this.clone(ready) : null;
  }

  markAttempt(id: string, nowMs = Date.now()): BushMeshOutboxEntry {
    const entry = this.requireEntry(id);
    if (entry.state !== 'queued') {
      throw new Error(`Outbox entry ${id} is not queued.`);
    }
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= nowMs) {
      entry.state = 'cancelled';
      entry.lastError = 'Expired before radio acceptance.';
      throw new Error(`Outbox entry ${id} expired before transmission.`);
    }

    entry.attempts += 1;
    entry.state = 'inflight';
    entry.nextAttemptAtMs = nowMs;
    entry.lastError = null;
    return this.clone(entry);
  }

  markAccepted(id: string, nowMs = Date.now()): BushMeshOutboxEntry {
    const entry = this.requireEntry(id);
    if (entry.state !== 'inflight') {
      throw new Error(`Outbox entry ${id} is not inflight.`);
    }

    entry.state = 'accepted';
    entry.acceptedAtMs = nowMs;
    entry.lastError = null;
    return this.clone(entry);
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

    if (entry.expiresAtMs !== null && entry.expiresAtMs <= nowMs) {
      entry.state = 'cancelled';
      entry.lastError = `${error} Packet expired before retry.`;
      entry.nextAttemptAtMs = nowMs;
    } else if (entry.attempts >= entry.maxAttempts) {
      entry.state = 'failed';
      entry.nextAttemptAtMs = nowMs;
    } else {
      entry.state = 'queued';
      entry.nextAttemptAtMs = nowMs + retryDelayMs(entry.attempts);
    }

    return this.clone(entry);
  }

  cancel(id: string): BushMeshOutboxEntry {
    const entry = this.requireEntry(id);
    if (entry.state === 'accepted') {
      throw new Error(`Accepted outbox entry ${id} cannot be cancelled.`);
    }

    entry.state = 'cancelled';
    return this.clone(entry);
  }

  /**
   * Position traffic represents current state, not an event history. When a
   * newer fix is queued, older queued fixes for the same vehicle/channel are
   * superseded so reconnecting does not waste LoRa airtime on stale locations.
   */
  cancelQueuedPositions(
    identityRef: string,
    channelIndex: number,
  ): BushMeshOutboxEntry[] {
    const cancelled: BushMeshOutboxEntry[] = [];

    for (const entry of this.entries) {
      if (
        entry.state === 'queued' &&
        entry.priority === 'position' &&
        entry.identityRef === identityRef &&
        entry.channelIndex === channelIndex
      ) {
        entry.state = 'cancelled';
        entry.lastError = 'Superseded by a newer position update.';
        cancelled.push(this.clone(entry));
      }
    }

    return cancelled;
  }

  /**
   * Prevents packets encoded with a previous radio identity from being sent by
   * a newly connected radio. In-flight work is left alone because its transport
   * call has already begun; queued work is safe to cancel deterministically.
   */
  cancelQueuedForOtherIdentities(identityRef: string): BushMeshOutboxEntry[] {
    const cancelled: BushMeshOutboxEntry[] = [];

    for (const entry of this.entries) {
      if (
        entry.state === 'queued' &&
        entry.identityRef !== null &&
        entry.identityRef !== identityRef
      ) {
        entry.state = 'cancelled';
        entry.lastError = 'Cancelled because the active radio identity changed.';
        cancelled.push(this.clone(entry));
      }
    }

    return cancelled;
  }

  pruneTerminal(): void {
    this.entries = this.entries.filter(
      entry =>
        entry.state !== 'accepted' &&
        entry.state !== 'failed' &&
        entry.state !== 'cancelled',
    );
  }

  private cancelExpiredQueued(nowMs: number): void {
    for (const entry of this.entries) {
      if (
        entry.state === 'queued' &&
        entry.expiresAtMs !== null &&
        entry.expiresAtMs <= nowMs
      ) {
        entry.state = 'cancelled';
        entry.lastError = 'Expired before radio acceptance.';
        entry.nextAttemptAtMs = nowMs;
      }
    }
  }

  private validateRestoredEntry(entry: BushMeshOutboxEntry): void {
    if (!entry.id || typeof entry.id !== 'string') {
      throw new Error('Restored outbox entry id is invalid.');
    }
    if (
      !Number.isInteger(entry.channelIndex) ||
      entry.channelIndex < 0 ||
      entry.channelIndex > 7
    ) {
      throw new Error(`Restored outbox entry ${entry.id} has an invalid channel.`);
    }
    if (!Number.isInteger(entry.dataType) || entry.dataType < 1 || entry.dataType > 0xffff) {
      throw new Error(`Restored outbox entry ${entry.id} has an invalid data type.`);
    }
    if (!(entry.payload instanceof Uint8Array)) {
      throw new Error(`Restored outbox entry ${entry.id} has an invalid payload.`);
    }
    if (!(entry.priority in PRIORITY_RANK)) {
      throw new Error(`Restored outbox entry ${entry.id} has an invalid priority.`);
    }
    if (!OUTBOX_STATES.includes(entry.state)) {
      throw new Error(`Restored outbox entry ${entry.id} has an invalid state.`);
    }
    if (!validOptionalTimestamp(entry.expiresAtMs)) {
      throw new Error(`Restored outbox entry ${entry.id} has an invalid expiry.`);
    }
    if (
      !Number.isInteger(entry.maxAttempts) ||
      entry.maxAttempts < 1 ||
      !Number.isInteger(entry.attempts) ||
      entry.attempts < 0 ||
      entry.attempts > entry.maxAttempts
    ) {
      throw new Error(`Restored outbox entry ${entry.id} has invalid retry metadata.`);
    }
  }

  private clone(entry: BushMeshOutboxEntry): BushMeshOutboxEntry {
    return {...entry, payload: Uint8Array.from(entry.payload)};
  }

  private requireEntry(id: string): BushMeshOutboxEntry {
    const entry = this.entries.find(candidate => candidate.id === id);
    if (!entry) {
      throw new Error(`Unknown outbox entry ${id}.`);
    }
    return entry;
  }
}
