import {
  BushMeshPacketType,
  BushMeshPriority,
  encodeBushMeshConvoyWire,
  encodeBushMeshWire,
} from '../../protocol/public';
import type {
  BushMeshSecurityProtectionRequest,
  BushMeshSecurityProtectionResult,
  BushMeshSecurityUnprotectionRequest,
  BushMeshSecurityUnprotectionResult,
} from '../../runtime/public';
import {BushMeshConvoyTracker} from '../../runtime/BushMeshConvoyTracker';
import {acceptAuthenticatedConvoyPosition} from '../../../convoy/membership/authenticatedPositionIngress';
import {
  ConvoyMobilityHarness,
  ConvoyRegressionReport,
} from './ConvoyMobilityHarness';
import {
  DeterministicBushMeshNetworkSimulator,
  SimulatorTraceEvent,
} from './DeterministicNetworkSimulator';
import {SecurityDecisionTestAdapter} from './convoyCampaigns';

/** Wave 5 carrier-level observation; not a device/peer ACK or RF validation. */
export type VirtualDeliveryState =
  | 'unknown-not-yet-processed'
  | 'accepted-by-virtual-runtime'
  | 'rejected-by-virtual-runtime'
  | 'dropped-by-virtual-carrier';

export function classifyVirtualDelivery(
  trace: readonly SimulatorTraceEvent[],
  packetId: number,
): VirtualDeliveryState {
  const events = trace.filter(e => e.packetId === packetId);
  if (events.some(e => e.kind === 'delivered')) return 'accepted-by-virtual-runtime';
  if (events.some(e => e.kind === 'runtime-rejected')) return 'rejected-by-virtual-runtime';
  if (events.some(e => e.kind === 'dropped')) return 'dropped-by-virtual-carrier';
  return 'unknown-not-yet-processed';
}

export type Wave5FieldResult = {
  scenario: string;
  seed: number;
  nodeCount: number;
  failures: string[];
  report: ConvoyRegressionReport | null;
  trace: SimulatorTraceEvent[];
  metrics: DeterministicBushMeshNetworkSimulator['metrics'];
  extra: Record<string, number | string | boolean | null>;
};

function requireCondition(value: boolean, reason: string, failures: string[]): void {
  if (!value) failures.push(reason);
}
function finish(
  name: string,
  fleet: ConvoyMobilityHarness,
  failures: string[],
  extra: Wave5FieldResult['extra'] = {},
): Wave5FieldResult {
  return {
    scenario: name, seed: fleet.network.seed, nodeCount: fleet.ids().length,
    failures, report: fleet.report(),
    trace: fleet.network.trace.map(e => ({...e})),
    metrics: JSON.parse(JSON.stringify(fleet.network.metrics)),
    extra,
  };
}
export function throwWave5Failure(value: Wave5FieldResult): void {
  if (value.failures.length) {
    throw new Error(JSON.stringify({
      scenario: value.scenario, seed: value.seed,
      failures: value.failures, report: value.report,
      extra: value.extra,
      recentTrace: value.trace.slice(-100),
    }, null, 2));
  }
}

/**
 * Repeatable 2–10 virtual vehicle convoy traffic. Radio links and GPS are
 * synthetic, while encoding, protected-container dispatch, dedup and inbound
 * results use the frozen BushMesh Protocol v1 runtime.
 */
