/// <reference types="node" />
import {mkdirSync, writeFileSync} from 'fs';
import {
  wave5FleetFaultMatrix,
  wave5GpsQualityLifecycle,
  wave5CarrierUnknownAndReconnect,
  wave5CongestionAndAsymmetry,
  wave5SecurityIngressNegatives,
  wave5ChannelOnlyIsolation,
  throwWave5Failure,
  classifyVirtualDelivery,
  type Wave5FieldResult,
} from '../src/bushmesh/testing/networkSimulator/wave5FieldCampaigns';
import {BushMeshRadioSession} from '../src/radio/BushMeshRadioSession';
import {parseMeshCoreSendAccepted, parseMeshCoreSendConfirmed} from '../src/meshcore/meshcoreDelivery';
import {InMemoryBushMeshOutbox} from '../src/bushmesh/outbox';

describe('Wave 5 field reliability — deterministic test-only fault campaigns', () => {
  jest.setTimeout(120_000);
  const results: Wave5FieldResult[] = [];
  const check = (result: Wave5FieldResult) => {
    results.push(result);
    throwWave5Failure(result);
    expect(result.failures).toEqual([]);
    expect(result.seed).toBeGreaterThan(0);
    expect(result.nodeCount).toBeGreaterThanOrEqual(2);
    expect(result.nodeCount).toBeLessThanOrEqual(10);
    return result;
  };

  afterAll(() => {
    const dir = 'artifacts/wave5-field-reliability';
    mkdirSync(dir, {recursive: true});
    writeFileSync(dir + '/deterministic-regressions.json', JSON.stringify({
      evidenceClass: 'synthetic-virtual-network-and-fake-security-adapter',
      actualPhysicalHardwareTested: false,
      sourceBaseSha: '37ded9fa36de2a14970b522a4e9fd1e677534dc2',
      results,
    }, null, 2) + '\n');
  });

  it.each([
    [2, 0x510002], [3, 0x510003], [5, 0x510005],
    [8, 0x510008], [10, 0x51000a],
  ])('%i vehicle moving convoy under asymmetric packet chaos / partition seed=%i', async (count, seed) => {
    const r = check(await wave5FleetFaultMatrix(count, seed));
    expect(r.report?.queue.currentDepth).toBe(0);
    expect(r.report?.delivery.duplicatesSuppressed).toBeGreaterThan(0);
    expect(r.report?.delivery.transportRetries).toBeGreaterThan(0);
    expect(r.report?.positionFreshness.unexpectedStateChanges).toEqual([]);
  });

  it('replays the same 10-vehicle event order, metrics and position report from a fixed seed', async () => {
    const a = check(await wave5FleetFaultMatrix(10, 0x519abc));
    const b = check(await wave5FleetFaultMatrix(10, 0x519abc));
    expect(a.report).toEqual(b.report);
    expect(a.trace).toEqual(b.trace);
    expect(a.metrics).toEqual(b.metrics);
  });

  it('keeps no position, stale last-known position, GPS missing and recovered position distinct', async () => {
    const r = check(await wave5GpsQualityLifecycle());
    expect(r.report?.delivery.accepted).toBe(3);
    expect(r.report?.positionFreshness.unexpectedStateChanges).toEqual([]);
  });

  it('records an unknown delivery during a radio outage until virtual runtime accepts after reconnect', async () => {
    const r = check(await wave5CarrierUnknownAndReconnect());
    expect(r.report?.delivery.storeAndForwardRecoveries).toBe(1);
    expect(r.report?.delivery.accepted).toBe(1);
    expect(classifyVirtualDelivery([], 991)).toBe('unknown-not-yet-processed');
  });

  it('enforces queue bounds, emergency priority and asymmetric airtime under heavy load', async () => {
    const r = check(await wave5CongestionAndAsymmetry());
    expect(r.report?.queue.droppedCongestion).toBeGreaterThan(0);
    expect(r.metrics.droppedLoss).toBeGreaterThan(0);
    expect(r.metrics.estimatedAirtimeMs).toBeGreaterThan(0);
  });

  it('keeps the fake provider negatives strict: replay, stale epoch, forged sender, revoked identity and embedded ID', async () => {
    const r = check(await wave5SecurityIngressNegatives());
    expect(r.extra.securityAssurance).toBe('fake-adapter-only');
    expect(r.metrics.runtimeRejected).toBeGreaterThanOrEqual(4);
    expect(r.metrics.runtimeDuplicates).toBeGreaterThan(0);
    expect(r.extra.acceptedIngress).toBe(3);
  });

  it('does not elevate unprotected channel-only position contents into an authenticated convoy', async () => {
    const r = check(await wave5ChannelOnlyIsolation());
    expect(r.extra.authenticatedRosterSize).toBe(0);
    expect(r.report?.positionFreshness.neverSeen).toBe(2);
  });

  it('retains queued traffic on abrupt owner suspension; new BLE owner cancels old-identity queue', async () => {
    const radio = new BushMeshRadioSession();
    const ownerA = {name: 'native-owner'};
    const ownerB = {name: 'new-ble-owner'};
    const sendsA: string[] = [];
    const sendsB: string[] = [];
    radio.claimTransport(ownerA, async (_ch, _dt, payload) => {
      sendsA.push(Array.from(payload).join(','));
    });
    expect(radio.setIdentityForOwner(ownerA, 'AAAA1111AAAA')).toBe(true);
    const old = radio.queueOutboundDatagram({
      channelIndex: 4, dataType: 0xff00,
      payload: Uint8Array.from([1, 2, 3]),
      priority: 'position', description: 'old owner position',
      createdAtMs: 1000, expiresAtMs: null,
      retryPolicy: {maxAttempts: 2},
    });
    expect(radio.suspendTransportForOwner(ownerA)).toBe(true);
    expect((await radio.drainOnce(1200)).outcome).toBe('idle');
    expect(radio.listOutbox().find(e => e.id === old.id)?.state).toBe('queued');
    radio.claimTransport(ownerB, async (_ch, _dt, payload) => {
      sendsB.push(Array.from(payload).join(','));
    });
    expect(radio.releaseTransport(ownerA)).toBe(false);
    expect(radio.resumeTransportForOwner(ownerA, async () => {})).toBe(false);
    expect(radio.setIdentityForOwner(ownerB, 'BBBB2222BBBB')).toBe(true);
    expect(radio.listOutbox().find(e => e.id === old.id)?.state).toBe('cancelled');
    radio.queueOutboundDatagram({
      channelIndex: 4, dataType: 0xff00,
      payload: Uint8Array.from([4, 5, 6]), priority: 'message',
      description: 'new owner traffic', createdAtMs: 1300, expiresAtMs: null,
      retryPolicy: {maxAttempts: 2},
    });
    expect((await radio.drainOnce(1300)).outcome).toBe('accepted');
    expect(sendsA).toEqual([]);
    expect(sendsB).toEqual(['4,5,6']);
    expect(radio.releaseTransport(ownerB)).toBe(true);
    expect(radio.getSnapshot().transportReady).toBe(false);
  });

  it('cancels only relevant old channel position requests, never queued safety data', () => {
    const outbox = new InMemoryBushMeshOutbox();
    const old = outbox.enqueue({channelIndex: 4, dataType: 1,
      payload: Uint8Array.from([1]), priority: 'position',
      identityRef: 'A', description: 'old location', createdAtMs: 1000});
    const other = outbox.enqueue({channelIndex: 5, dataType: 1,
      payload: Uint8Array.from([2]), priority: 'position',
      identityRef: 'A', description: 'other channel', createdAtMs: 1001});
    const safety = outbox.enqueue({channelIndex: 4, dataType: 1,
      payload: Uint8Array.from([3]), priority: 'safety',
      identityRef: 'A', description: 'HELP', createdAtMs: 1002});
    const removed = outbox.cancelQueuedPositions('A', 4);
    expect(removed.map(e => e.id)).toEqual([old.id]);
    expect(outbox.list().find(e => e.id === other.id)?.state).toBe('queued');
    expect(outbox.nextReady(1100)?.id).toBe(safety.id);
  });

  it('does not turn a MeshCore accepted tag into peer-delivered evidence without matching confirmation', () => {
    const accepted = parseMeshCoreSendAccepted([0x06, 0x01, 0x11, 0x22, 0x33, 0x44]);
    expect(accepted).toEqual({
      route: 'flood', expectedAckHex: '11223344', suggestedTimeoutMs: null,
    });
    expect(parseMeshCoreSendConfirmed([0x00])).toBeNull();
    expect(parseMeshCoreSendConfirmed([0x82, 0x44, 0x33, 0x22, 0x11])?.ackHex)
      .not.toBe(accepted?.expectedAckHex);
    expect(parseMeshCoreSendConfirmed([0x82, 0x11, 0x22, 0x33, 0x44])?.ackHex)
      .toBe(accepted?.expectedAckHex);
  });
});
