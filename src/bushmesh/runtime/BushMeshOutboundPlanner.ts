import {BushMeshPeerPolicy, BushMeshPriority} from '../protocol';
import {
  BushMeshAdaptivePayloadDecision,
  BushMeshAdaptivePayloadPolicy,
  BushMeshPayloadKind,
} from './BushMeshAdaptivePayloadPolicy';
import {
  BushMeshRouteDecision,
  BushMeshRouteDecisionEngine,
} from './BushMeshRouteDecisionEngine';

export type BushMeshOutboundPlan = {
  payload: BushMeshAdaptivePayloadDecision;
  route: BushMeshRouteDecision;
  shouldQueue: boolean;
  canTransmitNow: boolean;
};

/**
 * Produces one authoritative decision for an outbound BushMesh operation.
 * Compression/transport compatibility and network route/congestion decisions
 * are evaluated together so callers cannot accidentally select an efficient
 * encoding that the chosen peer/path cannot support.
 */
export class BushMeshOutboundPlanner {
  constructor(
    private readonly routeEngine: BushMeshRouteDecisionEngine,
    private readonly payloadPolicy = new BushMeshAdaptivePayloadPolicy(),
  ) {}

  plan(options: {
    kind: BushMeshPayloadKind;
    payloadBytes: number;
    peerPolicy?: BushMeshPeerPolicy | null;
    destinationNodeId?: number;
    priority?: BushMeshPriority | number;
    ttlHops?: number;
    storeAndForward?: boolean;
    excludedNextHops?: number[];
    allowExperimentalBinary?: boolean;
    preferSemanticText?: boolean;
    preferDelta?: boolean;
    now?: number;
  }): BushMeshOutboundPlan {
    const payload = this.payloadPolicy.decide(
      options.kind,
      options.peerPolicy,
      {
        allowExperimentalBinary: options.allowExperimentalBinary,
        preferSemanticText: options.preferSemanticText,
        preferDelta: options.preferDelta,
        storeAndForward: options.storeAndForward,
      },
    );

    const priority = options.priority ?? payload.priority;
    const route = this.routeEngine.decide({
      destinationNodeId: options.destinationNodeId,
      payloadBytes: options.payloadBytes,
      priority,
      ttlHops: options.ttlHops,
      storeAndForward:
        options.storeAndForward !== false && payload.allowStoreAndForward,
      excludedNextHops: options.excludedNextHops,
      now: options.now,
    });

    const shouldQueue = route.action === 'store-forward';
    const canTransmitNow =
      payload.supported &&
      route.action !== 'drop' &&
      route.action !== 'store-forward';

    return {
      payload,
      route,
      shouldQueue,
      canTransmitNow,
    };
  }

  recordTransmitted(
    payloadBytes: number,
    priority: BushMeshPriority | number,
    now = Date.now(),
  ): void {
    this.routeEngine.recordTransmission(payloadBytes, priority, now);
  }
}
