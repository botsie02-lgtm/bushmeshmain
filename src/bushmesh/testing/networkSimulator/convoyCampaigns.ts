import {
  BushMeshPacketType,
  BushMeshPriority,
  encodeBushMeshConvoyWire,
  encodeBushMeshWire,
} from '../../protocol/public';
import type {
  BushMeshSecurityAdapter,
  BushMeshSecurityProtectionRequest,
  BushMeshSecurityProtectionResult,
  BushMeshSecurityUnprotectionRequest,
  BushMeshSecurityUnprotectionResult,
} from '../../runtime/public';
import {
  DeterministicBushMeshNetworkSimulator,
  FakeBushMeshSecurityAdapter,
} from './DeterministicNetworkSimulator';
import {
  ConvoyMobilityHarness,
  ConvoyRegressionReport,
} from './ConvoyMobilityHarness';

export type ConvoyCampaignResult = {
  name: string;
  seed: number;
  failures: string[];
  report: ConvoyRegressionReport | null;
  network: DeterministicBushMeshNetworkSimulator;
  /** A deterministic trace is attached to the network, not copied into reports. */
};

function result(
  name: string,
  fleet: ConvoyMobilityHarness,
  failures: string[],
): ConvoyCampaignResult {
  return {
    name,
    seed: fleet.network.seed,
    failures,
    report: fleet.report(),
    network: fleet.network,
  };
}

function assert(condition: boolean, message: string, failures: string[]): void {
  if (!condition) failures.push(message);
}

export function throwConvoyCampaignFailure(campaign: ConvoyCampaignResult): void {
  if (campaign.failures.length) {
    throw new Error(JSON.stringify({
      name: campaign.name,
      seed: campaign.seed,
      failures: campaign.failures,
      report: campaign.report,
      network: campaign.network.failureReport(campaign.failures.join('; ')),
    }, null, 2));
  }
}

/** Complete directed 2/5/12/20-node fleet: each sender reaches every peer. */
export async function scenarioFleetScale(
  size: number,
  seed = 0xac1000 + size,
): Promise<ConvoyCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 500,
    positionStaleAfterMs: 30_000,
    link: {lossRate: 0, duplicationRate: 0, bitrateBps: 100_000, baseDelayMs: 1},
  });
  await fleet.addFleet(size, 12);
  for (const from of fleet.ids()) await fleet.publishPosition(from);
  await fleet.network.runUntilIdle();
  const report = fleet.report();
  const expected = size * (size - 1);
  const failures: string[] = [];
  assert(report.delivery.attempted === expected, 'wrong fleet attempt count', failures);
  assert(report.delivery.accepted === expected, 'fleet failed to deliver every position', failures);
  assert(report.positionFreshness.fresh === expected, 'not every directed peer position is fresh', failures);
  assert(report.delivery.duplicatesSuppressed === 0, 'unexpected fleet dedup', failures);
  assert(report.positionFreshness.unexpectedStateChanges.length === 0, 'accepted convoy identity/source changed unexpectedly', failures);
  assert(fleet.network.pendingWorkCount() === 0, 'fleet has pending radio work', failures);
  return result(`fleet-${size}`, fleet, failures);
}

/** Mobility changes radio reachability only: protocol forwarding remains canonical. */
export async function scenarioVehicleSeparationAndRegroup(
  seed = 0xac2001,
): Promise<ConvoyCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {radioRangeMetres: 160});
  await fleet.addFleet(8, 20);
  const initialPath = fleet.network.observePhysicalPath(1, 8);
  fleet.moveGroup([5, 6, 7, 8], 800);
  const separatedPath = fleet.network.observePhysicalPath(1, 8);
  await fleet.publishPosition(1, [5], true);
  await fleet.network.advanceBy(45_000);
  const whileAway = fleet.report();
  fleet.moveGroup([5, 6, 7, 8], -800);
  const reunitedPath = fleet.network.observePhysicalPath(1, 8);
  await fleet.network.runUntilIdle();
  await fleet.publishPosition(1, [8]);
  await fleet.network.runUntilIdle();
  const report = fleet.report();
  const failures: string[] = [];
  assert(initialPath !== null && separatedPath === null && reunitedPath !== null,
    'physical topology did not split and rejoin', failures);
  assert(whileAway.delivery.accepted === 0, 'position delivered across disconnected split', failures);
  assert(report.delivery.storeAndForwardRecoveries === 1, 'one deferred carrier packet was not recovered', failures);
  assert(report.delivery.accepted === 2, 'two expected post-rejoin deliveries missing', failures);
  assert(fleet.positionView(8, 1).freshness === 'fresh', 'regrouped vehicle has stale lead position', failures);
  assert(report.positionFreshness.unexpectedStateChanges.length === 0, 'identity/state audit violations', failures);
  assert(fleet.network.pendingWorkCount() === 0, 'pending work after regroup', failures);
  return result('separate-regroup-eight', fleet, failures);
}

