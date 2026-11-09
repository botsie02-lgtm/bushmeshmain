import {encodeBushMeshConvoyWire} from '../src/bushmesh/protocol/public';

import {
  ConvoyMobilityHarness,
  scenarioAsymmetricRetryChaos,
  scenarioCongestedTwelveNodeConvoy,
  scenarioFleetScale,
  scenarioGpsExpiryAndRecovery,
  scenarioPartitionWithReconnection,
  scenarioSecurityIdentityAndRevocation,
  scenarioTwentyNodeMobileChaos,
  scenarioVehicleSeparationAndRegroup,
  throwConvoyCampaignFailure,
} from '../src/bushmesh/testing/networkSimulator';

describe('frozen Protocol v1 multi-node convoy regression campaigns', () => {
  jest.setTimeout(60_000);

  const regressionReports: unknown[] = [];
  const capture = (campaign: {
    name: string;
    seed: number;
    report: unknown;
    failures: string[];
  }) => {
    regressionReports.push({
      scenario: campaign.name,
      seed: campaign.seed,
      failures: campaign.failures,
      report: campaign.report,
    });
  };

  afterAll(() => {
    // Keep replay diagnostics in the test's in-memory report. Failure traces
    // already include deterministic seeds; no Node filesystem writes occur.
    expect(regressionReports.length).toBeGreaterThan(0);
    // Each deterministic campaign asserts its own failures and invariants.
    // The report may omit the optional failures field for some scenarios.
  });

  it.each([2, 5, 12, 20])('delivers authenticated positions across %i virtual vehicles', async size => {
    const campaign = await scenarioFleetScale(size);
    capture(campaign);
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.nodeCount).toBe(size);
    expect(campaign.report?.positionFreshness.fresh).toBe(size * (size - 1));
    expect(campaign.network.pendingWorkCount()).toBe(0);
  });

  it('separates, holds opaque traffic, regroups and recovers without a fake router', async () => {
    const campaign = await scenarioVehicleSeparationAndRegroup();
    capture(campaign);
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.delivery.storeAndForwardRecoveries).toBe(1);
  });

  it('distinguishes stale GPS, explicit unavailable position, and fresh return', async () => {
    const campaign = await scenarioGpsExpiryAndRecovery();
    capture(campaign);
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.delivery.accepted).toBe(4);
  });

  it('injects asymmetric loss, delays, reordering, duplication and transport retries', async () => {
    const campaign = await scenarioAsymmetricRetryChaos();
    capture(campaign);
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.delivery.transportRetries).toBeGreaterThan(0);
    expect(campaign.report?.delivery.duplicatesSuppressed).toBeGreaterThan(0);
  });

  it('accounts for duty-cycle airtime, bounded congestion and safety priority', async () => {
    const campaign = await scenarioCongestedTwelveNodeConvoy();
    capture(campaign);
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.queue.droppedCongestion).toBeGreaterThan(0);
    expect(campaign.report?.airtime.estimatedMs).toBeGreaterThan(0);
  });

  it('heals a partition and drains deliberately deferred opaque transport packets', async () => {
    const campaign = await scenarioPartitionWithReconnection();
    capture(campaign);
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.delivery.storeAndForwardRecoveries).toBe(1);
  });

  it('fails closed on retired sessions, untrusted rotated identities and revoked members', async () => {
    const campaign = await scenarioSecurityIdentityAndRevocation();
    regressionReports.push({
      scenario: campaign.name,
      seed: campaign.seed,
      failures: campaign.failures,
      securityStatuses: campaign.statuses,
      delivery: {
        accepted: campaign.network.metrics.deliveredDatagrams,
        rejected: campaign.network.metrics.runtimeRejected,
      },
    });
    if (campaign.failures.length) {
      throw new Error(JSON.stringify({
        seed: campaign.seed,
        failures: campaign.failures,
        statuses: campaign.statuses,
        network: campaign.network.failureReport(campaign.failures.join('; ')),
      }, null, 2));
    }
    expect(campaign.statuses).toEqual([
      'accepted', 'rejected', 'accepted',
      'accepted', 'rejected', 'rejected', 'accepted', 'rejected', 'accepted',
    ]);
    expect(campaign.network.metrics.runtimeRejected).toBe(4);
  });

  it('survives 20-node seeded movement, GPS loss, partitions and radio chaos', async () => {
    const campaign = await scenarioTwentyNodeMobileChaos();
    capture(campaign);
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.positionFreshness.unexpectedStateChanges).toEqual([]);
    expect(campaign.network.pendingWorkCount()).toBe(0);
  });

  it('replays the exact 20-node report, metrics and timeline with the same seed', async () => {
    const first = await scenarioTwentyNodeMobileChaos(0xcebabe21);
    const replay = await scenarioTwentyNodeMobileChaos(0xcebabe21);
    capture(first);
    capture(replay);
    throwConvoyCampaignFailure(first);
    throwConvoyCampaignFailure(replay);
    expect(first.report).toEqual(replay.report);
    expect(first.network.metrics).toEqual(replay.network.metrics);
    expect(first.network.trace).toEqual(replay.network.trace);
  });

  it('replays the exact asymmetric chaos profile with the same seed', async () => {
    const first = await scenarioAsymmetricRetryChaos(0xcafe0123);
    const replay = await scenarioAsymmetricRetryChaos(0xcafe0123);
    capture(first);
    capture(replay);
    throwConvoyCampaignFailure(first);
    throwConvoyCampaignFailure(replay);
    expect(first.report).toEqual(replay.report);
    expect(first.network.trace).toEqual(replay.network.trace);
  });

  it('flags an authenticated routing source / embedded convoy identity mismatch without rewriting packets', async () => {
    const fleet = new ConvoyMobilityHarness(0xadeff001);
    await fleet.addFleet(2);
    const mismatched = encodeBushMeshConvoyWire({
      convoyId: 9,
      nodeId: 2, // Deliberately inconsistent with authenticated source 1.
      sequence: 1,
      orderIndex: 0,
      role: 0,
      locationUnavailable: true,
    }, 920_000);
    const outbound = await fleet.node(1).prepareOutbound(mismatched, {
      identityAssociation: {kind: 'group', groupId: fleet.groupId},
      securityRouting: {sourceNodeId: 1, groupId: fleet.groupId},
    });
    await fleet.network.transmit(1, 2, outbound);
    await fleet.network.runUntilIdle();

    // The frozen datagram runtime authenticates/decodes and leaves the
    // application-level convoy node binding to its consumer.
    expect(fleet.node(2).lastInboundResult?.status).toBe('accepted');
    regressionReports.push({
      scenario: 'intentional-mismatched-convoy-source-audit',
      seed: fleet.network.seed,
      expectedViolation: true,
      report: fleet.report(),
    });
    expect(fleet.report().positionFreshness.unexpectedStateChanges).toHaveLength(1);
    expect(fleet.positionView(2, 1).freshness).toBe('never-seen');
  });

  it('rejects fleets outside 2–20 nodes, without creating partial fleets', async () => {
    for (const count of [1, 21]) {
      const fleet = new ConvoyMobilityHarness(0xabcd);
      await expect(fleet.addFleet(count)).rejects.toThrow(/2–20/);
      expect(fleet.ids()).toEqual([]);
    }
  });
});
