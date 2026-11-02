import {
  BushMeshPacketType,
  BushMeshPriority,
  encodeBushMeshWire,
} from '../../protocol/public';
import {
  DeterministicBushMeshNetworkSimulator,
  SimulatorFailureReport,
} from './DeterministicNetworkSimulator';

export type NetworkSimulatorScenarioResult = {
  name: string;
  seed: number;
  simulator: DeterministicBushMeshNetworkSimulator;
  failures: string[];
  failureReport: SimulatorFailureReport | null;
};

function messageWire(
  messageId: number,
  priority: BushMeshPriority = BushMeshPriority.DirectMessage,
  options: {
    ackRequested?: boolean;
    storeAndForward?: boolean;
    payloadBytes?: number;
  } = {},
): number[] {
  const payloadBytes = options.payloadBytes ?? 8;
  return encodeBushMeshWire({
    type: BushMeshPacketType.Message,
    priority,
    messageId,
    ackRequested: options.ackRequested ?? true,
    storeAndForward: options.storeAndForward ?? false,
    payload: Array.from(
      {length: payloadBytes},
      (_, index) => (messageId + index) & 0xff,
    ),
  });
}

function finish(
  name: string,
  simulator: DeterministicBushMeshNetworkSimulator,
  failures: string[],
): NetworkSimulatorScenarioResult {
  return {
    name,
    seed: simulator.seed,
    simulator,
    failures,
    failureReport:
      failures.length > 0
        ? simulator.failureReport(`${name}: ${failures.join('; ')}`)
        : null,
  };
}

export async function scenarioThreeNodeConvoyRejoin(
  seed = 0xabc001,
): Promise<NetworkSimulatorScenarioResult> {
  const sim = new DeterministicBushMeshNetworkSimulator(seed);
  const a = await sim.addNode({id: 1, name: 'A'});
  await sim.addNode({id: 2, name: 'B', peerStaleAfterMs: 60_000});
  const c = await sim.addNode({id: 3, name: 'C'});
  sim.setBidirectionalLink(1, 2, {baseDelayMs: 40});
  sim.setBidirectionalLink(2, 3, {baseDelayMs: 40});

  const before = await a.prepareOutbound(messageWire(1), {
    label: 'convoy-before-loss',
  });
  await sim.transmit(1, 2, before, {convergenceKey: 'convoy'});
  await sim.runUntilIdle();

  sim.setNodePresent(2, false);
  const duringA = await a.prepareOutbound(messageWire(2), {
    label: 'convoy-during-loss-a',
  });
  const duringC = await c.prepareOutbound(messageWire(3), {
    label: 'convoy-during-loss-c',
  });
  await sim.transmit(1, 2, duringA, {
    storeIfUnavailable: true,
    convergenceKey: 'convoy',
  });
  await sim.transmit(3, 2, duringC, {
    storeIfUnavailable: true,
    convergenceKey: 'convoy',
  });
  await sim.advanceBy(90_000);
  sim.setNodePresent(2, true);
  await sim.runUntilIdle();

  const failures: string[] = [];
  if (sim.metrics.deliveredDatagrams !== 3) {
    failures.push(
      `expected 3 convoy deliveries, got ${sim.metrics.deliveredDatagrams}`,
    );
  }
  if (sim.metrics.storeAndForwardRecoveries !== 2) {
    failures.push(
      `expected 2 recovered datagrams, got ${sim.metrics.storeAndForwardRecoveries}`,
    );
  }
  if ((sim.metrics.convergenceDeliveries.convoy ?? 0) !== 3) {
    failures.push('convoy delivery convergence counter did not reach 3');
  }
  return finish(
    'three-node convoy B disappears for 90 seconds and rejoins',
    sim,
    failures,
  );
}