export async function wave5FleetFaultMatrix(
  count: number,
  seed: number,
): Promise<Wave5FieldResult> {
  if (![2, 3, 5, 8, 10].includes(count)) {
    throw new Error('Wave 5 matrix supports only 2, 3, 5, 8 or 10 vehicles');
  }
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 135,
    positionStaleAfterMs: 12_000,
    link: {
      lossRate: 0.19, duplicationRate: 0.4, baseDelayMs: 10,
      jitterMs: 18, reorderChance: 0.65, reorderExtraDelayMs: 240,
      bitrateBps: 2_700, dutyCycle: 0.5, retryDelayMs: 160,
      maxPayloadBytes: 255, maxQueueBytes: 2048,
    },
  });
  await fleet.addFleet(count, 9);
  const tail = count;
  let splitObserved = false;
  const failures: string[] = [];
  for (let epoch = 0; epoch < 6; epoch++) {
    if (epoch === 1) {
      fleet.moveGroup([tail], 450);
      fleet.network.partition([fleet.ids().filter(id => id !== tail), [tail]]);
      splitObserved = fleet.network.observePhysicalPath(1, tail) === null;
    }
    if (epoch === 2) {
      fleet.setGpsAvailable(tail, false);
      fleet.network.setCarrierAvailable(1, false);
    }
    if (epoch === 3) {
      fleet.moveGroup([tail], -450);
      fleet.network.healPartition();
      fleet.network.setCarrierAvailable(1, true);
    }
    if (epoch === 4) fleet.setGpsAvailable(tail, true);
    for (const sender of fleet.ids()) {
      const receiver = sender === count ? 1 : sender + 1;
      await fleet.publishPosition(sender, [receiver]);
      await fleet.sendMessage(sender, receiver, {retryAttempts: 3});
    }
    await fleet.network.advanceBy(1800);
  }
  await fleet.network.runUntilIdle();
  const afterDisruptions = fleet.report();
  // Clean final radio leg validates recovery without claiming past losses
  // or that all remote peer positions have magically converged.
  fleet.overrideLink(1, 2, {
    lossRate: 0, duplicationRate: 0, reorderChance: 0, jitterMs: 0,
  });
  await fleet.publishPosition(1, [2]);
  await fleet.network.runUntilIdle();
  const report = fleet.report();
  requireCondition(splitObserved && fleet.network.observePhysicalPath(1, tail) !== null,
    'split/regroup connectivity not observed', failures);
  requireCondition(report.delivery.attempted === count * 12 + 1,
    'unexpected number of canonical transmission attempts', failures);
  requireCondition(report.delivery.failed > 0 || report.delivery.runtimeRejected > 0,
    'seeded disruption failed to exercise failure', failures);
  requireCondition(report.airtime.estimatedMs > 0 &&
    fleet.network.metrics.transportRetries > 0,
    'airtime/transport retries absent', failures);
  requireCondition(report.delivery.duplicatesSuppressed > 0,
    'runtime duplicate suppression not exercised', failures);
  requireCondition(report.queue.currentDepth === 0 &&
    fleet.network.pendingWorkCount() === 0, 'work/queue remained after draining', failures);
  requireCondition(report.positionFreshness.unexpectedStateChanges.length === 0,
    'unexpected authenticated position projection change', failures);
  requireCondition(fleet.positionView(2, 1).freshness === 'fresh',
    'final clean position did not restore fresh lead state', failures);
  requireCondition(fleet.network.metrics.carrierReconnects === 1 &&
    fleet.network.metrics.gpsDisappearances === 1,
    'carrier/GPS outages and recovery not recorded', failures);
  return finish('wave5-mobility-chaos-matrix', fleet, failures, {
    splitObserved, disruptionsAccepted: afterDisruptions.delivery.accepted,
    finalPositionAgeMs: fleet.positionView(2, 1).ageMs,
  });
}

/** Validate missing/last-known/explicit-unavailable are distinct. */
export async function wave5GpsQualityLifecycle(seed = 0x510220): Promise<Wave5FieldResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 220, positionStaleAfterMs: 6_000,
    link: {baseDelayMs: 1, lossRate: 0},
  });
  await fleet.addFleet(3, 20);
  const failures: string[] = [];
  requireCondition(fleet.positionView(2, 1).freshness === 'never-seen',
    'peer unexpectedly had a fix before traffic', failures);
  await fleet.publishPosition(1, [2]);
  await fleet.network.runUntilIdle();
  requireCondition(fleet.positionView(2, 1).freshness === 'fresh',
    'GPS fix not fresh on receiver', failures);
  await fleet.network.advanceBy(8_000);
  requireCondition(fleet.positionView(2, 1).freshness === 'stale',
    'old fix presented as live', failures);
  fleet.setGpsAvailable(1, false);
  await fleet.publishPosition(1, [2]);
  await fleet.network.runUntilIdle();
  requireCondition(fleet.positionView(2, 1).freshness === 'unavailable',
    'missing GPS not explicitly represented as unavailable', failures);
  fleet.setGpsAvailable(1, true);
  fleet.move(1, 35);
  await fleet.publishPosition(1, [2]);
  await fleet.network.runUntilIdle();
  requireCondition(fleet.positionView(2, 1).freshness === 'fresh' &&
    fleet.positionView(2, 1).lastSequence === 3,
    'fresh GPS recovery did not restore latest sequence', failures);
  requireCondition(fleet.report().positionFreshness.unexpectedStateChanges.length === 0,
    'GPS transition changed protected source identity', failures);
  return finish('wave5-gps-absence-staleness-recovery', fleet, failures);
}

