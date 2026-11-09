import {mkdirSync, writeFileSync} from 'fs';

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
  scenarioSimultaneousTransmitters,
  scenarioCaptureAndChannelIsolation,
  scenarioHalfDuplexFairness,
  scenarioLeaderSplitAndIntermittentRelay,
  scenarioDelayedPositionAntiRollback,
  scenarioSecurityEpochUnderActiveTraffic,
  scenarioExtendedSharedChannelSoak,
  throwSharedChannelFailure,
} from '../src/bushmesh/testing/networkSimulator';

describe('frozen Protocol v1 multi-node convoy regression campaigns', () => {
  jest.setTimeout(90_000);

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
    // On successful and failed runs, preserve deterministic, reviewable
    // delivery/queue/airtime/freshness regression snapshots.
    const destination = 'artifacts/network-simulator';
    mkdirSync(destination, {recursive: true});
    writeFileSync(
      destination + '/convoy-regressions.json',
      JSON.stringify({
        protocolSha: '67327e641b169ec94600a7b07188946058c067b7',
        reports: regressionReports,
      }, null, 2) + '\n',
      'utf8',
    );
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
  it('models simultaneous contention among eleven transmitters without fabricated delivery', async () => {
    const campaign = await scenarioSimultaneousTransmitters();
    capture(campaign);
    throwSharedChannelFailure(campaign);
    expect(campaign.report.airtime.channelOverlaps).toBeGreaterThan(0);
    expect(campaign.report.delivery.droppedCollision).toBeGreaterThan(0);
    expect(Object.keys(campaign.report.airtime.transmissionsBySender)).toHaveLength(11);
  });

  it('applies synthetic signal-strength capture and channel-index isolation', async () => {
    const campaign = await scenarioCaptureAndChannelIsolation();
    capture(campaign);
    throwSharedChannelFailure(campaign);
    expect(campaign.report.delivery.accepted).toBe(3);
    expect(campaign.report.delivery.droppedCollision).toBe(1);
  });

  it('corrupts equal-power overlaps with zero capture margin', async () => {
    const fleet = new ConvoyMobilityHarness(0xb10c0111, {
      radioRangeMetres: 100,
      link: {bitrateBps: 1_500, baseDelayMs: 1},
    });
    await fleet.addFleet(3, 12);
    fleet.network.configureSharedChannel({enabled: true, captureMarginDb: 0});
    fleet.overrideLink(1, 3, {rssiDbm: -80});
    fleet.overrideLink(2, 3, {rssiDbm: -80});
    await fleet.sendMessage(1, 3);
    await fleet.sendMessage(2, 3);
    await fleet.network.runUntilIdle();
    capture({name: 'equal-power-zero-margin-collision', seed: fleet.network.seed,
      report: fleet.report(), failures: []});
    expect(fleet.network.metrics.channelOverlaps).toBe(1);
    expect(fleet.network.metrics.droppedCollision).toBe(2);
    expect(fleet.network.metrics.deliveredDatagrams).toBe(0);
  });

  it('enforces one transmitter per vehicle, safety priority and queue fairness', async () => {
    const campaign = await scenarioHalfDuplexFairness();
    capture(campaign);
    throwSharedChannelFailure(campaign);
    expect(campaign.report.airtime.transmissionsBySender['1']).toBe(26);
    expect(campaign.report.queue.currentDepth).toBe(0);
  });

  it('separates a leader, loses an intermediate relay and recovers queued carrier legs', async () => {
    const campaign = await scenarioLeaderSplitAndIntermittentRelay();
    capture(campaign);
    throwSharedChannelFailure(campaign);
    expect(campaign.report.recovery.storeAndForwardRecoveries).toBe(2);
  });

  it('does not roll back the location projection when an older position arrives much later', async () => {
    const campaign = await scenarioDelayedPositionAntiRollback();
    capture(campaign);
    throwSharedChannelFailure(campaign);
    expect(campaign.report.positionFreshness.olderSequenceIgnored).toBe(1);
  });

  it('rejects retired Security epochs, counter replays and member traffic while live convoy positions flow', async () => {
    const campaign = await scenarioSecurityEpochUnderActiveTraffic();
    capture(campaign);
    throwSharedChannelFailure(campaign);
    expect(campaign.report.delivery.unauthorisedUpdatesRejected).toBe(6);
    expect(campaign.report.positionFreshness.unexpectedStateChanges).toHaveLength(1);
    expect(campaign.report.recovery.carrierReconnects).toBe(1);
  });

  it.each([0x55a71ee1, 0x55a71ee2, 0x55a71ee3])(
    'completes extended 20-vehicle shared RF seeded chaos soak %i', async seed => {
      const campaign = await scenarioExtendedSharedChannelSoak(seed);
      capture(campaign);
      throwSharedChannelFailure(campaign);
      expect(campaign.report.delivery.attempted).toBe(401);
      expect(campaign.network.pendingWorkCount()).toBe(0);
    },
  );

  it('reproduces identical shared-airtime collision/soak trace and report from the same seed', async () => {
    const seed = 0x51d0c0de;
    const first = await scenarioExtendedSharedChannelSoak(seed);
    const second = await scenarioExtendedSharedChannelSoak(seed);
    capture(first);
    capture(second);
    throwSharedChannelFailure(first);
    throwSharedChannelFailure(second);
    expect(first.report).toEqual(second.report);
    expect(first.network.trace).toEqual(second.network.trace);
    expect(first.network.metrics).toEqual(second.network.metrics);
  });

  it('rejects synthetic capture configuration changes during active traffic', async () => {
    const fleet = new ConvoyMobilityHarness(0xabc1);
    await fleet.addFleet(2);
    expect(() => fleet.network.configureSharedChannel({
      enabled: true, captureMarginDb: -1,
    })).toThrow();
    fleet.network.configureSharedChannel({enabled: true, captureMarginDb: 8});
    await fleet.sendMessage(1, 2);
    expect(() => fleet.network.configureSharedChannel({enabled: false})).toThrow();
    await fleet.network.runUntilIdle();
    capture({name: 'invalid-channel-configuration', seed: 0xabc1,
      report: fleet.report(), failures: []});
  });

});