export async function scenarioThirtyFivePercentLoss(
  seed = 0xabc002,
): Promise<NetworkSimulatorScenarioResult> {
  const sim = new DeterministicBushMeshNetworkSimulator(seed);
  const a = await sim.addNode({id: 1, name: 'A'});
  await sim.addNode({id: 2, name: 'B'});
  sim.setLink(1, 2, {
    lossRate: 0.35,
    baseDelayMs: 10,
    bitrateBps: 20_000,
  });

  const count = 200;
  for (let index = 0; index < count; index += 1) {
    const datagram = await a.prepareOutbound(messageWire(1000 + index), {
      label: `loss-${index}`,
    });
    await sim.transmit(1, 2, datagram);
  }
  await sim.runUntilIdle();

  const ratio = sim.metrics.deliveredDatagrams / count;
  const failures: string[] = [];
  if (ratio < 0.5 || ratio > 0.8) {
    failures.push(
      `delivery ratio ${ratio.toFixed(3)} outside deterministic sanity band`,
    );
  }
  if (sim.metrics.droppedLoss === 0) {
    failures.push('35% loss injected no packet loss');
  }
  if (
    sim.metrics.deliveredDatagrams + sim.metrics.failedDatagrams !==
    count
  ) {
    failures.push('loss accounting does not equal attempted datagrams');
  }
  return finish('35% random packet loss', sim, failures);
}

export async function scenarioPartitionAndHealing(
  seed = 0xabc003,
): Promise<NetworkSimulatorScenarioResult> {
  const sim = new DeterministicBushMeshNetworkSimulator(seed);
  const a = await sim.addNode({id: 1, name: 'A'});
  await sim.addNode({id: 2, name: 'B'});
  await sim.addNode({id: 3, name: 'C'});
  sim.setBidirectionalLink(1, 2, {});
  sim.setBidirectionalLink(2, 3, {});
  sim.observePhysicalPath(1, 3);
  sim.partition([[1], [2, 3]]);
  sim.observePhysicalPath(1, 3);

  const datagram = await a.prepareOutbound(messageWire(2001), {
    label: 'partitioned',
  });
  await sim.transmit(1, 2, datagram, {storeIfUnavailable: true});
  await sim.advanceBy(30_000);
  sim.healPartition();
  sim.observePhysicalPath(1, 3);
  await sim.runUntilIdle();

  const failures: string[] = [];
  if (
    sim.metrics.deliveredDatagrams !== 1 ||
    sim.metrics.storeAndForwardRecoveries !== 1
  ) {
    failures.push('partitioned work did not recover after healing');
  }
  if (sim.metrics.routeChanges < 2) {
    failures.push(
      `expected physical topology path changes, got ${sim.metrics.routeChanges}`,
    );
  }
  return finish('network partition followed by healing', sim, failures);
}

export async function scenarioGpsLossWhileConnected(
  seed = 0xabc004,
): Promise<NetworkSimulatorScenarioResult> {
  const sim = new DeterministicBushMeshNetworkSimulator(seed);
  const a = await sim.addNode({id: 1, name: 'A'});
  await sim.addNode({id: 2, name: 'B', gpsStaleAfterMs: 20_000});
  sim.setLink(1, 2, {});
  sim.setGpsFix(2);
  sim.clearGps(2);

  const datagram = await a.prepareOutbound(messageWire(3001), {
    label: 'gps-independent-traffic',
  });
  await sim.transmit(1, 2, datagram);
  await sim.advanceBy(25_000);
  await sim.runUntilIdle();

  const failures: string[] = [];
  if (sim.metrics.deliveredDatagrams !== 1) {
    failures.push('radio traffic stopped when destination GPS disappeared');
  }
  if (
    sim.metrics.gpsDisappearances !== 1 ||
    sim.metrics.staleLocationExpiries !== 1
  ) {
    failures.push('GPS disappearance/staleness was not observed deterministically');
  }
  return finish('node loses GPS while remaining connected', sim, failures);
}

