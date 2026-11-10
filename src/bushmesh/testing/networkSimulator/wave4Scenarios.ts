import {BushMeshPriority, encodeBushMeshConvoyWire} from '../../protocol/public';
import {
  FakeWave4SecurityDecisionProbe,
  Wave4Approval,
  Wave4EnrolmentHarness,
  Wave4SecurityDecisionProbe,
  Wave4SecurityReport,
} from './Wave4EnrolmentHarness';

export type Wave4ScenarioResult = {
  scenario: string;
  seed: number;
  nodeCount: number;
  assurance: Wave4SecurityDecisionProbe['assurance'];
  passed: boolean;
  failures: string[];
  security: Wave4SecurityReport;
  trace: ReturnType<Wave4EnrolmentHarness['report']>['events'];
  failureReport: string | null;
};

function final(name: string, harness: Wave4EnrolmentHarness, failures: string[]): Wave4ScenarioResult {
  const report = harness.report();
  return {
    scenario: name, seed: report.seed, nodeCount: report.nodeCount,
    assurance: report.assurance, passed: failures.length === 0,
    failures, security: report, trace: report.events,
    failureReport: failures.length ? harness.failureReport(failures.join('; ')) : null,
  };
}
function check(value: boolean, reason: string, failures: string[]): void {
  if (!value) failures.push(reason);
}
function approval(
  id: number,
  requestId: string,
  transactionId: string,
  expectedEpoch: number,
  approverNodeId = 1,
  fingerprint = `fake-pin-${id}-1`,
): Wave4Approval {
  return {
    requestId, transactionId, approverNodeId, expectedEpoch,
    requesterFingerprint: fingerprint, claim: 'simulated-positive-approval',
  };
}

/** Consent and group membership are only fake policy decisions, not v2. */
async function settle(h: Wave4EnrolmentHarness, tx: string): Promise<boolean> {
  const receipts = h.report().transactions.find(t => t.transactionId === tx);
  if (!receipts || receipts.status !== 'committed') return false;
  for (const id of receipts.pendingRecipients) {
    if (id !== 1 && !await h.distribute(tx, id)) return false;
    if (!await h.acknowledge(tx, id)) return false;
  }
  return h.ackConverged();
}

export async function wave4SimultaneousJoins(seed = 0x440101): Promise<Wave4ScenarioResult> {
  const h = await new Wave4EnrolmentHarness(seed, 8).initialize();
  const failures: string[] = [];
  check(h.request(3, 'rq-3') && h.request(4, 'rq-4'),
    'simultaneous requests not observed', failures);
  const a3 = approval(3, 'rq-3', 'tx-3', 1);
  const a4 = approval(4, 'rq-4', 'tx-4', 1, 2);
  check(await h.approve(a3) && await h.approve(a4), 'two fake approvals not prepared', failures);
  check(h.commit('tx-3'), 'first CAS did not commit', failures);
  check(!h.commit('tx-4') && h.epoch === 2 && !h.memberIds.includes(4),
    'conflicting concurrent commit incorrectly added a second member', failures);
  check(await settle(h, 'tx-3'), 'new epoch 2 did not converge', failures);
  h.request(4, 'rq-4-new');
  const a4Retry = approval(4, 'rq-4-new', 'tx-4-new', 2, 2);
  check(await h.approve(a4Retry) && h.commit('tx-4-new'),
    'reconciled join request failed on current epoch', failures);
  check(await settle(h, 'tx-4-new'), 'second epoch did not converge', failures);
  const report = h.report();
  check(report.currentEpoch === 3 && report.activeMemberIds.join(',') === '1,2,3,4' &&
    report.metrics.committedTransactions === 2 &&
    report.metrics.convergenceLagSamplesMs.length === 2,
    'CAS or two-epoch idempotence invariant failed', failures);
  return final('wave4-concurrent-join-cas', h, failures);
}

