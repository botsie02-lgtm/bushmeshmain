import {
  BushMeshPacketType,
  BushMeshPriority,
  encodeBushMeshConvoyWire,
  encodeBushMeshWire,
} from '../../protocol/public';
import type {BushMeshOutboundDatagram} from '../../runtime/public';
import {ConvoyMobilityHarness, ConvoyRegressionReport} from './ConvoyMobilityHarness';
import {SecurityDecisionTestAdapter} from './convoyCampaigns';
import {DeterministicBushMeshNetworkSimulator} from './DeterministicNetworkSimulator';

/**
 * Synthetic medium campaigns: physical collisions and captures are not
 * calibrated measurements and are never part of canonical routing/MAC logic.
 */
export type SharedChannelCampaignResult = {
  name: string;
  seed: number;
  nodeCount: number;
  failures: string[];
  report: ConvoyRegressionReport;
  network: DeterministicBushMeshNetworkSimulator;
  observations?: string[];
};

function check(condition: boolean, message: string, failures: string[]): void {
  if (!condition) failures.push(message);
}

function finish(
  name: string,
  fleet: ConvoyMobilityHarness,
  failures: string[],
  observations?: string[],
): SharedChannelCampaignResult {
  return {
    name, seed: fleet.network.seed, nodeCount: fleet.ids().length,
    failures, report: fleet.report(), network: fleet.network, observations,
  };
}

export function throwSharedChannelFailure(campaign: SharedChannelCampaignResult): void {
  if (campaign.failures.length) {
    throw new Error(JSON.stringify({
      scenario: campaign.name,
      seed: campaign.seed,
      nodeCount: campaign.nodeCount,
      failures: campaign.failures,
      observations: campaign.observations,
      report: campaign.report,
      diagnostic: campaign.network.failureReport(campaign.failures.join('; ')),
    }, null, 2));
  }
}

/** Many independent transmitters contend for a single audible destination. */
export async function scenarioSimultaneousTransmitters(
  seed = 0xbea70011,
): Promise<SharedChannelCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 320,
    link: {
      bitrateBps: 3_000, dutyCycle: 0.75,
      maxQueueBytes: 2_048, baseDelayMs: 1,
    },
  });
  await fleet.addFleet(12, 12);
  fleet.network.configureSharedChannel({enabled: true});
  for (let round = 0; round < 8; round += 1) {
    for (let sender = 1; sender <= 11; sender += 1) {
      await fleet.sendMessage(sender, 12);
    }
  }
  await fleet.network.runUntilIdle();
  const m = fleet.network.metrics;
  const failures: string[] = [];
  check(m.attemptedDatagrams === 88, 'incorrect contention burst', failures);
  check(m.channelOverlaps > 0 && m.droppedCollision > 0,
    'no synthetic overlapping losses were detected', failures);
  check(m.droppedCollision === m.failedDatagrams,
    'lossless RF model should fail only through collisions', failures);
  check(Object.keys(m.transmissionsBySender).length === 11 &&
    Object.values(m.transmissionsBySender).every(n => n >= 6),
    'one of eleven senders did not receive transmission turns', failures);
  check(m.maxQueueDepth > 0 && m.maxQueueWaitMs > 0,
    'burst failed to exercise queue delays', failures);
  check(fleet.network.pendingWorkCount() === 0, 'contention work was not drained', failures);
  return finish('simultaneous-eleven-transmitters', fleet, failures);
}

