import {
  BushMeshDistress,
  BushMeshPriority,
  encodeBushMeshDistressWire,
  encodeBushMeshRoutedWire,
} from '../protocol';
import {BushMeshNetworkRuntime} from './BushMeshNetworkRuntime';

export type BushMeshDistressBeaconStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

export type BushMeshPersistentDistressBeaconOptions = {
  destinationNodeId?: number;
  ttlHops?: number;
  repeatDelaysMs?: number[];
};

export type BushMeshPersistentDistressBeaconState = {
  active: boolean;
  messageId: number | null;
  transmissions: number;
  remainingRepeats: number;
};

type DistressCheckpoint = {
  version: 1;
  channelIndex: number;
  wireBytes: number[];
  messageId: number;
  sourceNodeId: number;
  transmissions: number;
  dueAtMs: number[];
  expiresAtMs: number;
};

const DEFAULT_KEY = 'bushmesh.activeDistress.v1';
const MAX_REPEAT_COUNT = 8;
const MAX_RECOVERY_AGE_MS = 15 * 60 * 1000;
const RECOVERY_RETRY_DELAY_MS = 5000;

/**
 * Restart-resilient emergency beacon. Missed repeats during downtime collapse
 * into one immediate recovery transmission instead of creating a burst when the
 * app reopens. Future repeats retain their absolute schedule.
 */