export async function scenarioGpsExpiryAndRecovery(
  seed = 0xac2002,
): Promise<ConvoyCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 180,
    positionStaleAfterMs: 12_000,
  });
  await fleet.addFleet(3, 15);
  await fleet.publishPosition(1, [2]);
  await fleet.network.runUntilIdle();
  const before = fleet.positionView(2, 1);
  fleet.setGpsAvailable(1, false);
  fleet.move(1, 25, 0);
  await fleet.network.advanceBy(15_000);
  const stale = fleet.positionView(2, 1);
  await fleet.sendMessage(1, 3);
  await fleet.publishPosition(1, [2]);
  await fleet.network.runUntilIdle();
  const unavailable = fleet.positionView(2, 1);
  fleet.setGpsAvailable(1, true);
  fleet.move(1, 45, 0);
  await fleet.publishPosition(1, [2]);
  await fleet.network.runUntilIdle();
  const recovered = fleet.positionView(2, 1);
  const report = fleet.report();
  const failures: string[] = [];
  assert(before.freshness === 'fresh', 'initial GPS sample was not fresh', failures);
  assert(stale.freshness === 'stale', 'stale source GPS was not observed as stale', failures);
  assert(unavailable.freshness === 'unavailable' && !unavailable.lastPosition,
    'GPS loss did not invalidate the received location', failures);
  assert(recovered.freshness === 'fresh', 'fresh GPS position did not return', failures);
  assert((recovered.lastSequence ?? 0) > (unavailable.lastSequence ?? 0),
    'fresh fix did not increase the sequence', failures);
  assert(report.delivery.accepted === 4, 'GPS loss incorrectly interrupted non-position radio delivery', failures);
  assert(report.positionFreshness.unexpectedStateChanges.length === 0, 'position audit violated', failures);
  return result('gps-stale-loss-recovery', fleet, failures);
}

/** Real runtime dedup + carrier-level retries, not fabricated protocol ACK logic. */
export async function scenarioAsymmetricRetryChaos(
  seed = 0xac2003,
): Promise<ConvoyCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {radioRangeMetres: 160});
  await fleet.addFleet(2, 20);
  fleet.overrideLink(1, 2, {
    lossRate: 0.4, duplicationRate: 0.75, baseDelayMs: 12,
    jitterMs: 8, reorderChance: 0.85, reorderExtraDelayMs: 60,
    bitrateBps: 12_000,
  });
  fleet.overrideLink(2, 1, {lossRate: 1, baseDelayMs: 40});
  for (let index = 0; index < 75; index += 1) {
    await fleet.sendMessage(1, 2, {retryAttempts: 3});
  }
  for (let index = 0; index < 8; index += 1) await fleet.sendMessage(2, 1);
  await fleet.network.runUntilIdle();
  const report = fleet.report();
  const failures: string[] = [];
  assert(report.delivery.attempted === 83, 'incorrect asymmetric attempt count', failures);
  assert(report.delivery.transportRetries > 0, 'loss produced no transport retry', failures);
  assert(report.delivery.duplicatesSuppressed > 0, 'injected copies never exercised dedup', failures);
  assert(report.delivery.accepted > 35 && report.delivery.accepted <= 75,
    'unexpected delivery under asymmetric loss', failures);
  assert(report.delivery.failed >= 8, 'reverse direction should remain unavailable', failures);
  assert(fleet.network.metrics.duplicateCopiesInjected > 0, 'no duplicate copies injected', failures);
  assert(fleet.network.pendingWorkCount() === 0, 'retry scheduler has pending events', failures);
  return result('asymmetric-retry-duplicate-reorder', fleet, failures);
}

