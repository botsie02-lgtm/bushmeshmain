import {
  assertBushMeshPeerPolicyNotDowngraded,
  evaluateBushMeshPeerPolicyDowngrade,
  negotiateBushMeshPeerPolicy,
} from '../src/bushmesh/protocol/capabilityPolicy';
import {
  BUSHMESH_DEFAULT_CAPABILITIES,
  BushMeshCapability,
  BushMeshNodeHello,
  BushMeshNodeRole,
} from '../src/bushmesh/protocol/discovery';
import {BushMeshDeliveryQueue} from '../src/bushmesh/protocol/deliveryQueue';
import {BushMeshControlledFloodForwarder} from '../src/bushmesh/protocol/forwarding';
import {BushMeshPriority} from '../src/bushmesh/protocol/codec';
import {
  BushMeshTransportQueue,
  BushMeshTransportQueueFullError,
} from '../src/bushmesh/runtime/BushMeshTransportQueue';

function hello(capabilities: number): BushMeshNodeHello {
  return {
    nodeId: 1,
    capabilities,
    role: BushMeshNodeRole.Vehicle,
    protocolMinVersion: 1,
    protocolMaxVersion: 1,
    dictionaryVersion: 1,
  };
}

describe('BushMesh integration safety invariants', () => {
  it('detects capability loss after a previously accepted peer policy', () => {
    const local = hello(
      BUSHMESH_DEFAULT_CAPABILITIES | BushMeshCapability.LinkRouting,
    );
    const previous = negotiateBushMeshPeerPolicy(local, hello(local.capabilities));
    const next = negotiateBushMeshPeerPolicy(
      local,
      hello(local.capabilities & ~BushMeshCapability.Fragmentation),
    );

    const downgrade = evaluateBushMeshPeerPolicyDowngrade(previous, next);
    expect(downgrade.downgraded).toBe(true);
    expect(
      (downgrade.removedCapabilities & BushMeshCapability.Fragmentation) !== 0,
    ).toBe(true);
    expect(() =>
      assertBushMeshPeerPolicyNotDowngraded(previous, next),
    ).toThrow(/capability downgrade/i);
  });

  it('suppresses forwarding loops/duplicates and respects TTL expiry', () => {
    const forwarder = new BushMeshControlledFloodForwarder();
    const packet = {
      sourceNodeId: 10,
      messageId: 99,
      localNodeId: 20,
      previousHopNodeId: 30,
      destinationNodeId: 40,
      ttlHops: 2,
    };

    expect(forwarder.evaluate(packet, 1000)).toMatchObject({
      forward: true,
      nextTtlHops: 1,
      reason: 'forward',
    });
    expect(forwarder.evaluate(packet, 1001)).toMatchObject({
      forward: false,
      reason: 'duplicate',
    });

    const freshForwarder = new BushMeshControlledFloodForwarder();
    expect(
      freshForwarder.evaluate({...packet, messageId: 100, ttlHops: 0}, 1000),
    ).toMatchObject({forward: false, reason: 'ttl-expired'});
  });

  it('drops expired delivery work instead of restoring or transmitting it', () => {
    const queue = new BushMeshDeliveryQueue();
    queue.enqueue(7, [0xb5, 0x4d, 0x41], {
      now: 1000,
      ttlMs: 100,
      maxAttempts: 3,
    });

    expect(queue.size()).toBe(1);
    expect(queue.ready(1099)).toHaveLength(1);
    expect(queue.ready(1100)).toHaveLength(0);
    expect(queue.size()).toBe(0);
  });

  it('admits emergency work under congestion by displacing lower-priority pending work', async () => {
    const queue = new BushMeshTransportQueue(1);
    let releaseActive: (() => void) | undefined;

    const active = queue.enqueue(BushMeshPriority.Background, async () => {
      await new Promise<void>(resolve => {
        releaseActive = resolve;
      });
      return 'active';
    });

    const background = queue.enqueue(
      BushMeshPriority.Background,
      async () => 'background',
      1001,
    );
    const backgroundOutcome = background.catch(error => error);

    const emergency = queue.enqueue(
      BushMeshPriority.Emergency,
      async () => 'emergency',
      1002,
    );

    expect(queue.snapshot()).toMatchObject({
      active: true,
      pendingCount: 1,
      nextPriority: BushMeshPriority.Emergency,
    });

    releaseActive?.();
    await expect(active).resolves.toBe('active');
    expect(await backgroundOutcome).toBeInstanceOf(
      BushMeshTransportQueueFullError,
    );
    await expect(emergency).resolves.toBe('emergency');
  });
});