export async function scenarioPathQualityChanges(
  seed = 0xabc005,
): Promise<NetworkSimulatorScenarioResult> {
  const sim = new DeterministicBushMeshNetworkSimulator(seed);
  const a = await sim.addNode({id: 1, name: 'A'});
  const c = await sim.addNode({id: 3, name: 'C'});
  await sim.addNode({id: 2, name: 'B'});
  sim.setLink(1, 2, {rssiDbm: -72, snrDb: 11});
  sim.setLink(1, 3, {rssiDbm: -85, snrDb: 6});
  sim.setLink(3, 2, {rssiDbm: -83, snrDb: 7});
  sim.observePhysicalPath(1, 2);

  const first = await a.prepareOutbound(messageWire(4001), {
    label: 'quality-good',
  });
  await sim.transmit(1, 2, first);
  await sim.runUntilIdle();

  sim.setLink(1, 2, {rssiDbm: -118, snrDb: -9});
  const second = await a.prepareOutbound(messageWire(4002), {
    label: 'quality-poor',
  });
  await sim.transmit(1, 2, second);
  await sim.runUntilIdle();

  sim.setLink(1, 2, {enabled: false});
  const alternate = sim.observePhysicalPath(1, 2);
  const viaC = await a.prepareOutbound(messageWire(4003), {
    label: 'alternate-hop-a-c',
  });
  const fromC = await c.prepareOutbound(messageWire(4004), {
    label: 'alternate-hop-c-b',
  });
  await sim.transmit(1, 3, viaC);
  await sim.transmit(3, 2, fromC);
  await sim.runUntilIdle();

  const failures: string[] = [];
  if (sim.metrics.linkQualityChanges < 1) {
    failures.push('link quality change was not recorded');
  }
  if (!alternate || alternate.join('>') !== '1>3>2') {
    failures.push(
      `expected alternate physical path 1>3>2, got ${alternate?.join('>') ?? 'none'}`,
    );
  }
  if (sim.metrics.routeChanges < 1) {
    failures.push('physical path change was not counted');
  }
  return finish('route/path quality changes while traffic is active', sim, failures);
}

export async function scenarioCongestionThenSos(
  seed = 0xabc006,
): Promise<NetworkSimulatorScenarioResult> {
  const sim = new DeterministicBushMeshNetworkSimulator(seed);
  const a = await sim.addNode({id: 1, name: 'A'});
  await sim.addNode({id: 2, name: 'B'});
  sim.setLink(1, 2, {
    bitrateBps: 180,
    baseDelayMs: 5,
    maxQueueBytes: 64 * 1024,
  });

  for (let index = 0; index < 25; index += 1) {
    const ordinary = await a.prepareOutbound(
      messageWire(5000 + index, BushMeshPriority.Background, {
        ackRequested: false,
        payloadBytes: 24,
      }),
      {label: `bulk-${index}`},
    );
    await sim.transmit(1, 2, ordinary);
  }

  const sos = await a.prepareOutbound(
    messageWire(5099, BushMeshPriority.Emergency, {payloadBytes: 8}),
    {label: 'SOS'},
  );
  await sim.transmit(1, 2, sos);
  await sim.runUntilIdle();

  const emergency = sim.metrics.emergencyLatencySamplesMs[0];
  const average = sim.averageLatencyMs();
  const failures: string[] = [];
  if (emergency === undefined || average === null || emergency >= average) {
    failures.push(
      `SOS latency ${emergency ?? 'missing'} was not below mean queued latency ${average ?? 'missing'}`,
    );
  }
  if (sim.metrics.maxQueueDepth < 10) {
    failures.push('congestion scenario did not build a meaningful queue');
  }
  return finish(
    'congestion with ordinary traffic followed by an SOS',
    sim,
    failures,
  );
}