/** One stronger overlapping signal survives; a second channel is isolated. */
export async function scenarioCaptureAndChannelIsolation(
  seed = 0xbea70012,
): Promise<SharedChannelCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 180,
    link: {lossRate: 0, baseDelayMs: 1, bitrateBps: 2_000},
  });
  await fleet.addFleet(4, 15);
  fleet.network.configureSharedChannel({enabled: true, captureMarginDb: 12});
  fleet.overrideLink(1, 4, {rssiDbm: -45});
  fleet.overrideLink(2, 4, {rssiDbm: -105});
  await fleet.sendMessage(1, 4);
  await fleet.sendMessage(2, 4);
  await fleet.network.runUntilIdle();
  const phaseOne = {...fleet.network.metrics};
  const firstDeliveries = fleet.network.trace.filter(e => e.kind === 'delivered');
  const firstAcceptedFrom = firstDeliveries.map(e => e.from);

  // The synthetic RF domain isolates unlike channelIndex values.
  const make = async (sender: number, messageId: number, channelIndex: number): Promise<BushMeshOutboundDatagram> =>
    fleet.node(sender).prepareOutbound(encodeBushMeshWire({
      type: BushMeshPacketType.Message,
      priority: BushMeshPriority.DirectMessage,
      messageId, ackRequested: false, payload: [1, 2, 3],
    }), {channelIndex});
  await fleet.network.transmit(1, 4, await make(1, 780001, 0));
  await fleet.network.transmit(2, 4, await make(2, 780002, 1));
  await fleet.network.runUntilIdle();
  const report = fleet.report();
  const failures: string[] = [];
  check(phaseOne.deliveredDatagrams === 1 && phaseOne.droppedCollision === 1 &&
    JSON.stringify(firstAcceptedFrom) === '[1]',
    'synthetic stronger-signal capture did not preserve only stronger frame', failures);
  check(report.delivery.accepted === 3 && report.delivery.droppedCollision === 1,
    'cross-channel transmissions interfered unexpectedly', failures);
  check(fleet.network.pendingWorkCount() === 0, 'capture test left pending traffic', failures);
  return finish('capture-margin-and-channel-isolation', fleet, failures);
}

/** One radio serializes its many destinations; safety traffic is not starved. */
export async function scenarioHalfDuplexFairness(
  seed = 0xbea70013,
): Promise<SharedChannelCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 300,
    link: {bitrateBps: 2_000, dutyCycle: 0.2, maxQueueBytes: 4_096},
  });
  await fleet.addFleet(8, 15);
  fleet.network.configureSharedChannel({enabled: true});
  await fleet.sendMessage(1, 2); // first carrier transmission already in flight
  for (let round = 0; round < 4; round += 1) {
    for (let receiver = 2; receiver <= 7; receiver += 1) {
      await fleet.sendMessage(1, receiver);
    }
  }
  const emergencyMessageId = await fleet.sendMessage(1, 8, {
    priority: BushMeshPriority.Emergency,
  });
  await fleet.network.runUntilIdle();
  const starts = fleet.network.trace.filter(e => e.kind === 'tx-start' && e.from === 1);
  const report = fleet.report();
  const failures: string[] = [];
  check(starts[0]?.to === 2 && starts[1]?.messageId === emergencyMessageId,
    'cross-link safety priority was starved behind normal backlog', failures);
  check(report.delivery.accepted === 26 && report.delivery.failed === 0,
    'one sender failed to drain all 26 noncolliding messages', failures);
  check(report.airtime.senderContentions > 0 && report.queue.maxQueueWaitMs > 0 &&
    report.airtime.dutyCycleHoldMs > report.airtime.estimatedMs,
    'duty-cycle hold or shared-sender contention was not enforced', failures);
  check(Object.keys(report.airtime.transmissionsBySender).length === 1 &&
    report.airtime.transmissionsBySender['1'] === 26,
    'source airtime accounting did not serialize transmission', failures);
  check(report.queue.currentDepth === 0 && fleet.network.pendingWorkCount() === 0,
    'fairness queue was not fully drained', failures);
  return finish('eight-node-half-duplex-queue-fairness', fleet, failures);
}

/**
 * A discovered physical hop path is not a canonical router. The test confirms
 * there is no implicit forwarding and exercises only explicit carrier deferral.
 */