/** A queued opaque packet is unknown, not delivered, until the runtime sees it. */
export async function wave5CarrierUnknownAndReconnect(seed = 0x510221): Promise<Wave5FieldResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 200, link: {baseDelayMs: 1, lossRate: 0},
  });
  await fleet.addFleet(3, 20);
  const failures: string[] = [];
  fleet.network.setCarrierAvailable(2, false);
  const before = fleet.network.metrics.attemptedDatagrams;
  const messageId = await fleet.sendMessage(1, 2, {storeIfUnavailable: true});
  const packetId = before + 1; // simulated packet IDs start at one
  requireCondition(classifyVirtualDelivery(fleet.network.trace, packetId) === 'unknown-not-yet-processed',
    'queued carrier leg was prematurely acknowledged', failures);
  requireCondition(fleet.network.pendingWorkCount() > 0,
    'carrier blackout did not preserve opaque deferred leg', failures);
  await fleet.network.advanceBy(700);
  fleet.network.setCarrierAvailable(2, true);
  await fleet.network.runUntilIdle();
  requireCondition(classifyVirtualDelivery(fleet.network.trace, packetId) === 'accepted-by-virtual-runtime',
    'deferred transport leg did not reach canonical runtime after reconnect', failures);
  requireCondition(fleet.network.metrics.storeAndForwardRecoveries === 1,
    'no synthetic carrier deferral recovery reported', failures);
  requireCondition(fleet.network.pendingWorkCount() === 0,
    'reconnect left pending work', failures);
  return finish('wave5-unknown-outcome-carrier-rejoin', fleet, failures,
    {messageId, packetId, expectedBeforeDelivery: 'unknown-not-yet-processed'});
}

/** Synthetic channel-level contention (directed links; NOT shared RF collision). */
export async function wave5CongestionAndAsymmetry(seed = 0x510222): Promise<Wave5FieldResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 250,
    link: {
      bitrateBps: 360, dutyCycle: 0.22,
      maxQueueBytes: 260, baseDelayMs: 2, retryDelayMs: 150,
    },
  });
  await fleet.addFleet(5, 18);
  const failures: string[] = [];
  fleet.overrideLink(2, 1, {lossRate: 1});
  fleet.overrideLink(1, 2, {lossRate: 0});
  await fleet.sendMessage(1, 2);
  const emergencyId = await fleet.sendMessage(1, 2, {priority: BushMeshPriority.Emergency});
  for (let i = 0; i < 36; i++) await fleet.sendMessage(1, 2);
  await fleet.sendMessage(2, 1);
  await fleet.network.runUntilIdle();
  const starts = fleet.network.trace.filter(e => e.kind === 'tx-start' && e.from === 1 && e.to === 2);
  const dropped = fleet.network.trace.filter(e => e.kind === 'dropped');
  const report = fleet.report();
  requireCondition(report.queue.droppedCongestion > 0 &&
    report.airtime.estimatedMs > 0 &&
    report.queue.maxDepth > 0, 'airtime/bounded queue congestion missing', failures);
  requireCondition(starts.length >= 2 && starts[1].messageId === emergencyId,
    'safety traffic starved behind lower-priority queue', failures);
  requireCondition(report.delivery.failed > 0 &&
    dropped.length > 0 && fleet.network.metrics.droppedLoss > 0,
    'asymmetric loss was not reported', failures);
  requireCondition(fleet.network.pendingWorkCount() === 0 &&
    report.queue.currentDepth === 0, 'congested queue not drained', failures);
  return finish('wave5-asymmetric-congested-duty-cycle', fleet, failures, {
    safetyMessageId: emergencyId, queuedPeak: report.queue.maxDepth,
  });
}

/**
 * Test-only fake Security policy augments the existing fake v1 adapter.
 * No signatures/AEAD, real membership or high-water durability are implied.
 */