export async function wave4AuthorityDisappearance(seed = 0x440102): Promise<Wave4ScenarioResult> {
  const h = await new Wave4EnrolmentHarness(seed, 7).initialize();
  const failures: string[] = [];
  h.request(3, 'rq-admin-away');
  const a = approval(3, 'rq-admin-away', 'tx-admin-away', 1, 2);
  h.fleet.setPresent(1, false);
  check(!await h.approve(a), 'approval passed with missing leader authority', failures);
  h.fleet.setPresent(1, true);
  check(await h.approve(a), 'admin approval did not recover', failures);
  h.fleet.setPresent(2, false);
  check(!h.commit('tx-admin-away') && h.epoch === 1,
    'prepared approval committed after admin disappeared', failures);
  h.fleet.setPresent(2, true);
  check(h.commit('tx-admin-away') && await settle(h, 'tx-admin-away'),
    'authority recovery did not finish pending shadow transaction', failures);
  check(h.report().metrics.rejectedInvalidTransitions >= 2 &&
    h.report().transport.recovery.nodeReturns >= 2,
    'missing authority failure/recovery metrics', failures);
  return final('wave4-authority-offline-mid-join', h, failures);
}

export async function wave4ApprovalReplayConflict(seed = 0x440103): Promise<Wave4ScenarioResult> {
  const h = await new Wave4EnrolmentHarness(seed, 6).initialize();
  const failures: string[] = [];
  h.request(3, 'rq-replay');
  const a = approval(3, 'rq-replay', 'tx-replay', 1);
  check(!await h.approve({...a, claim: 'unsigned-fake'}), 'invalid fake-policy claim accepted', failures);
  check(await h.approve(a) && await h.approve(a),
    'idempotent same prepared approval rejected', failures);
  check(!await h.approve({...a, transactionId: 'tx-conflict'}) &&
    !await h.approve({...a, approverNodeId: 2}),
    'conflicting approvals failed to reject', failures);
  check(h.commit('tx-replay') && !await h.approve(a),
    'committed approval replay was re-authorised', failures);
  check(!await h.approve({...a, transactionId: 'tx-new'}),
    'request replay with a different transaction ID succeeded', failures);
  check(await settle(h, 'tx-replay'), 'legitimate transaction did not converge', failures);
  const report = h.report();
  check(report.metrics.preparedTransactions === 1 &&
    report.metrics.committedTransactions === 1 &&
    report.metrics.replayedApprovals >= 2 &&
    report.metrics.conflictingApprovals >= 2,
    'approval conflict/replay counters did not match the single commit', failures);
  return final('wave4-approval-replay-and-conflict', h, failures);
}

export async function wave4PartialCommitRestart(seed = 0x440104): Promise<Wave4ScenarioResult> {
  const h = await new Wave4EnrolmentHarness(seed, 5).initialize();
  const failures: string[] = [];
  h.request(3, 'rq-partial');
  check(await h.approve(approval(3, 'rq-partial', 'tx-partial', 1)),
    'preparation failed before fault injection', failures);
  const before = h.report();
  check(!h.commit('tx-partial', true), 'injected commit failure not detected', failures);
  const afterFailure = h.report();
  check(before.currentEpoch === afterFailure.currentEpoch &&
    before.activeMemberIds.join() === afterFailure.activeMemberIds.join() &&
    afterFailure.metrics.committedTransactions === 0,
    'partial shadow commit published state', failures);
  h.restartAuthority(true);
  check(!h.commit('tx-partial') && !h.reconcileRestart(false),
    'restart with missing/rollback state unexpectedly succeeded', failures);
  check(h.reconcileRestart(true) && h.commit('tx-partial'),
    'verified fake recovery could not safely resume', failures);
  check(await settle(h, 'tx-partial'), 'recovery failed to converge after retry', failures);
  check(h.report().metrics.partialCommitsPrevented === 1 &&
    h.report().metrics.rollbackBlocked >= 2,
    'partial write and failed restart metrics missing', failures);
  return final('wave4-partial-commit-and-restart-fail-closed', h, failures);
}

