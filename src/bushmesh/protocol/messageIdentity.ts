import {assertIntegerInRange} from './codec';

export type BushMeshMessageIdentity = {
  sourceNodeId: number;
  messageId: number;
};

export function messageIdentityKey(identity: BushMeshMessageIdentity): string {
  assertIntegerInRange(identity.sourceNodeId, 0, 0xffffffff, 'Source node ID');
  assertIntegerInRange(identity.messageId, 0, 0xffffffff, 'Message ID');
  return `${identity.sourceNodeId.toString(16).padStart(8, '0')}:${identity.messageId
    .toString(16)
    .padStart(8, '0')}`;
}

export class BushMeshMessageIdGenerator {
  private nextValue: number;

  constructor(seed = Date.now() >>> 0) {
    assertIntegerInRange(seed, 0, 0xffffffff, 'Message ID seed');
    this.nextValue = seed === 0 ? 1 : seed;
  }

  next(): number {
    const value = this.nextValue;
    this.nextValue = (this.nextValue + 1) >>> 0;

    if (this.nextValue === 0) {
      this.nextValue = 1;
    }

    return value;
  }
}

export type BushMeshSeenMessageSnapshot = {
  key: string;
  seenAt: number;
  expiresAt: number;
};

type SeenMessage = BushMeshSeenMessageSnapshot;

export class BushMeshRecentMessageCache {
  private readonly seen = new Map<string, SeenMessage>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly maxEntries = 2048,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('Dedup TTL must be greater than zero.');
    }

    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('Dedup max entries must be a positive integer.');
    }
  }

  hasSeen(identity: BushMeshMessageIdentity, now = Date.now()): boolean {
    this.prune(now);
    const entry = this.seen.get(messageIdentityKey(identity));
    return Boolean(entry && entry.expiresAt > now);
  }

  remember(identity: BushMeshMessageIdentity, now = Date.now()): void {
    this.prune(now);
    const key = messageIdentityKey(identity);
    this.seen.delete(key);
    this.seen.set(key, {
      key,
      seenAt: now,
      expiresAt: now + this.ttlMs,
    });
    this.trimToLimit();
  }

  checkAndRemember(
    identity: BushMeshMessageIdentity,
    now = Date.now(),
  ): boolean {
    const duplicate = this.hasSeen(identity, now);

    if (!duplicate) {
      this.remember(identity, now);
    }

    return duplicate;
  }

  prune(now = Date.now()): number {
    let removed = 0;

    for (const [key, entry] of this.seen.entries()) {
      if (entry.expiresAt <= now) {
        this.seen.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  snapshot(now = Date.now()): BushMeshSeenMessageSnapshot[] {
    this.prune(now);
    return Array.from(this.seen.values()).map(entry => ({...entry}));
  }

  restore(
    entries: BushMeshSeenMessageSnapshot[],
    now = Date.now(),
    replace = true,
  ): number {
    if (replace) {
      this.seen.clear();
    }

    let restored = 0;
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry.key !== 'string' ||
        !Number.isFinite(entry.seenAt) ||
        !Number.isFinite(entry.expiresAt) ||
        entry.seenAt < 0 ||
        entry.expiresAt <= now ||
        entry.expiresAt < entry.seenAt
      ) {
        continue;
      }

      this.seen.set(entry.key, {...entry});
      restored += 1;
    }

    this.trimToLimit();
    return restored;
  }

  clear(): void {
    this.seen.clear();
  }

  size(): number {
    return this.seen.size;
  }

  private trimToLimit(): void {
    while (this.seen.size > this.maxEntries) {
      const oldestKey = this.seen.keys().next().value as string | undefined;

      if (!oldestKey) {
        break;
      }

      this.seen.delete(oldestKey);
    }
  }
}
