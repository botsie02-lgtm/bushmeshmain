import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
  BushMeshReliabilityController,
  encodeFragmentAck,
  encodeBushMeshWire,
} from '../protocol';

export type BushMeshFragmentTransport = 'text-safe' | 'binary';

export type BushMeshFragmentCheckpointStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

export type BushMeshFragmentCheckpoint = {
  messageId: number;
  channelIndex: number;
  transport: BushMeshFragmentTransport;
  fragmentWireBytes: number[][];
  acknowledgedFragmentIndexes: number[];
  createdAt: number;
  expiresAt: number;
};

type SnapshotEnvelope = {
  version: 1;
  messages: BushMeshFragmentCheckpoint[];
};

const DEFAULT_STORE_KEY = 'bushmesh.fragmentRecovery.v1';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_MESSAGES = 32;

/**
 * Durable selective-retransmission state for fragmented non-file messages.
 * Restoring a checkpoint registers every original fragment, then replays a
 * synthetic ACK bitmap for fragments that had already been confirmed.
 */
export class BushMeshFragmentCheckpointRuntime {
  private readonly messages = new Map<number, BushMeshFragmentCheckpoint>();
  private persistChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly store?: BushMeshFragmentCheckpointStore,
    private readonly storeKey = DEFAULT_STORE_KEY,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxMessages = DEFAULT_MAX_MESSAGES,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('Fragment checkpoint TTL must be greater than zero.');
    }
    if (!Number.isInteger(maxMessages) || maxMessages < 1) {
      throw new Error('Fragment checkpoint capacity must be a positive integer.');
    }
  }

  async initialize(
    reliability: BushMeshReliabilityController,
    now = Date.now(),
  ): Promise<BushMeshFragmentCheckpoint[]> {
    if (!this.store) {
      return [];
    }

    const raw = await this.store.getItem(this.storeKey);
    if (!raw) {
      return [];
    }

    let envelope: SnapshotEnvelope;
    try {
      envelope = JSON.parse(raw) as SnapshotEnvelope;
    } catch {
      await this.clear();
      return [];
    }

    if (envelope.version !== 1 || !Array.isArray(envelope.messages)) {
      await this.clear();
      return [];
    }

    this.messages.clear();
    const restored: BushMeshFragmentCheckpoint[] = [];

    for (const saved of envelope.messages) {
      if (!this.isValid(saved, now)) {
        continue;
      }

      try {
        reliability.registerOutgoingFragments(
          saved.messageId,
          saved.fragmentWireBytes,
          {now},
        );

        if (saved.acknowledgedFragmentIndexes.length > 0) {
          const ackPayload = encodeFragmentAck(
            saved.messageId,
            saved.fragmentWireBytes.length,
            saved.acknowledgedFragmentIndexes,
          );
          reliability.acceptAckWire(
            encodeBushMeshWire({
              type: BushMeshPacketType.Ack,
              priority: BushMeshPriority.DirectMessage,
              compression: BushMeshCompressionProfile.Raw,
              messageId: saved.messageId,
              ackRequested: false,
              payload: ackPayload,
            }),
          );
        }

        const checkpoint = this.clone(saved);
        this.messages.set(saved.messageId, checkpoint);
        restored.push(this.clone(checkpoint));
      } catch {
        reliability.cancel(saved.messageId);
      }
    }

    this.trim(now);
    await this.persistNow();
    return restored;
  }

  async register(
    messageId: number,
    channelIndex: number,
    transport: BushMeshFragmentTransport,
    fragmentWireBytes: number[][],
    now = Date.now(),
  ): Promise<void> {
    if (!Number.isInteger(messageId) || messageId < 0 || messageId > 0xffffffff) {
      throw new Error('Fragment checkpoint message ID is invalid.');
    }
    if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 255) {
      throw new Error('Fragment checkpoint channel is invalid.');
    }
    if (fragmentWireBytes.length < 2) {
      throw new Error('Fragment checkpoint requires a fragmented message.');
    }

    this.messages.set(messageId, {
      messageId,
      channelIndex,
      transport,
      fragmentWireBytes: fragmentWireBytes.map(frame => [...frame]),
      acknowledgedFragmentIndexes: [],
      createdAt: now,
      expiresAt: now + this.ttlMs,
    });
    this.trim(now);
    await this.persistNow();
  }

  async applyAcknowledgement(
    messageId: number,
    acknowledgedFragmentIndexes: number[],
    missingFragmentIndexes: number[],
  ): Promise<void> {
    const checkpoint = this.messages.get(messageId);
    if (!checkpoint) {
      return;
    }

    const acknowledged = new Set(checkpoint.acknowledgedFragmentIndexes);
    for (const index of acknowledgedFragmentIndexes) {
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < checkpoint.fragmentWireBytes.length
      ) {
        acknowledged.add(index);
      }
    }
    checkpoint.acknowledgedFragmentIndexes = Array.from(acknowledged).sort(
      (a, b) => a - b,
    );

    if (missingFragmentIndexes.length === 0) {
      this.messages.delete(messageId);
    }
    await this.persistNow();
  }

  async remove(messageId: number): Promise<boolean> {
    const removed = this.messages.delete(messageId);
    if (removed) {
      await this.persistNow();
    }
    return removed;
  }

  snapshot(now = Date.now()): BushMeshFragmentCheckpoint[] {
    this.trim(now);
    return Array.from(this.messages.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(message => this.clone(message));
  }

  schedulePersist(): void {
    this.persistChain = this.persistChain
      .then(() => this.persistNow())
      .catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.persistChain;
  }

  async clear(): Promise<void> {
    this.messages.clear();
    if (!this.store) {
      return;
    }
    if (this.store.removeItem) {
      await this.store.removeItem(this.storeKey);
    } else {
      await this.store.setItem(this.storeKey, '');
    }
  }

  private trim(now: number): void {
    for (const [messageId, checkpoint] of this.messages.entries()) {
      if (checkpoint.expiresAt <= now) {
        this.messages.delete(messageId);
      }
    }

    while (this.messages.size > this.maxMessages) {
      const oldest = Array.from(this.messages.values()).sort(
        (a, b) => a.createdAt - b.createdAt,
      )[0];
      if (!oldest) {
        break;
      }
      this.messages.delete(oldest.messageId);
    }
  }

  private isValid(
    checkpoint: BushMeshFragmentCheckpoint,
    now: number,
  ): boolean {
    return Boolean(
      checkpoint &&
        Number.isInteger(checkpoint.messageId) &&
        checkpoint.messageId >= 0 &&
        checkpoint.messageId <= 0xffffffff &&
        Number.isInteger(checkpoint.channelIndex) &&
        checkpoint.channelIndex >= 0 &&
        checkpoint.channelIndex <= 255 &&
        (checkpoint.transport === 'text-safe' || checkpoint.transport === 'binary') &&
        Array.isArray(checkpoint.fragmentWireBytes) &&
        checkpoint.fragmentWireBytes.length >= 2 &&
        checkpoint.fragmentWireBytes.every(frame =>
          Array.isArray(frame) &&
          frame.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255),
        ) &&
        Array.isArray(checkpoint.acknowledgedFragmentIndexes) &&
        Number.isFinite(checkpoint.createdAt) &&
        Number.isFinite(checkpoint.expiresAt) &&
        checkpoint.expiresAt > now
    );
  }

  private clone(
    checkpoint: BushMeshFragmentCheckpoint,
  ): BushMeshFragmentCheckpoint {
    return {
      ...checkpoint,
      fragmentWireBytes: checkpoint.fragmentWireBytes.map(frame => [...frame]),
      acknowledgedFragmentIndexes: [...checkpoint.acknowledgedFragmentIndexes],
    };
  }

  private async persistNow(): Promise<void> {
    if (!this.store) {
      return;
    }

    const envelope: SnapshotEnvelope = {
      version: 1,
      messages: this.snapshot(),
    };
    await this.store.setItem(this.storeKey, JSON.stringify(envelope));
  }
}
