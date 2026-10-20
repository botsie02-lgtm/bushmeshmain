import {BushMeshPriority, BushMeshRouteCandidate} from '../protocol';
import {BushMeshAirtimeController} from './BushMeshAirtimeController';
import {BushMeshPeerRegistry} from './BushMeshPeerRegistry';

export type BushMeshRouteAction =
  | 'direct-next-hop'
  | 'controlled-flood'
  | 'store-forward'
  | 'drop';

export type BushMeshRouteDecision = {
  action: BushMeshRouteAction;
  destinationNodeId?: number;
  nextHopNodeId?: number;
  route?: BushMeshRouteCandidate;
  ttlHops: number;
  priority: BushMeshPriority | number;
  estimatedAirtimeMs?: number;
  reason: string;
};

export class BushMeshRouteDecisionEngine {
  constructor(
    private readonly peers: BushMeshPeerRegistry,
    private readonly airtime?: BushMeshAirtimeController,
  ) {}

  decide(options: {
    destinationNodeId?: number;
    payloadBytes: number;
    priority?: BushMeshPriority | number;
    ttlHops?: number;
    storeAndForward?: boolean;
    excludedNextHops?: number[];
    now?: number;
  }): BushMeshRouteDecision {
    const priority = options.priority ?? BushMeshPriority.DirectMessage;
    const ttlHops = options.ttlHops ?? 4;
    const now = options.now ?? Date.now();

    if (!Number.isInteger(ttlHops) || ttlHops < 0 || ttlHops > 255) {
      throw new Error('BushMesh route TTL must be an integer from 0 to 255.');
    }
    if (!Number.isInteger(options.payloadBytes) || options.payloadBytes < 0) {
      throw new Error('BushMesh route payload size must be a non-negative integer.');
    }

    const airtime = this.airtime?.evaluate(
      options.payloadBytes,
      priority,
      now,
    );

    if (airtime && !airtime.allowed && priority !== BushMeshPriority.Emergency) {
      return {
        action: options.storeAndForward === false ? 'drop' : 'store-forward',
        destinationNodeId: options.destinationNodeId,
        ttlHops,
        priority,
        estimatedAirtimeMs: airtime.estimatedAirtimeMs,
        reason:
          options.storeAndForward === false
            ? 'Airtime budget is exhausted and delayed delivery is disabled.'
            : 'Airtime budget is exhausted; defer until airtime becomes available.',
      };
    }

    if (ttlHops === 0) {
      return {
        action: 'drop',
        destinationNodeId: options.destinationNodeId,
        ttlHops: 0,
        priority,
        estimatedAirtimeMs: airtime?.estimatedAirtimeMs,
        reason: 'Hop TTL is exhausted.',
      };
    }

    if (options.destinationNodeId === undefined) {
      return {
        action: 'controlled-flood',
        ttlHops,
        priority,
        estimatedAirtimeMs: airtime?.estimatedAirtimeMs,
        reason: 'Broadcast traffic has no single destination; use controlled flooding.',
      };
    }

    const route = this.peers.bestRoute(
      options.destinationNodeId,
      now,
      options.excludedNextHops ?? [],
    );

    if (route) {
      return {
        action: 'direct-next-hop',
        destinationNodeId: options.destinationNodeId,
        nextHopNodeId: route.nextHopNodeId,
        route,
        ttlHops,
        priority,
        estimatedAirtimeMs: airtime?.estimatedAirtimeMs,
        reason: `Selected route via ${route.nextHopNodeId.toString(16).padStart(8, '0')} at ${route.hopCount} hop(s).`,
      };
    }

    if (priority === BushMeshPriority.Emergency) {
      return {
        action: 'controlled-flood',
        destinationNodeId: options.destinationNodeId,
        ttlHops,
        priority,
        estimatedAirtimeMs: airtime?.estimatedAirtimeMs,
        reason: 'No known route for emergency traffic; use controlled flood fallback.',
      };
    }

    if (options.storeAndForward !== false) {
      return {
        action: 'store-forward',
        destinationNodeId: options.destinationNodeId,
        ttlHops,
        priority,
        estimatedAirtimeMs: airtime?.estimatedAirtimeMs,
        reason: 'No current route to destination; retain for opportunistic delivery.',
      };
    }

    return {
      action: 'controlled-flood',
      destinationNodeId: options.destinationNodeId,
      ttlHops,
      priority,
      estimatedAirtimeMs: airtime?.estimatedAirtimeMs,
      reason: 'No known route and delayed delivery is disabled; use bounded flood fallback.',
    };
  }

  recordTransmission(
    payloadBytes: number,
    priority: BushMeshPriority | number,
    now = Date.now(),
  ): void {
    this.airtime?.record(payloadBytes, priority, now);
  }
}
