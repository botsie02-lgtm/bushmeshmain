import {
  BushMeshLinkObservation,
  BushMeshNeighbor,
  BushMeshNeighborTable,
  BushMeshNodeHello,
  BushMeshPeerPolicy,
  BushMeshRouteAdvertisement,
  BushMeshRouteAdvertisementTracker,
  BushMeshRouteCandidate,
  BushMeshRoutingTable,
  learnRouteAdvertisement,
  negotiateBushMeshPeerPolicy,
  scoreBushMeshNeighbor,
} from '../protocol';

export type BushMeshKnownPeer = {
  nodeId: number;
  hello: BushMeshNodeHello;
  firstSeenAt: number;
  lastSeenAt: number;
  policy: BushMeshPeerPolicy;
  neighbor: BushMeshNeighbor | null;
};

export type BushMeshPeerSnapshot = {
  hello: BushMeshNodeHello;
  firstSeenAt: number;
  lastSeenAt: number;
  neighbor?: {
    rssi: number;
    snr: number;
    hopCount: number;
    batteryPercent?: number;
    lastSeenAt: number;
  };
};

export type BushMeshPeerRegistrySnapshot = {
  version: 1;
  savedAt: number;
  peers: BushMeshPeerSnapshot[];
  routes: BushMeshRouteCandidate[];
};

export class BushMeshPeerRegistry {
  readonly neighbors: BushMeshNeighborTable;
  readonly routes: BushMeshRoutingTable;
  readonly routeFreshness: BushMeshRouteAdvertisementTracker;

  private readonly peers = new Map<number, BushMeshKnownPeer>();

  constructor(
    private readonly localHello: BushMeshNodeHello,
    options?: {
      staleNeighborAfterMs?: number;
      routeFreshnessTtlMs?: number;
      allowExperimentalBinary?: boolean;
    },
  ) {
    this.neighbors = new BushMeshNeighborTable(
      0.35,
      options?.staleNeighborAfterMs ?? 10 * 60 * 1000,
    );
    this.routes = new BushMeshRoutingTable();
    this.routeFreshness = new BushMeshRouteAdvertisementTracker(
      options?.routeFreshnessTtlMs ?? 10 * 60 * 1000,
    );
    this.allowExperimentalBinary = options?.allowExperimentalBinary ?? false;
  }

  private readonly allowExperimentalBinary: boolean;

  upsertHello(
    hello: BushMeshNodeHello,
    options?: {
      now?: number;
      observation?: Omit<BushMeshLinkObservation, 'nodeId'>;
    },
  ): BushMeshKnownPeer {
    const now = options?.now ?? Date.now();

    if (options?.observation) {
      this.neighbors.observe({
        nodeId: hello.nodeId,
        ...options.observation,
        seenAt: options.observation.seenAt ?? now,
      });
    }

    const neighbor = this.neighbors.updateHello(hello, now);
    const existing = this.peers.get(hello.nodeId);
    const peer: BushMeshKnownPeer = {
      nodeId: hello.nodeId,
      hello: {...hello},
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      policy: negotiateBushMeshPeerPolicy(this.localHello, hello, {
        allowExperimentalBinary: this.allowExperimentalBinary,
      }),
      neighbor,
    };

    this.peers.set(hello.nodeId, peer);

    const linkScore = scoreBushMeshNeighbor(neighbor, now);
    this.routes.learn({
      destinationNodeId: hello.nodeId,
      nextHopNodeId: hello.nodeId,
      hopCount: 1,
      linkScore,
      now,
    });

    return this.clonePeer(peer);
  }

  observeLink(observation: BushMeshLinkObservation): BushMeshNeighbor {
    const neighbor = this.neighbors.observe(observation);
    const peer = this.peers.get(observation.nodeId);

    if (peer) {
      peer.lastSeenAt = observation.seenAt ?? Date.now();
      peer.neighbor = neighbor;
      this.routes.learn({
        destinationNodeId: observation.nodeId,
        nextHopNodeId: observation.nodeId,
        hopCount: observation.hopCount ?? 1,
        linkScore: scoreBushMeshNeighbor(neighbor, observation.seenAt),
        now: observation.seenAt,
      });
    }

    return neighbor;
  }

  acceptRouteAdvertisement(
    advertisement: BushMeshRouteAdvertisement,
    previousHopNodeId: number,
    options?: {now?: number; ttlMs?: number},
  ): boolean {
    const now = options?.now ?? Date.now();

    if (
      !this.routeFreshness.accept(advertisement, previousHopNodeId, now)
    ) {
      return false;
    }

    const previousHop = this.neighbors.get(previousHopNodeId);
    const previousHopLinkScore = previousHop
      ? scoreBushMeshNeighbor(previousHop, now)
      : 0;

    learnRouteAdvertisement(
      this.routes,
      advertisement,
      previousHopNodeId,
      previousHopLinkScore,
      {now, ttlMs: options?.ttlMs},
    );

    return true;
  }