/** Per-directed-link airtime, duty-cycle, congestion and queued priority. */
export async function scenarioCongestedTwelveNodeConvoy(
  seed = 0xac2004,
): Promise<ConvoyCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {radioRangeMetres: 280});
  await fleet.addFleet(12, 8);
  fleet.overrideLink(1, 2, {
    lossRate: 0, duplicationRate: 0, bitrateBps: 400,
    dutyCycle: 0.2, maxQueueBytes: 190, maxPayloadBytes: 255,
  });
  for (let index = 0; index < 6; index += 1) await fleet.sendMessage(1, 2);
  const emergency = await fleet.sendMessage(1, 2, {priority: BushMeshPriority.Emergency});
  for (let index = 0; index < 30; index += 1) await fleet.sendMessage(1, 2);
  await fleet.network.runUntilIdle();
  const delivered = fleet.network.trace.filter(
    event => event.kind === 'delivered' && event.from === 1 && event.to === 2,
  );
  const emergencyIndex = delivered.findIndex(event => event.messageId === emergency);
  const report = fleet.report();
  const failures: string[] = [];
  assert(report.nodeCount === 12, 'wrong convoy size', failures);
  assert(report.queue.droppedCongestion > 0, 'bounded queue did not reject excess traffic', failures);
  assert(emergencyIndex === 1, 'safety-priority queued packet did not overtake normal backlog', failures);
  assert(report.queue.maxDepth > 2 && report.queue.currentDepth === 0,
    'queue depth accounting is wrong', failures);
  assert(report.airtime.estimatedMs > 0 && report.airtime.transmissionAttempts > 0,
    'airtime not accounted', failures);
  assert(fleet.network.pendingWorkCount() === 0, 'congestion left pending virtual work', failures);
  return result('twelve-node-airtime-congestion', fleet, failures);
}

export async function scenarioPartitionWithReconnection(
  seed = 0xac2005,
): Promise<ConvoyCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {radioRangeMetres: 220});
  await fleet.addFleet(5, 12);
  fleet.network.partition([[1, 2], [3, 4, 5]]);
  await fleet.sendMessage(1, 3, {storeIfUnavailable: true});
  await fleet.network.advanceBy(18_000);
  const during = fleet.report();
  fleet.network.healPartition();
  await fleet.network.runUntilIdle();
  const report = fleet.report();
  const failures: string[] = [];
  assert(during.delivery.accepted === 0, 'packet crossed the partition', failures);
  assert(report.delivery.accepted === 1 && report.delivery.storeAndForwardRecoveries === 1,
    'reconnection did not drain the held packet', failures);
  assert(fleet.network.pendingWorkCount() === 0, 'reconnection left a deferred packet', failures);
  return result('five-node-partition-heal', fleet, failures);
}

/**
 * This stub models decisions made by the external Security v1 provider through
 * the frozen Security adapter API. It implements no cryptography, key rotation,
 * trust manager, membership authority or replacement Security v1 subsystem.
 */
export class SecurityDecisionTestAdapter implements BushMeshSecurityAdapter {
  private readonly fake = new FakeBushMeshSecurityAdapter();
  readonly activeSessions = new Set<string>();
  readonly approvedGroupDevices = new Set<string>();
  senderDeviceId = 'sim-node-1';

  async protect(request: BushMeshSecurityProtectionRequest): Promise<BushMeshSecurityProtectionResult> {
    const protectedResult = await this.fake.protect(request);
    if (protectedResult.protectedPayload.kind === 'group') {
      return {
        ...protectedResult,
        protectedPayload: {
          kind: 'group',
          message: {
            ...protectedResult.protectedPayload.message,
            senderDeviceId: this.senderDeviceId,
          },
        },
      };
    }
    return protectedResult;
  }

  async unprotect(request: BushMeshSecurityUnprotectionRequest): Promise<BushMeshSecurityUnprotectionResult> {
    if (request.protectedPayload.kind === 'direct') {
      if (!this.activeSessions.has(request.protectedPayload.message.sessionId)) {
        throw new Error('Test Security provider denies retired direct session.');
      }
    } else {
      if (!this.approvedGroupDevices.has(request.protectedPayload.message.senderDeviceId)) {
        throw new Error('Test Security provider denies revoked group membership.');
      }
    }
    return this.fake.unprotect(request);
  }
}