export async function wave4DelayedKeyAndLostAcks(seed = 0x440105): Promise<Wave4ScenarioResult> {
  const h = await new Wave4EnrolmentHarness(seed, 6).initialize();
  const failures: string[] = [];
  h.request(3, 'rq-late');
  await h.approve(approval(3, 'rq-late', 'tx-late', 1));
  h.commit('tx-late');
  check(await h.distribute('tx-late', 2) && await h.distribute('tx-late', 3),
    'mock key distribution did not reach both members', failures);
  check(await h.acknowledge('tx-late', 1) && await h.acknowledge('tx-late', 2),
    'owner/existing member acknowledgement failed', failures);
  h.fleet.overrideLink(3, 1, {lossRate: 1});
  check(!await h.acknowledge('tx-late', 3),
    'lost installation acknowledgement was treated as verified', failures);
  const pending = h.report();
  check(pending.epochDisagreement === 0 && !pending.ackConverged &&
    pending.transactions[0].pendingRecipients.includes(3),
    'local install incorrectly implied global ack convergence', failures);
  await h.fleet.network.advanceBy(16_000);
  h.fleet.overrideLink(3, 1, {lossRate: 0});
  check(await h.acknowledge('tx-late', 3) &&
    !await h.acknowledge('tx-late', 3),
    'ack retry/idempotent-verification behavior failed', failures);
  const report = h.report();
  check(report.ackConverged && report.metrics.lostInstallAcks === 1 &&
    report.metrics.rejectedInstallAcks === 1 &&
    report.metrics.convergenceLagSamplesMs[0] >= 16_000,
    'delayed key/ack convergence metrics incorrect', failures);
  return final('wave4-delayed-install-and-lost-receipt', h, failures);
}

export async function wave4ReconnectionOldKeys(seed = 0x440106): Promise<Wave4ScenarioResult> {
  const h = await new Wave4EnrolmentHarness(seed, 6).initialize();
  const failures: string[] = [];
  h.request(3, 'rq-obsolete');
  await h.approve(approval(3, 'rq-obsolete', 'tx-obsolete', 1));
  h.commit('tx-obsolete');
  check(!await h.position(2, 1) && !await h.position(1, 2),
    'different local group epochs incorrectly accepted protected positions', failures);
  h.fleet.network.setCarrierAvailable(2, false);
  check(!await h.distribute('tx-obsolete', 2),
    'key delivery succeeded during carrier disconnection', failures);
  h.fleet.network.setCarrierAvailable(2, true);
  check(!await h.position(2, 1),
    'carrier reconnection improperly revived an obsolete group key', failures);
  check(await h.distribute('tx-obsolete', 2) && await h.distribute('tx-obsolete', 3),
    'key recovery after reconnect failed', failures);
  check(await h.acknowledge('tx-obsolete', 1) &&
    await h.acknowledge('tx-obsolete', 2) &&
    await h.acknowledge('tx-obsolete', 3), 'receipt convergence failed', failures);
  check(await h.position(2, 1) && await h.position(1, 2),
    'verified fake current-epoch positions did not resume', failures);
  const report = h.report();
  check(report.metrics.rejectedUnauthorizedPositions >= 3 &&
    report.ackConverged && report.transport.recovery.carrierReconnects === 1,
    'obsolete-key rejections or reconnection not measured', failures);
  return final('wave4-reconnect-with-obsolete-epoch', h, failures);
}

export async function wave4ConcurrentRevokeAndEnrol(seed = 0x440107): Promise<Wave4ScenarioResult> {
  const h = await new Wave4EnrolmentHarness(seed, 8).initialize();
  const failures: string[] = [];
  h.request(3, 'rq-member3');
  await h.approve(approval(3, 'rq-member3', 'tx-member3', 1));
  h.commit('tx-member3');
  check(await settle(h, 'tx-member3'), 'first member not converged', failures);
  h.request(4, 'rq-overlap4');
  await h.approve(approval(4, 'rq-overlap4', 'tx-overlap4', 2));
  check(h.revoke(3) && !h.commit('tx-overlap4'),
    'concurrent revoke did not invalidate the prepared CAS epoch', failures);
  check(!await h.position(3, 1) && !await h.position(2, 1),
    'revoked or obsolete group position changed authority state', failures);
  h.request(4, 'rq-after-revoke4');
  check(await h.approve(approval(4, 'rq-after-revoke4', 'tx-after-revoke4', 3)) &&
    h.commit('tx-after-revoke4'), 'fresh epoch enrolment failed after revocation', failures);
  check(await settle(h, 'tx-after-revoke4'), 'remaining members did not converge after revocation', failures);
  check(!await h.position(3, 1) && await h.position(2, 1),
    'revoked member regained access, or active member stayed unavailable', failures);
  const report = h.report();
  check(report.activeMemberIds.join(',') === '1,2,4' &&
    report.currentEpoch === 4 &&
    report.metrics.rejectedUnauthorizedPositions >= 3 &&
    report.ackConverged,
    'revoke/add serialization or post-revoke authorization incorrect', failures);
  return final('wave4-revocation-races-enrolment', h, failures);
}

