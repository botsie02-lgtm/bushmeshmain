import {
  BushMeshPacketType,
  BushMeshPriority,
  decodeBushMeshSecurityContainer,
  encodeBushMeshConvoyWire,
  encodeBushMeshProtectedDirectContainer,
  encodeBushMeshWire,
  fragmentBushMeshDatagramPayload,
} from '../src/bushmesh/protocol/public';
import {
  DeterministicBushMeshNetworkSimulator,
  INITIAL_NETWORK_SIMULATOR_SCENARIOS,
  NetworkSimulatorScenarioResult,
  scenarioThirtyFivePercentLoss,
  throwScenarioFailure,
} from '../src/bushmesh/testing/networkSimulator';

type ScenarioRunner = () => Promise<NetworkSimulatorScenarioResult>;

const scenarioCases: Array<[string, ScenarioRunner]> = [
  [
    'three-node convoy B disappears for 90 seconds and rejoins',
    INITIAL_NETWORK_SIMULATOR_SCENARIOS[0],
  ],
  ['35% random packet loss', INITIAL_NETWORK_SIMULATOR_SCENARIOS[1]],
  ['network partition followed by healing', INITIAL_NETWORK_SIMULATOR_SCENARIOS[2]],
  [
    'node loses GPS while remaining connected',
    INITIAL_NETWORK_SIMULATOR_SCENARIOS[3],
  ],
  [
    'route/path quality changes while traffic is active',
    INITIAL_NETWORK_SIMULATOR_SCENARIOS[4],
  ],
  [
    'congestion with ordinary traffic followed by an SOS',
    INITIAL_NETWORK_SIMULATOR_SCENARIOS[5],
  ],
  ['duplicate and delayed packet storm', INITIAL_NETWORK_SIMULATOR_SCENARIOS[6]],
  [
    'store-and-forward through a temporarily unreachable destination',
    INITIAL_NETWORK_SIMULATOR_SCENARIOS[7],
  ],
  [
    'node restart with persisted runtime state',
    INITIAL_NETWORK_SIMULATOR_SCENARIOS[8],
  ],
  ['long-running seeded soak', INITIAL_NETWORK_SIMULATOR_SCENARIOS[9]],
];

function wire(messageId: number, payloadBytes = 8): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Message,
    priority: BushMeshPriority.DirectMessage,
    messageId,
    ackRequested: false,
    payload: Array.from(
      {length: payloadBytes},
      (_, index) => (messageId + index) & 0xff,
    ),
  });
}