/** Interface-only identity transition and membership-revocation fail-closed test. */
export async function scenarioSecurityIdentityAndRevocation(
  seed = 0xac2006,
): Promise<{
  name: string;
  seed: number;
  failures: string[];
  network: DeterministicBushMeshNetworkSimulator;
  statuses: string[];
}> {
  const sim = new DeterministicBushMeshNetworkSimulator(seed);
  const alicePolicy = new SecurityDecisionTestAdapter();
  const receiverPolicy = new SecurityDecisionTestAdapter();
  receiverPolicy.activeSessions.add('session-before-rotation');
  receiverPolicy.approvedGroupDevices.add('vehicle-alice-key-v1');
  receiverPolicy.approvedGroupDevices.add('vehicle-bob-key-v1');
  alicePolicy.senderDeviceId = 'vehicle-alice-key-v1';
  const alice = await sim.addNode({id: 1}, {securityAdapter: alicePolicy});
  const bobPolicy = new SecurityDecisionTestAdapter();
  bobPolicy.senderDeviceId = 'vehicle-bob-key-v1';
  const bob = await sim.addNode({id: 2}, {securityAdapter: bobPolicy});
  const receiver = await sim.addNode({id: 3}, {securityAdapter: receiverPolicy});
  sim.setLink(1, 3, {});
  sim.setLink(2, 3, {});
  let nextMessageId = 500_000;
  const statuses: string[] = [];
  const sendProtected = async (
    node: typeof alice,
    sourceId: number,
    association: {kind: 'direct-session'; sessionId: string} | {kind: 'group'; groupId: string},
  ) => {
    const id = nextMessageId++;
    const wire = encodeBushMeshWire({
      type: BushMeshPacketType.Message,
      priority: BushMeshPriority.DirectMessage,
      messageId: id,
      payload: [sourceId & 0xff, id & 0xff],
    });
    return node.prepareOutbound(wire, {
      trafficClass: association.kind === 'group' ? 'convoy-group' : 'direct-message',
      identityAssociation: association,
      securityRouting: association.kind === 'group'
        ? {sourceNodeId: sourceId, groupId: association.groupId}
        : {sourceNodeId: sourceId, destinationNodeId: 3},
    });
  };
  const deliver = async (sourceId: number, outbound: Awaited<ReturnType<typeof alice.prepareOutbound>>) => {
    await sim.transmit(sourceId, 3, outbound);
    await sim.runUntilIdle();
    statuses.push(receiver.lastInboundResult?.status ?? 'missing');
  };

  await deliver(1, await sendProtected(alice, 1, {
    kind: 'direct-session', sessionId: 'session-before-rotation',
  }));
  const oldSessionMessage = await sendProtected(alice, 1, {
    kind: 'direct-session', sessionId: 'session-before-rotation',
  });
  receiverPolicy.activeSessions.delete('session-before-rotation');
  receiverPolicy.activeSessions.add('session-after-rotation');
  await deliver(1, oldSessionMessage);
  await deliver(1, await sendProtected(alice, 1, {
    kind: 'direct-session', sessionId: 'session-after-rotation',
  }));
  // Use real canonical convoy encoding for group membership checks.
  const groupPosition = async (node: typeof alice, sourceId: number) => {
    const id = nextMessageId++;
    return node.prepareOutbound(
      encodeBushMeshConvoyWire({
        convoyId: 9, nodeId: sourceId, sequence: id, orderIndex: sourceId - 1,
        role: sourceId === 1 ? 0 : 1, locationUnavailable: true,
      }, id),
      {
        identityAssociation: {kind: 'group', groupId: 'test-membership'},
        securityRouting: {sourceNodeId: sourceId, groupId: 'test-membership'},
      },
    );
  };
  await deliver(1, await groupPosition(alice, 1));
  const retiredGroupMessage = await groupPosition(alice, 1);
  // Identity rotation: externally authorized new identity, old identity revoked.
  alicePolicy.senderDeviceId = 'vehicle-alice-key-v2';
  receiverPolicy.approvedGroupDevices.delete('vehicle-alice-key-v1');
  await deliver(1, retiredGroupMessage);
  const deniedBeforeTrust = await groupPosition(alice, 1);
  await deliver(1, deniedBeforeTrust);
  receiverPolicy.approvedGroupDevices.add('vehicle-alice-key-v2');
  await deliver(1, await groupPosition(alice, 1));
  // Removal from the group revokes even the newly accepted identity.
  receiverPolicy.approvedGroupDevices.delete('vehicle-alice-key-v2');
  await deliver(1, await groupPosition(alice, 1));
  // Removing Alice from the group does not revoke Bob's distinct identity.
  await deliver(2, await groupPosition(bob, 2));

  const failures: string[] = [];
  const expected = [
    'accepted', 'rejected', 'accepted',
    'accepted', 'rejected', 'rejected', 'accepted', 'rejected', 'accepted',
  ];
  assert(JSON.stringify(statuses) === JSON.stringify(expected),
    `Security lifecycle status sequence incorrect: ${statuses.join(',')}`, failures);
  assert(sim.metrics.runtimeRejected === 4, 'expected four externally denied Security objects', failures);
  assert(sim.metrics.deliveredDatagrams === 5, 'unrevoked group member should still deliver', failures);
  return {name: 'security-provider-identity-revocation', seed, failures, network: sim, statuses};
}