export async function wave4IdentityRotationJoin(seed = 0x440108): Promise<Wave4ScenarioResult> {
  const h = await new Wave4EnrolmentHarness(seed, 5).initialize();
  const failures: string[] = [];
  h.request(3, 'rq-before-rotation');
  const old = approval(3, 'rq-before-rotation', 'tx-old-pin', 1);
  await h.approve(old);
  h.rotateIdentity(3);
  check(!h.commit('tx-old-pin') && !await h.approve(old),
    'rotated requester reused old verified fingerprint', failures);
  h.request(3, 'rq-after-rotation');
  const newer = approval(3, 'rq-after-rotation', 'tx-new-pin', 1, 1, 'fake-pin-3-2');
  check(await h.approve(newer) && h.commit('tx-new-pin'),
    'fresh identity request could not pass the fake provider', failures);
  check(await settle(h, 'tx-new-pin'),
    'new identity pending receipt recovery did not converge', failures);
  check(h.report().metrics.committedTransactions === 1 &&
    h.report().metrics.rejectedInvalidTransitions >= 2,
    'stale identity preparation was committed or not rejected', failures);
  return final('wave4-identity-rotation-while-joining', h, failures);
}

export async function wave4SourceAndEmbeddedIdForgery(seed = 0x440109): Promise<Wave4ScenarioResult> {
  const h = await new Wave4EnrolmentHarness(seed, 5).initialize();
  const failures: string[] = [];
  const fakeSender = h.fleet.node(2).security;
  if (!fakeSender) throw new Error('Missing fake Security v1 adapter');
  // The injectable fake decision adapter is supplied by the harness to node 2.
  // Mutate only the fake sender identity, not any canonical protocol code.
  // Access through node security's inherited fake test adapter shape.
  const policy = fakeSender as import('./convoyCampaigns').SecurityDecisionTestAdapter;
  policy.senderDeviceId = 'shadow-device-1';
  check(!await h.position(2, 1), 'unbound source impersonation accepted', failures);
  policy.senderDeviceId = 'shadow-device-2';
  check(await h.position(2, 1), 'restored pinned sender was rejected', failures);
  const previous = h.fleet.positionView(1, 2).lastSequence;
  const wire = encodeBushMeshConvoyWire({
    convoyId: h.fleet.convoyId, nodeId: 1, sequence: 800,
    orderIndex: 1, role: 1, locationUnavailable: true,
  }, 945000);
  const outbound = await h.fleet.node(2).prepareOutbound(wire, {
    identityAssociation: {kind: 'group', groupId: h.fleet.groupId},
    securityRouting: {sourceNodeId: 2, groupId: h.fleet.groupId},
  });
  await h.fleet.network.transmit(2, 1, outbound);
  await h.fleet.network.runUntilIdle();
  const report = h.report();
  check(h.fleet.node(1).lastInboundResult?.status === 'accepted' &&
    h.fleet.positionView(1, 2).lastSequence === previous &&
    report.transport.positionFreshness.unexpectedStateChanges.length === 1,
    'embedded node forgery mutated test-only position projection', failures);
  check(report.metrics.rejectedUnauthorizedPositions >= 1,
    'wrong source binding was not rejected by injected Security adapter', failures);
  return final('wave4-source-and-embedded-id-boundary', h, failures);
}