export async function scenarioDuplicateDelayedStorm(
  seed = 0xabc007,
): Promise<NetworkSimulatorScenarioResult> {
  const sim = new DeterministicBushMeshNetworkSimulator(seed);
  const a = await sim.addNode({id: 1, name: 'A'});
  await sim.addNode({id: 2, name: 'B'});
  sim.setLink(1, 2, {
    duplicationRate: 1,
    baseDelayMs: 40,
    jitterMs: 35,
    reorderChance: 1,
    reorderExtraDelayMs: 2_000,
    bitrateBps: 20_000,
  });

  const count = 30;
  for (let index = 0; index < count; index += 1) {
    const protectedMessage = await a.prepareOutbound(messageWire(6000 + index), {
      label: `protected-storm-${index}`,
      trafficClass: 'direct-message',
      securityRouting: {
        sourceNodeId: 1,
        destinationNodeId: 2,
      },
      identityAssociation: {
        kind: 'direct-session',
        sessionId: 'sim-session-a-b',
        peerDeviceId: 'B',
      },
    });
    await sim.transmit(1, 2, protectedMessage);
  }
  await sim.runUntilIdle();

  const failures: string[] = [];
  if (sim.metrics.deliveredDatagrams !== count) {
    failures.push(
      `expected ${count} accepted originals, got ${sim.metrics.deliveredDatagrams}`,
    );
  }
  if (sim.metrics.runtimeDuplicates !== count) {
    failures.push(
      `expected ${count} duplicate suppressions, got ${sim.metrics.runtimeDuplicates}`,
    );
  }
  if (sim.metrics.runtimeRejected !== 0) {
    failures.push('fake Security adapter caused protected traffic rejection');
  }
  return finish('duplicate and delayed packet storm', sim, failures);
}

export async function scenarioStoreAndForwardRecovery(
  seed = 0xabc008,
): Promise<NetworkSimulatorScenarioResult> {
  const sim = new DeterministicBushMeshNetworkSimulator(seed);
  const a = await sim.addNode({id: 1, name: 'A'});
  await sim.addNode({id: 2, name: 'B'});
  sim.setLink(1, 2, {});
  sim.setNodePresent(2, false);

  const datagram = await a.prepareOutbound(
    messageWire(7001, BushMeshPriority.DirectMessage, {
      storeAndForward: true,
    }),
    {label: 'store-forward'},
  );
  await sim.transmit(1, 2, datagram, {storeIfUnavailable: true});
  await sim.advanceBy(120_000);
  sim.setNodePresent(2, true);
  await sim.runUntilIdle();

  const failures: string[] = [];
  if (
    sim.metrics.deliveredDatagrams !== 1 ||
    sim.metrics.storeAndForwardRecoveries !== 1
  ) {
    failures.push(
      'temporarily unreachable destination did not recover deferred transport work',
    );
  }
  return finish(
    'store-and-forward through a temporarily unreachable destination',
    sim,
    failures,
  );
}

export async function scenarioRestartWithPersistedRuntimeState(
  seed = 0xabc009,
): Promise<NetworkSimulatorScenarioResult> {
  const sim = new DeterministicBushMeshNetworkSimulator(seed);
  const a = await sim.addNode({id: 1, name: 'A'});
  await sim.addNode({id: 2, name: 'B'});
  sim.setLink(1, 2, {});

  const datagram = await a.prepareOutbound(messageWire(8001), {
    label: 'persisted-dedup',
  });
  await sim.transmit(1, 2, datagram);
  await sim.runUntilIdle();
  await sim.node(2).flush();
  const restored = await sim.restartNode(2);
  await sim.transmit(1, 2, datagram);
  await sim.runUntilIdle();

  const failures: string[] = [];
  if (restored < 1) {
    failures.push('runtime restart restored no dedup entries');
  }
  if (
    sim.metrics.deliveredDatagrams !== 1 ||
    sim.metrics.runtimeDuplicates !== 1
  ) {
    failures.push(
      'persisted runtime state did not suppress replay after restart',
    );
  }
  return finish('node restart with persisted runtime state', sim, failures);
}

