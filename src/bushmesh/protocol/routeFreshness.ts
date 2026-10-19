import {assertIntegerInRange} from './codec';
import {BushMeshRouteAdvertisement} from './routeAdvertisement';

function routeKey(destinationNodeId: number, previousHopNodeId: number): string {
  return `${destinationNodeId}:${previousHopNodeId}`;
}

export function isNewerUint32Sequence(candidate: number, current: number): boolean {
  assertIntegerInRange(candidate, 0, 0xffffffff, 'Candidate sequence');
  assertIntegerInRange(current, 0, 0xffffffff, 'Current sequence');

  if (candidate === current) {
    return false;
  }

  const difference = (candidate - current) >>> 0;
  return difference < 0x80000000;
}

type SeenRouteAdvertisement = {
  sequence: number;
  seenAt: number;
};

export class BushMeshRouteAdvertisementTracker {
  private readonly seen = new Map<string, SeenRouteAdvertisement>();

  constructor(private readonly ttlMs = 10 * 60 * 1000) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('Route advertisement freshness TTL must be positive.');
    }
  }

  accept(
    advertisement: BushMeshRouteAdvertisement,
    previousHopNodeId: number,
    now = Date.now(),
  ): boolean {
    assertIntegerInRange(previousHopNodeId, 0, 0xffffffff, 'Previous-hop node ID');
    this.prune(now);
    const key = routeKey(advertisement.destinationNodeId, previousHopNodeId);
    const existing = this.seen.get(key);

    if (existing && !isNewerUint32Sequence(advertisement.sequence, existing.sequence)) {
      return false;
    }

    this.seen.set(key, {sequence: advertisement.sequence, seenAt: now});
    return true;
  }

  prune(now = Date.now()): number {
    let removed = 0;

    for (const [key, entry] of this.seen.entries()) {
      if (now - entry.seenAt >= this.ttlMs) {
        this.seen.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  clear(): void {
    this.seen.clear();
  }
}