export async function wave4TwentyVehicleSplitCongestion(seed = 0x440110): Promise<Wave4ScenarioResult> {
  const h = await new Wave4EnrolmentHarness(seed, 20, undefined, {
    bitrateBps: 1500, maxQueueBytes: 380, lossRate: 0,
  }).initialize();
  const failures: string[] = [];
  h.fleet.network.configureSharedChannel({enabled: true});
  h.request(11, 'rq-split11');
  check(await h.approve(approval(11, 'rq-split11', 'tx-split11', 1)) &&
    h.commit('tx-split11'), 'remote join not prepared/committed', failures);
  const rear = h.fleet.ids().slice(10);
  h.fleet.moveGroup(rear, 750);
  check(!await h.distribute('tx-split11', 11) &&
    !h.ackConverged(), 'partitioned member installed a group key without delivery', failures);

  // Queue pressure is real virtual airtime, not artificial queue metrics.
  for (let i = 0; i < 58; i++) {
    await h.fleet.sendMessage(1, 4, {priority: BushMeshPriority.DirectMessage});
    await h.fleet.sendMessage(2, 4, {priority: BushMeshPriority.DirectMessage});
  }
  await h.fleet.network.runUntilIdle();
  h.fleet.moveGroup(rear, -750);
  h.fleet.overrideLink(1, 11, {lossRate: 0, maxQueueBytes: 4_096});
  h.fleet.overrideLink(11, 1, {lossRate: 0, maxQueueBytes: 4_096});
  h.fleet.overrideLink(1, 2, {lossRate: 0, maxQueueBytes: 4_096});
  h.fleet.overrideLink(2, 1, {lossRate: 0, maxQueueBytes: 4_096});
  check(await settle(h, 'tx-split11') && await h.position(11, 1),
    'reconnected member did not receive/ack the committed epoch', failures);
  const report = h.report();
  check(report.transport.delivery.droppedCollision > 0 &&
    report.transport.queue.droppedCongestion > 0 &&
    report.transport.airtime.channelOverlaps > 0 &&
    report.transport.recovery.storeAndForwardRecoveries === 0,
    'high contention did not exercise synthetic losses / queue pressure', failures);
  check(report.ackConverged && report.epochDisagreement === 0 &&
    report.transport.positionFreshness.unexpectedStateChanges.length === 0,
    'rejoin left incomplete key/position convergence', failures);
  return final('wave4-twenty-vehicle-split-contention', h, failures);
}

export async function wave4MultiJoinFixedSeedSoak(seed: number): Promise<Wave4ScenarioResult> {
  const h = await new Wave4EnrolmentHarness(seed, 20).initialize();
  const failures: string[] = [];
  const nodes = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  // Fixed seed changes the order without wall-clock time or hidden I/O.
  nodes.sort((a, b) => a - b);
  for (let i = nodes.length - 1; i > 0; i--) {
    const j = Math.floor(h.fleet.network.random.next() * (i + 1));
    [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
  }
  let previousEpoch = h.epoch;
  for (let index = 0; index < nodes.length; index++) {
    const nodeId = nodes[index];
    const rq = `soak-request-${nodeId}`;
    const tx = `soak-tx-${nodeId}`;
    h.request(nodeId, rq);
    const a = approval(nodeId, rq, tx, h.epoch, index % 2 ? 1 : 2);
    check(await h.approve(a), `prepare failed for ${nodeId}`, failures);
    if (index % 3 === 0) {
      check(!h.commit(tx, true), 'injected shadow partial write was not rejected', failures);
    }
    check(h.commit(tx) && h.epoch === previousEpoch + 1,
      'monotonic epoch transition failed', failures);
    check(await settle(h, tx), 'epoch did not converge during stress', failures);
    check(!await h.approve(a), 'previous approval replay was not denied', failures);
    check(await h.position(nodeId, 1), 'newly installed member cannot send canonical protected position', failures);
    previousEpoch = h.epoch;
  }
  const report = h.report();
  check(report.currentEpoch === 11 && report.activeMemberIds.length === 12 &&
    report.metrics.committedTransactions === 10 &&
    report.metrics.partialCommitsPrevented === 4 &&
    report.metrics.convergenceLagSamplesMs.length === 10 &&
    report.ackConverged &&
    report.transport.positionFreshness.unexpectedStateChanges.length === 0,
    'fixed-seed 10-join monotonicity/ack convergence failed', failures);
  return final('wave4-twenty-node-ten-join-soak', h, failures);
}

export async function wave4InjectedProviderDenial(seed = 0x440111): Promise<Wave4ScenarioResult> {
  const probe: Wave4SecurityDecisionProbe = {
    assurance: 'external-provider-unverified',
    authenticateApproval: async () => false,
    verifyInstalledReceipt: async () => false,
  };
  const h = await new Wave4EnrolmentHarness(seed, 5, probe).initialize();
  const failures: string[] = [];
  h.request(3, 'rq-denied');
  check(!await h.approve(approval(3, 'rq-denied', 'tx-denied', 1)),
    'externally denied approval wrongly added a member', failures);
  check(!h.commit('tx-denied') && h.report().currentEpoch === 1 &&
    h.report().activeMemberIds.join(',') === '1,2',
    'unverified provider result was promoted into an enrolment', failures);
  return final('wave4-injected-decision-port-denial', h, failures);
}