export async function scenarioLeaderSplitAndIntermittentRelay(
  seed = 0xbea70014,
): Promise<SharedChannelCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 31,
    positionStaleAfterMs: 20_000,
    link: {baseDelayMs: 3, bitrateBps: 10_000},
  });
  await fleet.addFleet(8, 20);
  fleet.network.configureSharedChannel({enabled: true});
  const initialPath = fleet.network.observePhysicalPath(1, 8);
  // No canonical route/relay port: a physical multihop path does NOT
  // automatically deliver an opaque end-to-end datagram.
  await fleet.sendMessage(1, 8);
  await fleet.network.runUntilIdle();
  const noForwardedMessage = fleet.network.metrics.deliveredDatagrams === 0;

  fleet.move(1, -450);
  fleet.setPresent(4, false);
  const splitPath = fleet.network.observePhysicalPath(1, 8);
  const relayPath = fleet.network.observePhysicalPath(2, 8);
  await fleet.sendMessage(1, 2, {storeIfUnavailable: true});
  await fleet.sendMessage(3, 4, {storeIfUnavailable: true});
  await fleet.network.advanceBy(27_000);
  fleet.setPresent(4, true);
  const recoveredRelayPath = fleet.network.observePhysicalPath(2, 8);
  fleet.move(1, 0);
  const joinedPath = fleet.network.observePhysicalPath(1, 8);
  await fleet.network.runUntilIdle();
  await fleet.publishPosition(1, [2]);
  await fleet.network.runUntilIdle();
  const report = fleet.report();
  const failures: string[] = [];
  check(initialPath !== null && initialPath.length > 2 &&
    splitPath === null && relayPath === null &&
    recoveredRelayPath !== null && joinedPath !== null,
    'leader / relay topology did not split and reconnect', failures);
  check(noForwardedMessage, 'simulator incorrectly claimed canonical multi-hop forwarding', failures);
  check(report.delivery.storeAndForwardRecoveries === 2,
    'two opaque deferred carrier legs were not recovered', failures);
  check(report.recovery.nodeReturns >= 1 &&
    report.positionFreshness.views.some(v =>
      v.receiverId === 2 && v.sourceId === 1 && v.freshness === 'fresh'),
    'leader/relay did not return to fresh recipient state', failures);
  check(fleet.network.pendingWorkCount() === 0, 'relay recovery left pending work', failures);
  return finish('leader-split-relay-outage-and-rejoin', fleet, failures);
}

/** Late delivery of an older authenticated update must not roll back position. */
export async function scenarioDelayedPositionAntiRollback(
  seed = 0xbea70015,
): Promise<SharedChannelCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 100, positionStaleAfterMs: 20_000,
    link: {baseDelayMs: 1, bitrateBps: 10_000},
  });
  await fleet.addFleet(2, 20);
  fleet.overrideLink(1, 2, {baseDelayMs: 95_000});
  await fleet.publishPosition(1, [2]); // sequence 1, delayed after airtime
  await fleet.network.advanceBy(10_000);
  const notYetSeen = fleet.positionView(2, 1);
  fleet.move(1, 40);
  fleet.overrideLink(1, 2, {baseDelayMs: 1});
  await fleet.publishPosition(1, [2]); // sequence 2 arrives first
  await fleet.network.advanceBy(1_000);
  const latest = fleet.positionView(2, 1);
  await fleet.network.runUntilIdle(); // sequence 1 now arrives extremely late
  const finalView = fleet.positionView(2, 1);
  const report = fleet.report();
  const failures: string[] = [];
  check(notYetSeen.freshness === 'never-seen' &&
    latest.lastSequence === 2 && latest.freshness === 'fresh',
    'newer position did not precede delayed older position', failures);
  check(finalView.lastSequence === 2 && report.positionFreshness.olderSequenceIgnored === 1,
    'late accepted position overwrote newer test observation', failures);
  check(finalView.freshness === 'stale',
    'newer position should eventually age out during extreme old-packet delay', failures);
  check(report.positionFreshness.unexpectedStateChanges.length === 0,
    'delayed position created unexpected identity change', failures);
  return finish('very-late-sequence-anti-rollback', fleet, failures);
}

/**
 * Security decisions are injected at the frozen adapter seam, not implemented
 * as key exchange, membership enrolment, cryptography or a new security stack.
 */
