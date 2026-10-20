import {assertIntegerInRange} from './codec';

export type BushMeshRouteCandidate = {
  destinationNodeId: number;
  nextHopNodeId: number;
  hopCount: number;
  linkScore: number;
  learnedAt: number;
  expiresAt: number;
};

export type BushMeshRouteUpdate = {
  destinationNodeId: number;
  nextHopNodeId: number;
  hopCount: number;
  linkScore: number;
  now?: number;
  ttlMs?: number;
};

export function scoreBushMeshRoute(
  route: BushMeshRouteCandidate,
  now = Date.now(),
): number {
  const ageFraction = Math.max(
    0,
    Math.min(1, (now - route.learnedAt) / Math.max(1, route.expiresAt - route.learnedAt)),
  );
  const hopPenalty = Math.max(0, route.hopCount - 1) * 10;
  const agePenalty = ageFraction * 20;
  return Math.round((route.linkScore - hopPenalty - agePenalty) * 10) / 10;
}

function cloneRoute(route: BushMeshRouteCandidate): BushMeshRouteCandidate {
  return {...route};
}

export class BushMeshRoutingTable {
  private readonly routes = new Map<number, Map<number, BushMeshRouteCandidate>>();

  learn(update: BushMeshRouteUpdate): BushMeshRouteCandidate {
    assertIntegerInRange(
      update.destinationNodeId,
      0,
      0xffffffff,
      'Destination node ID',
    );
    assertIntegerInRange(update.nextHopNodeId, 0, 0xffffffff, 'Next-hop node ID');
    assertIntegerInRange(update.hopCount, 1, 255, 'Route hop count');

    if (!Number.isFinite(update.linkScore)) {
      throw new Error('Route link score must be finite.');
    }

    const now = update.now ?? Date.now();
    const ttlMs = update.ttlMs ?? 5 * 60 * 1000;

    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('Route TTL must be greater than zero.');
    }

    const route: BushMeshRouteCandidate = {
      destinationNodeId: update.destinationNodeId,
      nextHopNodeId: update.nextHopNodeId,
      hopCount: update.hopCount,
      linkScore: update.linkScore,
      learnedAt: now,
      expiresAt: now + ttlMs,
    };

    let candidates = this.routes.get(update.destinationNodeId);

    if (!candidates) {
      candidates = new Map<number, BushMeshRouteCandidate>();
      this.routes.set(update.destinationNodeId, candidates);
    }

    candidates.set(update.nextHopNodeId, route);
    return cloneRoute(route);
  }

  bestRoute(
    destinationNodeId: number,
    now = Date.now(),
    excludedNextHops: number[] = [],
  ): BushMeshRouteCandidate | null {
    this.prune(now);
    const excluded = new Set(excludedNextHops);
    const candidates = this.routes.get(destinationNodeId);

    if (!candidates) {
      return null;
    }

    const ranked = Array.from(candidates.values())
      .filter(route => !excluded.has(route.nextHopNodeId))
      .sort((a, b) => {
        const scoreDifference = scoreBushMeshRoute(b, now) - scoreBushMeshRoute(a, now);

        if (scoreDifference !== 0) {
          return scoreDifference;
        }

        if (a.hopCount !== b.hopCount) {
          return a.hopCount - b.hopCount;
        }

        return b.learnedAt - a.learnedAt;
      });

    return ranked[0] ? cloneRoute(ranked[0]) : null;
  }

  candidates(destinationNodeId: number, now = Date.now()): BushMeshRouteCandidate[] {
    this.prune(now);
    return Array.from(this.routes.get(destinationNodeId)?.values() ?? []).map(
      cloneRoute,
    );
  }

  /**
   * Returns every currently usable route. This is intentionally a plain-data
   * snapshot so it can be persisted by the application without exposing the
   * table's internal maps.
   */
  snapshot(now = Date.now()): BushMeshRouteCandidate[] {
    this.prune(now);
    const snapshot: BushMeshRouteCandidate[] = [];

    for (const candidates of this.routes.values()) {
      for (const route of candidates.values()) {
        snapshot.push(cloneRoute(route));
      }
    }

    return snapshot.sort(
      (a, b) =>
        a.destinationNodeId - b.destinationNodeId ||
        a.nextHopNodeId - b.nextHopNodeId,
    );
  }

  /**
   * Restores non-expired routes using their remaining lifetime rather than
   * extending stale topology information for a fresh full TTL after restart.
   */
  restore(
    snapshot: BushMeshRouteCandidate[],
    options?: {now?: number; replace?: boolean},
  ): number {
    const now = options?.now ?? Date.now();

    if (options?.replace !== false) {
      this.routes.clear();
    }

    let restored = 0;

    for (const route of snapshot) {
      if (
        !route ||
        !Number.isInteger(route.destinationNodeId) ||
        route.destinationNodeId < 0 ||
        route.destinationNodeId > 0xffffffff ||
        !Number.isInteger(route.nextHopNodeId) ||
        route.nextHopNodeId < 0 ||
        route.nextHopNodeId > 0xffffffff ||
        !Number.isInteger(route.hopCount) ||
        route.hopCount < 1 ||
        route.hopCount > 255 ||
        !Number.isFinite(route.linkScore) ||
        !Number.isFinite(route.learnedAt) ||
        !Number.isFinite(route.expiresAt) ||
        route.expiresAt <= now ||
        route.expiresAt < route.learnedAt
      ) {
        continue;
      }

      this.learn({
        destinationNodeId: route.destinationNodeId,
        nextHopNodeId: route.nextHopNodeId,
        hopCount: route.hopCount,
        linkScore: route.linkScore,
        now,
        ttlMs: route.expiresAt - now,
      });
      restored += 1;
    }

    return restored;
  }

  removeVia(nextHopNodeId: number): number {
    let removed = 0;

    for (const [destination, candidates] of this.routes.entries()) {
      if (candidates.delete(nextHopNodeId)) {
        removed += 1;
      }

      if (candidates.size === 0) {
        this.routes.delete(destination);
      }
    }

    return removed;
  }

  prune(now = Date.now()): number {
    let removed = 0;

    for (const [destination, candidates] of this.routes.entries()) {
      for (const [nextHop, route] of candidates.entries()) {
        if (route.expiresAt <= now) {
          candidates.delete(nextHop);
          removed += 1;
        }
      }

      if (candidates.size === 0) {
        this.routes.delete(destination);
      }
    }

    return removed;
  }

  clear(): void {
    this.routes.clear();
  }
}
