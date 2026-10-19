import {assertIntegerInRange} from './codec';
import {
  BushMeshMessageIdentity,
  BushMeshRecentMessageCache,
} from './messageIdentity';

export type BushMeshForwardingInput = BushMeshMessageIdentity & {
  localNodeId: number;
  previousHopNodeId?: number;
  destinationNodeId?: number;
  ttlHops: number;
};

export type BushMeshForwardingDecision = {
  forward: boolean;
  deliverLocally: boolean;
  reason:
    | 'duplicate'
    | 'originated-locally'
    | 'destination-reached'
    | 'ttl-expired'
    | 'forward';
  nextTtlHops: number;
  jitterMs: number;
};

function deterministicJitter(
  sourceNodeId: number,
  messageId: number,
  minMs: number,
  maxMs: number,
): number {
  let hash = (sourceNodeId ^ messageId ^ 0x9e3779b9) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  const span = maxMs - minMs + 1;
  return minMs + (hash % span);
}

export class BushMeshControlledFloodForwarder {
  private readonly seen: BushMeshRecentMessageCache;

  constructor(
    seen = new BushMeshRecentMessageCache(),
    private readonly minJitterMs = 120,
    private readonly maxJitterMs = 650,
  ) {
    if (minJitterMs < 0 || maxJitterMs < minJitterMs) {
      throw new Error('Forwarding jitter range is invalid.');
    }

    this.seen = seen;
  }

  evaluate(
    input: BushMeshForwardingInput,
    now = Date.now(),
  ): BushMeshForwardingDecision {
    assertIntegerInRange(input.localNodeId, 0, 0xffffffff, 'Local node ID');
    assertIntegerInRange(input.ttlHops, 0, 255, 'TTL hops');

    if (input.sourceNodeId === input.localNodeId) {
      this.seen.remember(input, now);
      return {
        forward: false,
        deliverLocally: false,
        reason: 'originated-locally',
        nextTtlHops: input.ttlHops,
        jitterMs: 0,
      };
    }

    const duplicate = this.seen.checkAndRemember(input, now);

    if (duplicate) {
      return {
        forward: false,
        deliverLocally: false,
        reason: 'duplicate',
        nextTtlHops: input.ttlHops,
        jitterMs: 0,
      };
    }

    const destinationReached = input.destinationNodeId === input.localNodeId;

    if (destinationReached) {
      return {
        forward: false,
        deliverLocally: true,
        reason: 'destination-reached',
        nextTtlHops: input.ttlHops,
        jitterMs: 0,
      };
    }

    if (input.ttlHops <= 0) {
      return {
        forward: false,
        deliverLocally: input.destinationNodeId === undefined,
        reason: 'ttl-expired',
        nextTtlHops: 0,
        jitterMs: 0,
      };
    }

    return {
      forward: true,
      deliverLocally: input.destinationNodeId === undefined,
      reason: 'forward',
      nextTtlHops: input.ttlHops - 1,
      jitterMs: deterministicJitter(
        input.sourceNodeId,
        input.messageId,
        this.minJitterMs,
        this.maxJitterMs,
      ),
    };
  }
}