  get(nodeId: number): BushMeshKnownPeer | null {
    const peer = this.peers.get(nodeId);
    return peer ? this.clonePeer(peer) : null;
  }

  all(now = Date.now()): BushMeshKnownPeer[] {
    this.prune(now);

    return Array.from(this.peers.values())
      .map(peer => this.clonePeer(peer))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.nodeId - b.nodeId);
  }

  compatiblePeers(now = Date.now()): BushMeshKnownPeer[] {
    return this.all(now).filter(peer => peer.policy.compatible);
  }

  bestRoute(
    destinationNodeId: number,
    now = Date.now(),
    excludedNextHops: number[] = [],
  ): BushMeshRouteCandidate | null {
    return this.routes.bestRoute(destinationNodeId, now, excludedNextHops);
  }

  peerPolicy(nodeId: number): BushMeshPeerPolicy | null {
    const peer = this.peers.get(nodeId);
    return peer ? {...peer.policy} : null;
  }

  snapshot(now = Date.now()): BushMeshPeerRegistrySnapshot {
    this.prune(now);

    return {
      version: 1,
      savedAt: now,
      peers: Array.from(this.peers.values()).map(peer => ({
        hello: {...peer.hello},
        firstSeenAt: peer.firstSeenAt,
        lastSeenAt: peer.lastSeenAt,
        neighbor: peer.neighbor
          ? {
              rssi: peer.neighbor.smoothedRssi,
              snr: peer.neighbor.smoothedSnr,
              hopCount: peer.neighbor.hopCount,
              batteryPercent: peer.neighbor.batteryPercent,
              lastSeenAt: peer.neighbor.lastSeenAt,
            }
          : undefined,
      })),
      routes: this.routes.snapshot(now),
    };
  }

  /**
   * Restores peer capability and topology hints without extending the lifetime
   * of stale routes. Fresh discovery traffic will naturally replace this state.
   */
  restore(
    snapshot: BushMeshPeerRegistrySnapshot,
    options?: {now?: number; replace?: boolean},
  ): {peers: number; routes: number} {
    const now = options?.now ?? Date.now();

    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.peers)) {
      throw new Error('Unsupported BushMesh peer-registry snapshot.');
    }

    if (options?.replace !== false) {
      this.clear();
    }

    let restoredPeers = 0;

    for (const entry of snapshot.peers) {
      if (
        !entry ||
        !entry.hello ||
        !Number.isFinite(entry.firstSeenAt) ||
        !Number.isFinite(entry.lastSeenAt) ||
        entry.firstSeenAt < 0 ||
        entry.lastSeenAt < entry.firstSeenAt
      ) {
        continue;
      }

      // Do not resurrect peers whose most recent observation is already older
      // than the normal neighbor retention horizon after the table prunes it.
      const observation = entry.neighbor
        ? {
            rssi: entry.neighbor.rssi,
            snr: entry.neighbor.snr,
            hopCount: entry.neighbor.hopCount,
            batteryPercent: entry.neighbor.batteryPercent,
            seenAt: entry.neighbor.lastSeenAt,
          }
        : undefined;

      try {
        this.upsertHello(entry.hello, {
          now: entry.lastSeenAt,
          observation,
        });
        const restored = this.peers.get(entry.hello.nodeId);
        if (restored) {
          restored.firstSeenAt = entry.firstSeenAt;
          restored.lastSeenAt = entry.lastSeenAt;
          restoredPeers += 1;
        }
      } catch {
        // Corrupt individual peer entries are skipped rather than making the
        // entire topology snapshot unusable.
      }
    }

    this.prune(now);
    const restoredRoutes = Array.isArray(snapshot.routes)
      ? this.routes.restore(snapshot.routes, {now, replace: false})
      : 0;

    return {peers: restoredPeers, routes: restoredRoutes};
  }

  prune(now = Date.now()): number[] {
    const removedNeighbors = this.neighbors.prune(now);
    const removedSet = new Set(removedNeighbors);

    for (const nodeId of removedNeighbors) {
      this.peers.delete(nodeId);
      this.routes.removeVia(nodeId);
    }

    this.routes.prune(now);
    this.routeFreshness.prune(now);

    return Array.from(removedSet);
  }

  clear(): void {
    this.peers.clear();
    this.neighbors.clear();
    this.routes.clear();
    this.routeFreshness.clear();
  }

  private clonePeer(peer: BushMeshKnownPeer): BushMeshKnownPeer {
    return {
      ...peer,
      hello: {...peer.hello},
      policy: {...peer.policy},
      neighbor: peer.neighbor
        ? {
            ...peer.neighbor,
            hello: peer.neighbor.hello && {...peer.neighbor.hello},
          }
        : null,
    };
  }
}
