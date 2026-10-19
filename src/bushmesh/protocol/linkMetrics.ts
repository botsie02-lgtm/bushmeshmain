import {assertIntegerInRange} from './codec';
import {BushMeshNodeHello} from './discovery';

export type BushMeshLinkObservation = {
  nodeId: number;
  rssi: number;
  snr: number;
  hopCount?: number;
  batteryPercent?: number;
  seenAt?: number;
};

export type BushMeshNeighbor = {
  nodeId: number;
  lastSeenAt: number;
  rssi: number;
  snr: number;
  smoothedRssi: number;
  smoothedSnr: number;
  hopCount: number;
  batteryPercent?: number;
  hello?: BushMeshNodeHello;
  observations: number;
};

export type BushMeshScoredNeighbor = BushMeshNeighbor & {
  score: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function scoreBushMeshNeighbor(
  neighbor: BushMeshNeighbor,
  now = Date.now(),
): number {
  const rssiScore = clamp((neighbor.smoothedRssi + 130) / 80, 0, 1) * 35;
  const snrScore = clamp((neighbor.smoothedSnr + 20) / 30, 0, 1) * 35;
  const hopScore = clamp(1 - Math.max(0, neighbor.hopCount - 1) * 0.18, 0, 1) * 15;
  const ageMs = Math.max(0, now - neighbor.lastSeenAt);
  const freshnessScore = clamp(1 - ageMs / (5 * 60 * 1000), 0, 1) * 10;
  const batteryScore =
    neighbor.batteryPercent === undefined
      ? 3
      : clamp(neighbor.batteryPercent / 100, 0, 1) * 5;

  return Math.round(
    (rssiScore + snrScore + hopScore + freshnessScore + batteryScore) * 10,
  ) / 10;
}

export class BushMeshNeighborTable {
  private readonly neighbors = new Map<number, BushMeshNeighbor>();

  constructor(
    private readonly smoothingAlpha = 0.35,
    private readonly staleAfterMs = 10 * 60 * 1000,
  ) {
    if (smoothingAlpha <= 0 || smoothingAlpha > 1) {
      throw new Error('Smoothing alpha must be greater than 0 and at most 1.');
    }
  }

  observe(observation: BushMeshLinkObservation): BushMeshNeighbor {
    assertIntegerInRange(observation.nodeId, 0, 0xffffffff, 'Node ID');

    if (!Number.isFinite(observation.rssi) || observation.rssi > 0) {
      throw new Error('RSSI must be a finite value at or below 0 dBm.');
    }

    if (!Number.isFinite(observation.snr)) {
      throw new Error('SNR must be finite.');
    }

    const hopCount = observation.hopCount ?? 1;
    assertIntegerInRange(hopCount, 1, 255, 'Hop count');

    if (observation.batteryPercent !== undefined) {
      assertIntegerInRange(
        observation.batteryPercent,
        0,
        100,
        'Battery percentage',
      );
    }

    const seenAt = observation.seenAt ?? Date.now();
    const existing = this.neighbors.get(observation.nodeId);
    const smoothedRssi = existing
      ? existing.smoothedRssi * (1 - this.smoothingAlpha) +
        observation.rssi * this.smoothingAlpha
      : observation.rssi;
    const smoothedSnr = existing
      ? existing.smoothedSnr * (1 - this.smoothingAlpha) +
        observation.snr * this.smoothingAlpha
      : observation.snr;

    const neighbor: BushMeshNeighbor = {
      nodeId: observation.nodeId,
      lastSeenAt: seenAt,
      rssi: observation.rssi,
      snr: observation.snr,
      smoothedRssi,
      smoothedSnr,
      hopCount,
      batteryPercent:
        observation.batteryPercent ?? existing?.batteryPercent,
      hello: existing?.hello,
      observations: (existing?.observations ?? 0) + 1,
    };

    this.neighbors.set(observation.nodeId, neighbor);
    return {...neighbor};
  }

  updateHello(hello: BushMeshNodeHello, now = Date.now()): BushMeshNeighbor {
    const existing = this.neighbors.get(hello.nodeId);
    const neighbor: BushMeshNeighbor = existing
      ? {
          ...existing,
          hello: {...hello},
          batteryPercent: hello.batteryPercent ?? existing.batteryPercent,
          lastSeenAt: Math.max(existing.lastSeenAt, now),
        }
      : {
          nodeId: hello.nodeId,
          lastSeenAt: now,
          rssi: -130,
          snr: -20,
          smoothedRssi: -130,
          smoothedSnr: -20,
          hopCount: 1,
          batteryPercent: hello.batteryPercent,
          hello: {...hello},
          observations: 0,
        };

    this.neighbors.set(hello.nodeId, neighbor);
    return {...neighbor};
  }

  get(nodeId: number): BushMeshNeighbor | null {
    const neighbor = this.neighbors.get(nodeId);
    return neighbor ? {...neighbor, hello: neighbor.hello && {...neighbor.hello}} : null;
  }

  ranked(now = Date.now()): BushMeshScoredNeighbor[] {
    this.prune(now);

    return Array.from(this.neighbors.values())
      .map(neighbor => ({...neighbor, score: scoreBushMeshNeighbor(neighbor, now)}))
      .sort((a, b) => b.score - a.score || b.lastSeenAt - a.lastSeenAt);
  }

  best(now = Date.now()): BushMeshScoredNeighbor | null {
    return this.ranked(now)[0] ?? null;
  }

  prune(now = Date.now()): number[] {
    const removed: number[] = [];

    for (const [nodeId, neighbor] of this.neighbors.entries()) {
      if (now - neighbor.lastSeenAt >= this.staleAfterMs) {
        this.neighbors.delete(nodeId);
        removed.push(nodeId);
      }
    }

    return removed;
  }

  size(): number {
    return this.neighbors.size;
  }

  clear(): void {
    this.neighbors.clear();
  }
}