export class Wave5EpochDecisionAdapter extends SecurityDecisionTestAdapter {
  emittedEpoch = 1;
  acceptedEpochs = new Set([1]);
  readonly boundSource = new Map<string, number>();
  private fakeCounter = 0;
  private readonly seenCounters = new Map<string, number>();

  override async protect(request: BushMeshSecurityProtectionRequest): Promise<BushMeshSecurityProtectionResult> {
    const result = await super.protect(request);
    if (result.protectedPayload.kind !== 'group') return result;
    return {
      ...result,
      protectedPayload: {kind: 'group', message: {
        ...result.protectedPayload.message,
        epoch: this.emittedEpoch,
        counter: String(++this.fakeCounter),
      }},
    };
  }

  override async unprotect(request: BushMeshSecurityUnprotectionRequest): Promise<BushMeshSecurityUnprotectionResult> {
    if (request.protectedPayload.kind === 'group') {
      const message = request.protectedPayload.message;
      if (!this.acceptedEpochs.has(message.epoch)) throw new Error('fake-epoch-stale-or-not-installed');
      const source = this.boundSource.get(message.senderDeviceId);
      if (source !== undefined && source !== request.routing.sourceNodeId) {
        throw new Error('fake-sender-source-binding-mismatch');
      }
      const key = `${message.groupId}:${message.senderDeviceId}:${message.epoch}`;
      const counter = Number(message.counter);
      if (!Number.isSafeInteger(counter) || counter <= (this.seenCounters.get(key) ?? 0)) {
        throw new Error('fake-security-replay-counter-rejected');
      }
      const result = await super.unprotect(request);
      this.seenCounters.set(key, counter);
      return result;
    }
    return super.unprotect(request);
  }
}

/** Explicit negative evidence via real datagram runtime + fake Security seam. */
export async function wave5SecurityIngressNegatives(seed = 0x510223): Promise<Wave5FieldResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    radioRangeMetres: 160, link: {lossRate: 0, duplicationRate: 0, baseDelayMs: 1},
  });
  // Fleet nodes default to fake Security; use a standalone pair to inject
  // the epoch decision test adapter without changing canonical runtime code.
  await fleet.addFleet(3, 20);
  const sim = new DeterministicBushMeshNetworkSimulator(seed);
  const sender = new Wave5EpochDecisionAdapter();
  const receiver = new Wave5EpochDecisionAdapter();
  sender.senderDeviceId = 'fake-vehicle-1';
  receiver.approvedGroupDevices.add('fake-vehicle-1');
  receiver.boundSource.set('fake-vehicle-1', 1);
  const a = await sim.addNode({id: 1}, {securityAdapter: sender});
  const b = await sim.addNode({id: 2}, {securityAdapter: receiver});
  sim.setLink(1, 2, {});
  const tracker = new BushMeshConvoyTracker();
  const policy = {
    securityGroupId: 'wave5-group',
    protocolConvoyId: 9,
    authorisedSourceNodeIds: new Set([1]),
  };
  const failures: string[] = [];
  const statuses: string[] = [];
  let acceptedIngress = 0;
  let rejectedIngress = 0;
  b.onInboundResult(result => {
    if (acceptAuthenticatedConvoyPosition(tracker, result, policy)) acceptedIngress++;
    else rejectedIngress++;
  });
  const make = async (messageId: number, embeddedNodeId: number, sourceId = 1) =>
    a.prepareOutbound(encodeBushMeshConvoyWire({
      convoyId: 9, nodeId: embeddedNodeId, sequence: messageId,
      orderIndex: 0, role: 0, locationUnavailable: true,
    }, messageId), {
      identityAssociation: {kind: 'group', groupId: 'wave5-group'},
      securityRouting: {sourceNodeId: sourceId, groupId: 'wave5-group'},
    });
  const deliver = async (outbound: Awaited<ReturnType<typeof make>>) => {
    await sim.transmit(1, 2, outbound);
    await sim.runUntilIdle();
    statuses.push(b.lastInboundResult?.status ?? 'missing');
  };
  const first = await make(510001, 1);
  await deliver(first); // accepted canonical and exact source
  await deliver(first); // canonical duplicate
  await deliver(await make(510002, 2)); // embedded spoof (app gate rejects)
  await deliver(await make(510003, 1, 9)); // authenticated logical source mismatched to claimed sender
  sender.emittedEpoch = 2;
  await deliver(await make(510004, 1)); // receiver does not know epoch 2
  receiver.acceptedEpochs.add(2);
  await deliver(await make(510005, 1)); // epoch 2 installed in fake verifier
  sender.senderDeviceId = 'fake-rotated-identity';
  await deliver(await make(510006, 1)); // unapproved identity
  receiver.approvedGroupDevices.add('fake-rotated-identity');
  receiver.boundSource.set('fake-rotated-identity', 1);
  await deliver(await make(510007, 1)); // trusted rotation (synthetic only)
  receiver.approvedGroupDevices.delete('fake-rotated-identity');
  await deliver(await make(510008, 1)); // revoked
  const expected = ['accepted', 'duplicate', 'accepted', 'rejected',
    'rejected', 'accepted', 'rejected', 'accepted', 'rejected'];
  requireCondition(JSON.stringify(statuses) === JSON.stringify(expected),
    `unexpected canonical security statuses: ${statuses.join(',')}`, failures);
  requireCondition(acceptedIngress === 3 &&
    rejectedIngress >= 5, 'authenticated position gate accepted invalid ingress', failures);
  requireCondition(tracker.snapshot(9, sim.clock.now()).members.length === 1,
    'spoofed source injected unverified roster/map member', failures);
  requireCondition(sim.metrics.runtimeRejected >= 4 &&
    sim.metrics.runtimeDuplicates >= 1,
    'runtime replay/epoch/revocation negative decisions missing', failures);
  // Preserve the real security test's metrics rather than report the unused
  // mobility fleet as proof of these fake security decisions.
  const extra: Wave5FieldResult['extra'] = {
    acceptedIngress, rejectedIngress, runtimeRejected: sim.metrics.runtimeRejected,
    runtimeDuplicates: sim.metrics.runtimeDuplicates,
    securityAssurance: 'fake-adapter-only',
  };
  const baseline = finish('wave5-fake-security-ingress-negatives', fleet, failures, extra);
  return {...baseline, trace: sim.trace.map(e => ({...e})),
    metrics: JSON.parse(JSON.stringify(sim.metrics)),
    report: {...fleet.report(), delivery: {
      ...fleet.report().delivery, attempted: sim.metrics.attemptedDatagrams,
      accepted: sim.metrics.deliveredDatagrams,
      failed: sim.metrics.failedDatagrams,
      runtimeRejected: sim.metrics.runtimeRejected,
      duplicatesSuppressed: sim.metrics.runtimeDuplicates,
    }}};
}