export async function scenarioSecurityEpochUnderActiveTraffic(
  seed = 0xbea70016,
): Promise<SharedChannelCampaignResult> {
  const alice = new SecurityDecisionTestAdapter();
  const bob = new SecurityDecisionTestAdapter();
  const outsider = new SecurityDecisionTestAdapter();
  const receiver = new SecurityDecisionTestAdapter();
  alice.senderDeviceId = 'approved-alice';
  bob.senderDeviceId = 'approved-bob';
  outsider.senderDeviceId = 'unapproved-outsider';
  receiver.approvedGroupDevices.add(alice.senderDeviceId);
  receiver.approvedGroupDevices.add(bob.senderDeviceId);
  receiver.boundSourceBySenderDevice.set(alice.senderDeviceId, 1);
  receiver.boundSourceBySenderDevice.set(bob.senderDeviceId, 2);
  receiver.enforceReplayCounters = true;

  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 180,
    link: {baseDelayMs: 2, bitrateBps: 20_000},
    securityAdapters: {1: alice, 2: bob, 3: outsider, 4: receiver},
  });
  await fleet.addFleet(4, 15);
  const statuses: string[] = [];
  const send = async (id: number) => {
    await fleet.publishPosition(id, [4]);
    await fleet.network.runUntilIdle();
    statuses.push(fleet.node(4).lastInboundResult?.status ?? 'missing');
  };
  await send(1); // Alice epoch 1 accepted
  await send(2); // Bob epoch 1 accepted
  await send(3); // Unknown group sender rejected
  alice.senderEpoch = 2;
  await send(1); // Alice key upgrade not yet authorized at receiver
  await send(2); // Still-authorized Bob epoch 1 accepted
  receiver.acceptedGroupEpochs.add(2);
  await send(1); // Alice epoch 2 now permitted

  const bobBeforeForge = fleet.positionView(4, 2).lastSequence;
  // Accepted Security container with a *different embedded vehicle ID*.
  // The frozen runtime decodes it, and the application-facing audit rejects
  // using authenticated source/node binding. No app state is overwritten.
  const forged = await fleet.node(1).prepareOutbound(encodeBushMeshConvoyWire({
    convoyId: fleet.convoyId, nodeId: 2, sequence: 80,
    orderIndex: 0, role: 0, locationUnavailable: true,
  }, 890_001), {
    identityAssociation: {kind: 'group', groupId: fleet.groupId},
    securityRouting: {sourceNodeId: 1, groupId: fleet.groupId},
  });
  await fleet.network.transmit(1, 4, forged);
  await fleet.network.runUntilIdle();
  statuses.push(fleet.node(4).lastInboundResult?.status ?? 'missing');
  const bobAfterForge = fleet.positionView(4, 2).lastSequence;

  alice.forceNextFakeGroupCounter(1);
  await send(1); // Reused fake epoch 2 counter rejected by injected provider
  fleet.network.setCarrierAvailable(4, false);
  await fleet.publishPosition(2, [4], true); // delayed in-flight epoch 1
  receiver.acceptedGroupEpochs.delete(1);
  fleet.network.setCarrierAvailable(4, true);
  await fleet.network.runUntilIdle();
  statuses.push(fleet.node(4).lastInboundResult?.status ?? 'missing');
  bob.senderEpoch = 2;
  await send(2); // Updated authorized member becomes live again
  receiver.approvedGroupDevices.delete('approved-alice');
  await send(1); // Revoked member remains rejected mid-position stream
  outsider.senderDeviceId = 'approved-bob'; // fake forged sender credential
  outsider.senderEpoch = 2; // ensure binding, not retired epoch, rejects
  await send(3); // Receiver's external source/device binding denies forgery
  await send(2); // Still-approved member unaffected by Alice's revocation

  const report = fleet.report();
  const failures: string[] = [];
  const expected = [
    'accepted', 'accepted', 'rejected', 'rejected', 'accepted', 'accepted',
    'accepted', 'rejected', 'rejected', 'accepted', 'rejected', 'rejected', 'accepted',
  ];
  check(JSON.stringify(statuses) === JSON.stringify(expected),
    `unexpected Security decisions: ${statuses.join(',')}`, failures);
  check(report.delivery.unauthorisedUpdatesRejected === 6,
    'six unauthorized/stale provider decisions were not rejected', failures);
  check(report.positionFreshness.unexpectedStateChanges.length === 1 &&
    bobBeforeForge === bobAfterForge && fleet.positionView(4, 2).lastSequence === 5,
    'embedded identity forgery was not isolated from authorized position ledger', failures);
  check(fleet.positionView(4, 3).freshness === 'never-seen',
    'unauthorized position unexpectedly entered recipient view', failures);
  check(fleet.node(4).lastInboundResult?.status === 'accepted',
    'remaining authorized member lost service after revocation', failures);
  check(report.recovery.carrierReconnects === 1,
    'delayed epoch transition did not reconnect the test carrier', failures);
  return finish('active-member-revocation-stale-epoch-and-replay', fleet, failures, statuses);
}

