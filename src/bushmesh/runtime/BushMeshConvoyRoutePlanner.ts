import {BushMeshRouteCandidate} from '../protocol';
import {BushMeshConvoyTracker} from './BushMeshConvoyTracker';
import {BushMeshPeerRegistry} from './BushMeshPeerRegistry';

export type BushMeshConvoyRoutePlan = {
  convoyId: number;
  sourceNodeId: number;
  destinationNodeId: number;
  orderedPath: number[];
  preferredNextHopNodeId: number;
  alternates: number[];
  nextHopRoute: BushMeshRouteCandidate | null;
  destinationRoute: BushMeshRouteCandidate | null;
  strategy: 'direct' | 'convoy-adjacent-relay';
};

/**
 * Produces a convoy-aware route hint. Rather than flooding toward every known
 * node, the planner prefers the next healthy vehicle physically positioned in
 * convoy order between source and destination. Link-routing data remains a
 * secondary hint and can still resolve the radio path to that vehicle.
 */
export class BushMeshConvoyRoutePlanner {
  constructor(
    private readonly tracker: BushMeshConvoyTracker,
    private readonly peers?: BushMeshPeerRegistry,
  ) {}

  plan(
    convoyId: number,
    sourceNodeId: number,
    destinationNodeId: number,
    now = Date.now(),
  ): BushMeshConvoyRoutePlan {
    const relays = this.tracker.relayCandidates(
      convoyId,
      sourceNodeId,
      destinationNodeId,
      now,
    );
    const orderedPath = [sourceNodeId, ...relays, destinationNodeId];
    const preferredNextHopNodeId = relays[0] ?? destinationNodeId;
    const alternates = relays.slice(1).concat(
      preferredNextHopNodeId === destinationNodeId ? [] : [destinationNodeId],
    );

    return {
      convoyId,
      sourceNodeId,
      destinationNodeId,
      orderedPath,
      preferredNextHopNodeId,
      alternates,
      nextHopRoute:
        this.peers?.bestRoute(preferredNextHopNodeId, now) ?? null,
      destinationRoute:
        this.peers?.bestRoute(destinationNodeId, now) ?? null,
      strategy: relays.length > 0 ? 'convoy-adjacent-relay' : 'direct',
    };
  }

  /**
   * Picks the first relay that still has a usable route after excluding failed
   * radio next hops. If no intermediate convoy member is usable, it falls back
   * to the destination and lets the caller decide between direct send,
   * store-and-forward, or controlled flooding.
   */
  selectReachableNextHop(
    convoyId: number,
    sourceNodeId: number,
    destinationNodeId: number,
    excludedRadioNextHops: number[] = [],
    now = Date.now(),
  ): {
    logicalNextHopNodeId: number;
    radioRoute: BushMeshRouteCandidate | null;
  } {
    const plan = this.plan(convoyId, sourceNodeId, destinationNodeId, now);
    const logicalCandidates = [
      plan.preferredNextHopNodeId,
      ...plan.alternates,
    ].filter((nodeId, index, values) => values.indexOf(nodeId) === index);

    if (!this.peers) {
      return {
        logicalNextHopNodeId: logicalCandidates[0] ?? destinationNodeId,
        radioRoute: null,
      };
    }

    for (const logicalNodeId of logicalCandidates) {
      const route = this.peers.bestRoute(
        logicalNodeId,
        now,
        excludedRadioNextHops,
      );
      if (route) {
        return {logicalNextHopNodeId: logicalNodeId, radioRoute: route};
      }
    }

    return {logicalNextHopNodeId: destinationNodeId, radioRoute: null};
  }
}