/** Plain/channel-only carrier traffic cannot become verified convoy positions. */
export async function wave5ChannelOnlyIsolation(seed = 0x510224): Promise<Wave5FieldResult> {
  const fleet = new ConvoyMobilityHarness(seed, {
    link: {lossRate: 0, baseDelayMs: 1},
  });
  await fleet.addFleet(2, 15);
  const failures: string[] = [];
  const tracker = new BushMeshConvoyTracker();
  const policy = {securityGroupId: fleet.groupId,
    protocolConvoyId: fleet.convoyId, authorisedSourceNodeIds: new Set([1])};
  let gatedRejected = 0;
  fleet.node(2).onInboundResult(result => {
    if (!acceptAuthenticatedConvoyPosition(tracker, result, policy)) gatedRejected++;
  });
  const plain = await fleet.node(1).prepareOutbound(encodeBushMeshConvoyWire({
    convoyId: fleet.convoyId, nodeId: 1, sequence: 42,
    orderIndex: 0, role: 0, locationUnavailable: true,
  }, 510250), {identityAssociation: {kind: 'none'}, label: 'channel-only-unverified'});
  await fleet.network.transmit(1, 2, plain);
  await fleet.network.runUntilIdle();
  requireCondition(gatedRejected > 0 &&
    tracker.snapshot(fleet.convoyId, fleet.network.clock.now()).members.length === 0 &&
    fleet.positionView(2, 1).freshness === 'never-seen',
    'unverified channel traffic was promoted to authenticated convoy position', failures);
  requireCondition(fleet.network.pendingWorkCount() === 0,
    'channel-only traffic left pending work', failures);
  return finish('wave5-channel-only-position-isolation', fleet, failures,
    {gatedRejected, authenticatedRosterSize: 0});
}