export class BushMeshPersistentDistressBeacon {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private checkpoint: DistressCheckpoint | null = null;
  private restored = false;
  private persistenceChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly network: BushMeshNetworkRuntime,
    private readonly localNodeId: () => number,
    private readonly store?: BushMeshDistressBeaconStore,
    private readonly storeKey = DEFAULT_KEY,
  ) {}

  async initialize(now = Date.now()): Promise<boolean> {
    if (!this.store || this.checkpoint) {
      return this.checkpoint !== null;
    }

    const raw = await this.store.getItem(this.storeKey);
    if (!raw) {
      return false;
    }

    let saved: DistressCheckpoint;
    try {
      saved = JSON.parse(raw) as DistressCheckpoint;
    } catch {
      await this.clearStoredOnly();
      return false;
    }

    if (!this.isValidCheckpoint(saved, now)) {
      await this.clearStoredOnly();
      return false;
    }

    this.checkpoint = {
      ...saved,
      wireBytes: [...saved.wireBytes],
      dueAtMs: [...saved.dueAtMs].sort((a, b) => a - b),
    };
    this.restored = true;

    const missed = this.checkpoint.dueAtMs.filter(due => due <= now);
    const future = this.checkpoint.dueAtMs.filter(due => due > now);
    this.checkpoint.dueAtMs = future;

    if (missed.length > 0 && now < this.checkpoint.expiresAtMs) {
      try {
        await this.transmit(this.checkpoint.channelIndex, this.checkpoint.wireBytes);
      } catch {
        // Collapse all missed repeats into one near-future retry instead of
        // dropping them or replaying a burst after a reconnect.
        const retryAt = Math.min(
          now + RECOVERY_RETRY_DELAY_MS,
          this.checkpoint.expiresAtMs - 1,
        );
        if (retryAt > now) {
          this.checkpoint.dueAtMs = [retryAt, ...future].sort((a, b) => a - b);
        }
      }
    }

    this.scheduleRemaining(now);
    await this.persist();
    return true;
  }

  async resume(now = Date.now()): Promise<boolean> {
    if (!this.checkpoint) {
      return this.initialize(now);
    }

    if (this.checkpoint.expiresAtMs <= now) {
      await this.cancel();
      return false;
    }

    this.scheduleRemaining(now);
    return true;
  }

  async start(
    channelIndex: number,
    distress: BushMeshDistress,
    options?: BushMeshPersistentDistressBeaconOptions,
  ): Promise<number> {
    await this.cancel();

    if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 255) {
      throw new Error('Distress channel must be an integer from 0 to 255.');
    }

    const sourceNodeId = this.localNodeId();
    const innerMessageId = this.network.nextMessageId();
    const routedMessageId = this.network.nextMessageId();
    const ttlHops = options?.ttlHops ?? 6;
    const innerWireBytes = encodeBushMeshDistressWire(
      distress,
      innerMessageId,
      {ttlHops},
    );
    const routedWireBytes = encodeBushMeshRoutedWire(
      {
        sourceNodeId,
        destinationNodeId: options?.destinationNodeId,
        innerWireBytes,
      },
      routedMessageId,
      {
        ttlHops,
        priority: BushMeshPriority.Emergency,
      },
    );

    const repeatDelays = options?.repeatDelaysMs ?? [15000, 45000, 90000];
    this.validateRepeatDelays(repeatDelays);
    const now = Date.now();
    const dueAtMs = repeatDelays.map(
      delay => now + delay + this.jitterMs(sourceNodeId, routedMessageId, delay),
    );
    const lastDue = dueAtMs[dueAtMs.length - 1] ?? now;

    this.checkpoint = {
      version: 1,
      channelIndex,
      wireBytes: [...routedWireBytes],
      messageId: routedMessageId,
      sourceNodeId,
      transmissions: 0,
      dueAtMs,
      expiresAtMs: lastDue + MAX_RECOVERY_AGE_MS,
    };
    this.restored = false;
    await this.persist();

    await this.transmit(channelIndex, routedWireBytes);
    this.scheduleRemaining(Date.now());
    return routedMessageId;
  }

  /** Explicit user cancellation: stop repeats and delete durable SOS state. */
  async cancel(): Promise<void> {
    this.clearTimers();
    this.checkpoint = null;
    this.restored = false;
    await this.clearStoredOnly();
  }

  /** Backwards-compatible explicit cancellation alias. */
  stop(): void {
    void this.cancel();
  }

  /** Runtime/app teardown: stop timers but preserve active SOS for restart. */
  suspend(): void {
    this.clearTimers();
    this.queuePersist();
  }

  state(): BushMeshPersistentDistressBeaconState {
    return {
      active: this.checkpoint !== null,
      messageId: this.checkpoint?.messageId ?? null,
      transmissions: this.checkpoint?.transmissions ?? 0,
      remainingRepeats: this.checkpoint?.dueAtMs.length ?? 0,
    };
  }

  wasRestored(): boolean {
    return this.restored;
  }

  async flushPersistence(): Promise<void> {
    await this.persistenceChain;
  }

  private scheduleRemaining(now: number): void {
    this.clearTimers();
    const checkpoint = this.checkpoint;
    if (!checkpoint) {
      return;
    }

    for (const dueAt of checkpoint.dueAtMs) {
      const delay = Math.max(0, dueAt - now);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void this.fireScheduled(dueAt);
      }, delay);
      this.timers.add(timer);
    }
  }

  private async fireScheduled(dueAt: number): Promise<void> {
    const checkpoint = this.checkpoint;
    if (!checkpoint) {
      return;
    }

    if (Date.now() >= checkpoint.expiresAtMs) {
      await this.cancel();
      return;
    }

    try {
      await this.transmit(checkpoint.channelIndex, checkpoint.wireBytes);
      checkpoint.dueAtMs = checkpoint.dueAtMs.filter(value => value !== dueAt);
      await this.persist();

      if (checkpoint.dueAtMs.length === 0) {
        await this.cancel();
      }
    } catch {
      // Preserve this due time and checkpoint. A later app/runtime resume may
      // collapse missed sends into one safe recovery transmission.
      this.queuePersist();
    }
  }

  private async transmit(channelIndex: number, wireBytes: number[]): Promise<void> {
    await this.network.sendWire(channelIndex, wireBytes);
    if (this.checkpoint) {
      this.checkpoint.transmissions += 1;
      this.queuePersist();
    }
  }

  private validateRepeatDelays(delays: number[]): void {
    if (delays.length > MAX_REPEAT_COUNT) {
      throw new Error(`Distress beacon supports at most ${MAX_REPEAT_COUNT} repeats.`);
    }

    let previous = 0;
    for (const delay of delays) {
      if (!Number.isFinite(delay) || delay < 1000 || delay <= previous) {
        throw new Error(
          'Distress repeat delays must be increasing and at least one second.',
        );
      }
      previous = delay;
    }
  }

  private isValidCheckpoint(
    value: DistressCheckpoint,
    now: number,
  ): boolean {
    return Boolean(
      value &&
        value.version === 1 &&
        Number.isInteger(value.channelIndex) &&
        value.channelIndex >= 0 &&
        value.channelIndex <= 255 &&
        Number.isInteger(value.messageId) &&
        Number.isInteger(value.sourceNodeId) &&
        Array.isArray(value.wireBytes) &&
        value.wireBytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255) &&
        Array.isArray(value.dueAtMs) &&
        value.dueAtMs.length <= MAX_REPEAT_COUNT &&
        value.dueAtMs.every(due => Number.isFinite(due) && due >= 0) &&
        Number.isFinite(value.expiresAtMs) &&
        value.expiresAtMs > now &&
        Number.isInteger(value.transmissions) &&
        value.transmissions >= 0
    );
  }

  private jitterMs(sourceNodeId: number, messageId: number, delayMs: number): number {
    let value = (sourceNodeId ^ messageId ^ delayMs) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
    value ^= value >>> 16;
    return value % 1500;
  }

  private clearTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private queuePersist(): void {
    this.persistenceChain = this.persistenceChain
      .then(() => this.persist())
      .catch(() => undefined);
  }

  private async persist(): Promise<void> {
    if (!this.store || !this.checkpoint) {
      return;
    }
    await this.store.setItem(this.storeKey, JSON.stringify(this.checkpoint));
  }

  private async clearStoredOnly(): Promise<void> {
    if (!this.store) {
      return;
    }
    if (this.store.removeItem) {
      await this.store.removeItem(this.storeKey);
    } else {
      await this.store.setItem(this.storeKey, '');
    }
  }
}
