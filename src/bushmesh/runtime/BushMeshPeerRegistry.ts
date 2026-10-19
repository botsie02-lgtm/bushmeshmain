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