export async function scenarioSeededSoak(
  seed = 0xabc00a,
): Promise<NetworkSimulatorScenarioResult> {
  const sim = new DeterministicBushMeshNetworkSimulator(seed);
  const nodes = [];
  for (let id = 1; id <= 5; id += 1) {
    nodes.push(await sim.addNode({id, name: `N${id}`}));
  }

  for (let from = 1; from <= 5; from += 1) {
    for (let to = 1; to <= 5; to += 1) {
      if (from !== to) {
        sim.setLink(from, to, {
          lossRate: 0.12,
          duplicationRate: 0.08,
          jitterMs: 25,
          reorderChance: 0.2,
          reorderExtraDelayMs: 120,
          bitrateBps: 7_500,
          maxQueueBytes: 8 * 1024,
        });
      }
    }
  }

  const count = 600;
  for (let index = 0; index < count; index += 1) {
    if (index === 150) {
      sim.partition([[1, 2], [3, 4, 5]]);
    } else if (index === 200) {
      sim.healPartition();
    } else if (index === 300) {
      sim.setCarrierAvailable(4, false);
    } else if (index === 330) {
      sim.setCarrierAvailable(4, true);
    }

    if (index % 75 === 0) {
      const rssi = -75 - Math.floor(sim.random.next() * 35);
      sim.setLink(1, 2, {
        rssiDbm: rssi,
        snrDb: 9 - sim.random.next() * 12,
      });
    }

    const from = 1 + Math.floor(sim.random.next() * 5);
    let to = 1 + Math.floor(sim.random.next() * 5);
    if (to === from) {
      to = (to % 5) + 1;
    }
    const priority =
      index % 40 === 0
        ? BushMeshPriority.Emergency
        : BushMeshPriority.DirectMessage;
    const datagram = await nodes[from - 1].prepareOutbound(
      messageWire(9000 + index, priority, {ackRequested: false}),
      {
        label: `soak-${index}`,
        retryIntent: {mode: 'transport-retry', maxTransportAttempts: 2},
      },
    );
    await sim.transmit(from, to, datagram);

    if (index % 20 === 19) {
      await sim.advanceBy(250);
    }
  }

  sim.healPartition();
  sim.setCarrierAvailable(4, true);
  await sim.runUntilIdle();

  const failures = sim.assertBounded(650);
  if (sim.pendingWorkCount() !== 0) {
    failures.push(`soak ended with ${sim.pendingWorkCount()} pending work items`);
  }
  if (sim.metrics.deliveredDatagrams < 200) {
    failures.push(
      `soak delivered too little traffic: ${sim.metrics.deliveredDatagrams}`,
    );
  }
  if (
    sim.metrics.deliveredDatagrams + sim.metrics.failedDatagrams >
    sim.metrics.attemptedDatagrams
  ) {
    failures.push('delivery accounting amplified logical datagrams');
  }
  return finish('long-running seeded soak', sim, failures);
}

export const INITIAL_NETWORK_SIMULATOR_SCENARIOS = [
  scenarioThreeNodeConvoyRejoin,
  scenarioThirtyFivePercentLoss,
  scenarioPartitionAndHealing,
  scenarioGpsLossWhileConnected,
  scenarioPathQualityChanges,
  scenarioCongestionThenSos,
  scenarioDuplicateDelayedStorm,
  scenarioStoreAndForwardRecovery,
  scenarioRestartWithPersistedRuntimeState,
  scenarioSeededSoak,
] as const;

export function throwScenarioFailure(
  result: NetworkSimulatorScenarioResult,
): void {
  if (result.failures.length === 0) {
    return;
  }
  throw new Error(
    `Deterministic BushMesh simulator scenario failed:\n${JSON.stringify(
      result.failureReport,
      null,
      2,
    )}`,
  );
}
