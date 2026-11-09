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

  it.each([2, 5, 12, 20])('delivers authenticated positions across %i virtual vehicles', async size => {
    const campaign = await scenarioFleetScale(size);
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.nodeCount).toBe(size);
    expect(campaign.report?.positionFreshness.fresh).toBe(size * (size - 1));
    expect(campaign.network.pendingWorkCount()).toBe(0);
  });

  it('separates, holds opaque traffic, regroups and recovers without a fake router', async () => {
    const campaign = await scenarioVehicleSeparationAndRegroup();
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.delivery.storeAndForwardRecoveries).toBe(1);
  });

  it('distinguishes stale GPS, explicit unavailable position, and fresh return', async () => {
    const campaign = await scenarioGpsExpiryAndRecovery();
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.delivery.accepted).toBe(4);
  });

  it('injects asymmetric loss, delays, reordering, duplication and transport retries', async () => {
    const campaign = await scenarioAsymmetricRetryChaos();
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.delivery.transportRetries).toBeGreaterThan(0);
    expect(campaign.report?.delivery.duplicatesSuppressed).toBeGreaterThan(0);
  });

  it('accounts for duty-cycle airtime, bounded congestion and safety priority', async () => {
    const campaign = await scenarioCongestedTwelveNodeConvoy();
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.queue.droppedCongestion).toBeGreaterThan(0);
    expect(campaign.report?.airtime.estimatedMs).toBeGreaterThan(0);
  });

  it('heals a partition and drains deliberately deferred opaque transport packets', async () => {
    const campaign = await scenarioPartitionWithReconnection();
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.delivery.storeAndForwardRecoveries).toBe(1);
  });

  it('fails closed on retired sessions, untrusted rotated identities and revoked members', async () => {
    const campaign = await scenarioSecurityIdentityAndRevocation();
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
      'accepted', 'rejected', 'accepted', 'rejected', 'rejected',
    ]);
    expect(campaign.network.metrics.runtimeRejected).toBe(4);
  });

  it('survives 20-node seeded movement, GPS loss, partitions and radio chaos', async () => {
    const campaign = await scenarioTwentyNodeMobileChaos();
    throwConvoyCampaignFailure(campaign);
    expect(campaign.report?.positionFreshness.unexpectedStateChanges).toEqual([]);
    expect(campaign.network.pendingWorkCount()).toBe(0);
  });

  it('replays the exact 20-node report, metrics and timeline with the same seed', async () => {
    const first = await scenarioTwentyNodeMobileChaos(0xcebabe21);
    const replay = await scenarioTwentyNodeMobileChaos(0xcebabe21);
    throwConvoyCampaignFailure(first);
    throwConvoyCampaignFailure(replay);
    expect(first.report).toEqual(replay.report);
    expect(first.network.metrics).toEqual(replay.network.metrics);
    expect(first.network.trace).toEqual(replay.network.trace);
  });

  it('replays the exact asymmetric chaos profile with the same seed', async () => {
    const first = await scenarioAsymmetricRetryChaos(0xcafe0123);
    const replay = await scenarioAsymmetricRetryChaos(0xcafe0123);
    throwConvoyCampaignFailure(first);
    throwConvoyCampaignFailure(replay);
    expect(first.report).toEqual(replay.report);
    expect(first.network.trace).toEqual(replay.network.trace);
  });

  it('rejects fleets outside 2–20 nodes, without creating partial fleets', async () => {
    for (const count of [1, 21]) {
      const fleet = new ConvoyMobilityHarness(0xabcd);
      await expect(fleet.addFleet(count)).rejects.toThrow(/2–20/);
      expect(fleet.ids()).toEqual([]);
    }
  });
});