export async function scenarioTwentyNodeMobileChaos(
  seed = 0xac20aa,
): Promise<ConvoyCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 210,
    positionStaleAfterMs: 16_000,
    link: {
      lossRate: 0.13, duplicationRate: 0.2, jitterMs: 18,
      baseDelayMs: 12, reorderChance: 0.5, reorderExtraDelayMs: 85,
      bitrateBps: 4_500, dutyCycle: 0.5, maxQueueBytes: 2_048,
    },
  });
  await fleet.addFleet(20, 7);
  const firstPath = fleet.network.observePhysicalPath(1, 20);
  const distant = Array.from({length: 10}, (_, i) => i + 11);
  let splitPath: number[] | null = null;
  for (let epoch = 0; epoch < 9; epoch += 1) {
    if (epoch === 2) {
      fleet.moveGroup(distant, 700);
      fleet.network.partition([fleet.ids().slice(0, 10), distant]);
      splitPath = fleet.network.observePhysicalPath(1, 20);
    }
    if (epoch === 3) {
      fleet.setPresent(7, false);
      fleet.setGpsAvailable(4, false);
      fleet.network.setCarrierAvailable(18, false);
    }
    if (epoch === 5) {
      fleet.moveGroup(distant, -700);
      fleet.network.healPartition();
      fleet.setPresent(7, true);
      fleet.network.setCarrierAvailable(18, true);
    }
    if (epoch === 6) fleet.setGpsAvailable(4, true);
    for (const id of [1, 4, 7, 12, 20]) {
      if (id === 7 && epoch === 3) continue;
      await fleet.publishPosition(id, fleet.ids().filter(other => other !== id));
    }
    for (let id = 1; id <= 19; id += 1) {
      await fleet.sendMessage(id, id + 1, {
        retryAttempts: 2,
        storeIfUnavailable: false,
      });
    }
    await fleet.network.advanceBy(4_000);
  }
  const finalPath = fleet.network.observePhysicalPath(1, 20);
  await fleet.network.runUntilIdle();
  fleet.overrideLink(1, 2, {lossRate: 0, duplicationRate: 0});
  await fleet.publishPosition(1, [2]);
  await fleet.network.runUntilIdle();
  const report = fleet.report();
  const failures: string[] = [];
  assert(firstPath !== null && splitPath === null && finalPath !== null,
    'mobility/partition did not change physical connectivity', failures);
  assert(report.delivery.attempted > 750 && report.delivery.accepted > 90,
    'insufficient twenty-node chaos traffic/delivery', failures);
  assert(report.delivery.failed > 0 && report.delivery.duplicatesSuppressed > 0,
    'loss/duplication chaos did not exercise drop/dedup paths', failures);
  assert(report.delivery.transportRetries > 0 && report.airtime.estimatedMs > 0,
    'transport retries/airtime were not exercised', failures);
  assert(report.queue.maxDepth < 1_500, 'queue exceeded bounded fleet capacity', failures);
  assert(report.positionFreshness.unexpectedStateChanges.length === 0,
    'accepted position source/state unexpectedly changed', failures);
  assert(fleet.positionView(2, 1).freshness === 'fresh',
    'lead position not fresh after final regroup', failures);
  assert(fleet.network.metrics.gpsDisappearances > 0 &&
      fleet.network.metrics.carrierReconnects > 0,
    'GPS/carrier recovery was not observed', failures);
  assert(fleet.network.pendingWorkCount() === 0, 'twenty-node chaos left pending radio events', failures);
  return result('twenty-node-mobile-seeded-chaos', fleet, failures);
}
