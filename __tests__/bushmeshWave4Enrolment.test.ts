import {mkdirSync, writeFileSync} from 'fs';

import {
  wave4SimultaneousJoins,
  wave4AuthorityDisappearance,
  wave4ApprovalReplayConflict,
  wave4PartialCommitRestart,
  wave4DelayedKeyAndLostAcks,
  wave4ReconnectionOldKeys,
  wave4ConcurrentRevokeAndEnrol,
  wave4IdentityRotationJoin,
  wave4SourceAndEmbeddedIdForgery,
  wave4TwentyVehicleSplitCongestion,
  wave4MultiJoinFixedSeedSoak,
  wave4InjectedProviderDenial,
  wave4DroppedPositionNoStaleSuccess,
  Wave4ScenarioResult,
} from '../src/bushmesh/testing/networkSimulator';

describe('Wave 4 Security v2 enrolment boundary — deterministic fake decision probes ONLY', () => {
  jest.setTimeout(120_000);
  const reports: Wave4ScenarioResult[] = [];

  const checked = (result: Wave4ScenarioResult): Wave4ScenarioResult => {
    reports.push(result);
    if (!result.passed) {
      throw new Error(result.failureReport ?? JSON.stringify(result.failures));
    }
    expect(result.failures).toEqual([]);
    expect(result.seed).toBeGreaterThan(0);
    expect(result.nodeCount).toBeGreaterThanOrEqual(2);
    expect(result.nodeCount).toBeLessThanOrEqual(20);
    expect(result.security.currentEpoch).toBeGreaterThanOrEqual(1);
    expect(result.security.transport.seed).toBe(result.seed);
    return result;
  };

  afterAll(() => {
    mkdirSync('artifacts/network-simulator', {recursive: true});
    writeFileSync(
      'artifacts/network-simulator/wave4-enrolment-regressions.json',
      JSON.stringify({
        evidence: 'shadow-enrolment-fake-provider-only',
        frozenProtocolV1Sha: '67327e641b169ec94600a7b07188946058c067b7',
        claimsExcluded: [
          'Security v2 cryptographic approval verification',
          'atomic production roster/key commit',
          'authenticated installed-key acknowledgement',
          'secure incremental enrolment',
          'production Android storage/identity',
          'real RF or verified live convoy membership',
        ],
        reports,
      }, null, 2) + '\n',
      'utf8',
    );
  });

  it('serializes simultaneous joins via expected-epoch CAS without two shadow commits', async () => {
    const r = checked(await wave4SimultaneousJoins());
    expect(r.security.metrics.committedTransactions).toBe(2);
    expect(r.security.metrics.convergenceLagSamplesMs).toHaveLength(2);
    expect(r.security.ackConverged).toBe(true);
  });

  it('fails closed when a leader or delegated admin disappears while joining', async () => {
    const r = checked(await wave4AuthorityDisappearance());
    expect(r.security.metrics.rejectedInvalidTransitions).toBeGreaterThanOrEqual(2);
    expect(r.security.transport.recovery.nodeReturns).toBeGreaterThanOrEqual(2);
  });

  it('rejects conflicting and replayed approvals across commit', async () => {
    const r = checked(await wave4ApprovalReplayConflict());
    expect(r.security.metrics.conflictingApprovals).toBeGreaterThanOrEqual(2);
    expect(r.security.metrics.replayedApprovals).toBeGreaterThanOrEqual(2);
  });

  it('prevents partial shadow commit, and fail-closes a missing restart journal', async () => {
    const r = checked(await wave4PartialCommitRestart());
    expect(r.security.metrics.partialCommitsPrevented).toBe(1);
    expect(r.security.metrics.rollbackBlocked).toBeGreaterThanOrEqual(2);
  });

  it('distinguishes delayed recipient install from a lost, unverified installation acknowledgement', async () => {
    const r = checked(await wave4DelayedKeyAndLostAcks());
    expect(r.security.metrics.lostInstallAcks).toBe(1);
    expect(r.security.metrics.convergenceLagSamplesMs[0]).toBeGreaterThanOrEqual(16_000);
    expect(r.security.ackConverged).toBe(true);
  });

  it('rejects obsolete member epochs after reconnect until an explicit mock installation', async () => {
    const r = checked(await wave4ReconnectionOldKeys());
    expect(r.security.metrics.rejectedUnauthorizedPositions).toBeGreaterThanOrEqual(3);
    expect(r.security.transport.recovery.carrierReconnects).toBe(1);
  });

  it('serializes concurrent member revocation and new enrolment and denies stale positions', async () => {
    const r = checked(await wave4ConcurrentRevokeAndEnrol());
    expect(r.security.activeMemberIds).toEqual([1, 2, 4]);
    expect(r.security.metrics.rejectedUnauthorizedPositions).toBeGreaterThanOrEqual(3);
  });

  it('invalidates prepared approvals after identity rotation during joining', async () => {
    const r = checked(await wave4IdentityRotationJoin());
    expect(r.security.metrics.committedTransactions).toBe(1);
    expect(r.security.activeMemberIds).toContain(3);
  });

  it('rejects mismatched sender binding and flags embedded node ID conflicts', async () => {
    const r = checked(await wave4SourceAndEmbeddedIdForgery());
    expect(r.security.transport.positionFreshness.unexpectedStateChanges).toHaveLength(1);
    expect(r.security.metrics.rejectedUnauthorizedPositions).toBeGreaterThanOrEqual(1);
  });

  it('reconnects and converges critical key/position traffic after 20-node congestion and a split', async () => {
    const r = checked(await wave4TwentyVehicleSplitCongestion());
    expect(r.security.ackConverged).toBe(true);
    expect(r.security.transport.airtime.channelOverlaps).toBeGreaterThan(0);
    expect(r.security.transport.delivery.droppedCollision).toBeGreaterThan(0);
    expect(r.security.transport.queue.droppedCongestion).toBeGreaterThan(0);
  });

  it.each([0x440201, 0x440202, 0x440203])(
    'runs ten monotonic shadow member joins across 20 virtual devices with fixed seed %i',
    async seed => {
      const r = checked(await wave4MultiJoinFixedSeedSoak(seed));
      expect(r.security.currentEpoch).toBe(11);
      expect(r.security.metrics.committedTransactions).toBe(10);
      expect(r.security.ackConverged).toBe(true);
      expect(r.security.metrics.convergenceLagSamplesMs).toHaveLength(10);
    },
  );

  it('replays exactly the same epoch convergence counters and security events with the same seed', async () => {
    const a = checked(await wave4MultiJoinFixedSeedSoak(0x4402da));
    const b = checked(await wave4MultiJoinFixedSeedSoak(0x4402da));
    expect(a.security).toEqual(b.security);
    expect(a.trace).toEqual(b.trace);
    expect(a.failureReport).toBeNull();
  });

  it('does not misreport a dropped protected position as accepted using the last inbound result', async () => {
    const result = checked(await wave4DroppedPositionNoStaleSuccess());
    expect(result.security.metrics.rejectedUnauthorizedPositions).toBe(0);
    expect(result.security.transport.delivery.failed).toBeGreaterThanOrEqual(1);
  });

  it('honours an injected external decision-port refusal without claiming a Security v2 provider', async () => {
    const r = checked(await wave4InjectedProviderDenial());
    expect(r.assurance).toBe('external-provider-unverified');
    expect(r.security.metrics.committedTransactions).toBe(0);
    expect(r.security.currentEpoch).toBe(1);
  });
});