/** Seeded extended twenty-vehicle moving contention/partition soak. */
export async function scenarioExtendedSharedChannelSoak(
  seed: number,
): Promise<SharedChannelCampaignResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 155,
    positionStaleAfterMs: 18_000,
    link: {
      baseDelayMs: 15, jitterMs: 20, reorderChance: 0.3,
      reorderExtraDelayMs: 300, lossRate: 0.04,
      duplicationRate: 0.12, bitrateBps: 6_000,
      dutyCycle: 0.65, maxQueueBytes: 1_280,
    },
  });
  await fleet.addFleet(20, 6);
  fleet.network.configureSharedChannel({enabled: true, captureMarginDb: 9});
  const rear = fleet.ids().slice(10);
  const initialPath = fleet.network.observePhysicalPath(1, 20);
  let splitPath: number[] | null = null;

  for (let epoch = 0; epoch < 10; epoch += 1) {
    if (epoch === 2) {
      fleet.moveGroup(rear, 400);
      fleet.network.partition([fleet.ids().slice(0, 10), rear]);
      splitPath = fleet.network.observePhysicalPath(1, 20);
    }
    if (epoch === 4) {
      fleet.setPresent(7, false);
      fleet.setGpsAvailable(6, false);
      fleet.network.setCarrierAvailable(9, false);
    }
    if (epoch === 6) {
      fleet.moveGroup(rear, -400);
      fleet.network.healPartition();
      fleet.setPresent(7, true);
      fleet.network.setCarrierAvailable(9, true);
    }
    if (epoch === 7) fleet.setGpsAvailable(6, true);
    for (let id = 1; id <= 20; id += 1) {
      const receiver = id === 20 ? 1 : id + 1;
      await fleet.publishPosition(id, [receiver], true);
      await fleet.sendMessage(id, receiver, {retryAttempts: 2});
    }
    await fleet.network.advanceBy(1_200);
  }
  const joinedPath = fleet.network.observePhysicalPath(1, 20);
  await fleet.network.runUntilIdle();
  fleet.overrideLink(1, 2, {lossRate: 0, duplicationRate: 0});
  await fleet.publishPosition(1, [2]);
  await fleet.network.runUntilIdle();
  const report = fleet.report();
  const failures: string[] = [];
  check(initialPath !== null && splitPath === null && joinedPath !== null,
    'extended soak topology did not split/recover', failures);
  check(report.delivery.attempted === 401 && report.airtime.transmissionAttempts > 300,
    'extended soak generated an incorrect amount of traffic', failures);
  check(report.airtime.channelOverlaps > 0 && report.delivery.droppedCollision > 0 &&
    report.airtime.senderContentions > 0,
    'soak did not exercise shared-channel airtime contention', failures);
  check(report.delivery.accepted > 0 && report.delivery.failed > 0,
    'soak failed to exercise both good and failed deliveries', failures);
  check(report.recovery.carrierReconnects === 1 && report.recovery.nodeReturns === 1 &&
    report.recovery.partitionHeals === 1 && report.recovery.storeAndForwardRecoveries > 0,
    'carrier/node/partition/opaque-backlog recovery not observed', failures);
  check(report.positionFreshness.unexpectedStateChanges.length === 0 &&
    fleet.positionView(2, 1).freshness === 'fresh',
    'post-soak lead position audit failed', failures);
  check(report.queue.maxDepth < 500 &&
    report.queue.currentDepth === 0 && fleet.network.pendingWorkCount() === 0,
    'extended soak unbounded or stranded queues', failures);
  return finish('twenty-vehicle-shared-channel-extended-soak', fleet, failures);
}