describe('deterministic BushMesh network simulator', () => {
  jest.setTimeout(30_000);

  it.each(scenarioCases)('%s', async (_name, run) => {
    const result = await run();
    throwScenarioFailure(result);
    expect(result.failures).toEqual([]);
  });

  it('reproduces the same chaos metrics from the same seed', async () => {
    const first = await scenarioThirtyFivePercentLoss(0x13579bdf);
    const second = await scenarioThirtyFivePercentLoss(0x13579bdf);

    expect(first.simulator.metrics).toEqual(second.simulator.metrics);
    expect(first.simulator.trace).toEqual(second.simulator.trace);
  });

  it('models asymmetric links without changing the datagram payload', async () => {
    const sim = new DeterministicBushMeshNetworkSimulator(0x2468ace0);
    const a = await sim.addNode({id: 1, name: 'A'});
    const b = await sim.addNode({id: 2, name: 'B'});
    sim.setLink(1, 2, {lossRate: 0});
    sim.setLink(2, 1, {lossRate: 1});

    const aWire = wire(100);
    const bWire = wire(101);
    const outboundA = await a.prepareOutbound(aWire);
    const outboundB = await b.prepareOutbound(bWire);
    const originalPayload = Array.from(outboundA.payload);

    await sim.transmit(1, 2, outboundA);
    await sim.transmit(2, 1, outboundB);
    await sim.runUntilIdle();

    expect(Array.from(outboundA.payload)).toEqual(originalPayload);
    expect(sim.metrics.deliveredDatagrams).toBe(1);
    expect(sim.metrics.failedDatagrams).toBe(1);
    expect(sim.metrics.droppedLoss).toBe(1);
  });

  it('enforces payload limits and expires queued work under airtime congestion', async () => {
    const sim = new DeterministicBushMeshNetworkSimulator(0x10203040);
    const a = await sim.addNode({id: 1, name: 'A'});
    await sim.addNode({id: 2, name: 'B'});
    sim.setLink(1, 2, {
      bitrateBps: 80,
      maxPayloadBytes: 24,
      maxQueueBytes: 4096,
    });

    const oversized = await a.prepareOutbound(wire(200, 40));
    await sim.transmit(1, 2, oversized);

    const blocking = await a.prepareOutbound(wire(201, 8));
    await sim.transmit(1, 2, blocking);

    const expiring = await a.prepareOutbound(wire(202, 8), {
      expiresAtMs: sim.clock.now() + 100,
    });
    await sim.transmit(1, 2, expiring);
    await sim.runUntilIdle();

    expect(sim.metrics.droppedOversize).toBe(1);
    expect(sim.metrics.droppedExpired).toBe(1);
    expect(sim.metrics.deliveredDatagrams).toBe(1);
  });

  it('recovers deferred work after a carrier reconnect', async () => {
    const sim = new DeterministicBushMeshNetworkSimulator(0x55667788);
    const a = await sim.addNode({id: 1, name: 'A'});
    await sim.addNode({id: 2, name: 'B'});
    sim.setLink(1, 2, {});
    sim.setCarrierAvailable(2, false);

    const outbound = await a.prepareOutbound(wire(300));
    await sim.transmit(1, 2, outbound, {storeIfUnavailable: true});
    await sim.advanceBy(5_000);
    expect(sim.metrics.deliveredDatagrams).toBe(0);

    sim.setCarrierAvailable(2, true);
    await sim.runUntilIdle();

    expect(sim.metrics.carrierDisconnects).toBe(1);
    expect(sim.metrics.carrierReconnects).toBe(1);
    expect(sim.metrics.storeAndForwardRecoveries).toBe(1);
    expect(sim.metrics.deliveredDatagrams).toBe(1);
  });

  it('does not strand queued work when link quality changes during airtime', async () => {
    const sim = new DeterministicBushMeshNetworkSimulator(0x11223344);
    const a = await sim.addNode({id: 1, name: 'A'});
    await sim.addNode({id: 2, name: 'B'});
    sim.setLink(1, 2, {bitrateBps: 80, rssiDbm: -78, snrDb: 10});

    const first = await a.prepareOutbound(wire(400));
    const second = await a.prepareOutbound(wire(401));
    await sim.transmit(1, 2, first);
    await sim.transmit(1, 2, second);

    // The first packet is already occupying airtime here. Changing quality must
    // mutate the existing virtual link rather than orphan its completion event.
    sim.setLink(1, 2, {rssiDbm: -112, snrDb: -7});
    await sim.runUntilIdle();

    expect(sim.metrics.linkQualityChanges).toBe(1);
    expect(sim.metrics.deliveredDatagrams).toBe(2);
    expect(sim.pendingWorkCount()).toBe(0);
  });

  it('lets the canonical runtime own protected fragment reassembly and fragment-pending', async () => {
    const sim = new DeterministicBushMeshNetworkSimulator(0x44556677);
    const a = await sim.addNode({id: 1, name: 'A'});
    const b = await sim.addNode({id: 2, name: 'B'});
    sim.setLink(1, 2, {lossRate: 0, baseDelayMs: 1});

    const protectedDatagram = await a.prepareOutbound(wire(500, 96), {
      trafficClass: 'direct-message',
      identityAssociation: {kind: 'direct-session', sessionId: 'frag-session'},
      securityRouting: {sourceNodeId: 1, destinationNodeId: 2},
    });
    const fragments = fragmentBushMeshDatagramPayload(
      Array.from(protectedDatagram.payload),
      500,
      24,
    );
    expect(fragments.length).toBeGreaterThan(1);

    for (let index = 0; index < fragments.length; index += 1) {
      const fragmentDatagram = await a.prepareOutbound(fragments[index]);
      await sim.transmit(1, 2, fragmentDatagram);
      await sim.runUntilIdle();

      if (index < fragments.length - 1) {
        expect(b.lastInboundResult?.status).toBe('fragment-pending');
        expect(sim.metrics.deliveredDatagrams).toBe(0);
      }
    }

    expect(b.lastInboundResult).toMatchObject({
      status: 'accepted',
      kind: 'protocol',
      protected: true,
      securityMode: 'protected-direct',
      securityRouting: {sourceNodeId: 1, destinationNodeId: 2},
    });
    expect(sim.metrics.runtimeFragmentPending).toBe(fragments.length - 1);
    expect(sim.metrics.deliveredDatagrams).toBe(1);
    expect(sim.pendingWorkCount()).toBe(0);
  });

  it('exercises finalized fake Security direct/group containers and fails closed on AAD tamper', async () => {
    const sim = new DeterministicBushMeshNetworkSimulator(0x778899aa);
    const a = await sim.addNode({id: 1, name: 'A'});
    const b = await sim.addNode({id: 2, name: 'B'});
    sim.setLink(1, 2, {lossRate: 0});

    const direct = await a.prepareOutbound(wire(510), {
      trafficClass: 'direct-message',
      identityAssociation: {kind: 'direct-session', sessionId: 'direct-session'},
      securityRouting: {sourceNodeId: 1, destinationNodeId: 2},
    });
    expect(Array.from(direct.payload).slice(0, 4)).toEqual([0xb5, 0x53, 0x01, 0x01]);
    await sim.transmit(1, 2, direct);
    await sim.runUntilIdle();
    expect(b.lastInboundResult).toMatchObject({
      status: 'accepted',
      kind: 'protocol',
      protected: true,
      securityMode: 'protected-direct',
    });

    const convoy = encodeBushMeshConvoyWire(
      {
        convoyId: 7,
        nodeId: 1,
        sequence: 1,
        orderIndex: 0,
        role: 0,
        locationUnavailable: true,
      },
      511,
    );
    const group = await a.prepareOutbound(convoy, {
      identityAssociation: {kind: 'group', groupId: 'convoy-alpha'},
      securityRouting: {sourceNodeId: 1, groupId: 'convoy-alpha'},
    });
    await sim.transmit(1, 2, group);
    await sim.runUntilIdle();
    expect(b.lastInboundResult).toMatchObject({
      status: 'accepted',
      kind: 'protocol',
      protected: true,
      securityMode: 'protected-group',
      securityRouting: {sourceNodeId: 1, groupId: 'convoy-alpha'},
    });

    const untampered = await a.prepareOutbound(wire(512), {
      trafficClass: 'direct-message',
      identityAssociation: {kind: 'direct-session', sessionId: 'aad-session'},
      securityRouting: {sourceNodeId: 1, destinationNodeId: 2},
    });
    const decoded = decodeBushMeshSecurityContainer(Array.from(untampered.payload));
    if (
      decoded.kind !== 'protected-direct' ||
      decoded.protectedPayload.kind !== 'direct'
    ) {
      throw new Error('Expected protected direct Security container.');
    }
    const tamperedPayload = encodeBushMeshProtectedDirectContainer({
      routing: {sourceNodeId: 1, destinationNodeId: 3},
      authenticatedHeader: decoded.authenticatedHeader,
      message: decoded.protectedPayload.message,
    });
    await sim.transmit(1, 2, {
      ...untampered,
      payload: Uint8Array.from(tamperedPayload),
    });
    await sim.runUntilIdle();

    expect(b.lastInboundResult).toMatchObject({
      status: 'rejected',
      reason: 'security-failed',
    });
    expect(sim.metrics.runtimeRejected).toBe(1);
  });
});
