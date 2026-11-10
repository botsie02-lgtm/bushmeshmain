import {
  createBushMeshSecurityProtocolContext,
  decodeBushMeshTypedPacket,
  decodeBushMeshWire,
  encodeBushMeshConvoyWire,
  encodeBushMeshProtectedGroupContainer,
} from '../src/bushmesh/protocol/public';
import type {BushMeshInboundResult} from '../src/bushmesh/runtime/public';
import {
  VerifiedConvoyTelemetry,
} from '../src/convoy/verifiedTelemetry/VerifiedConvoyTelemetry';
import type {
  ProtectedTelemetryCheckpointStore,
  VerifiedTelemetryAuthority,
  VerifiedTelemetryRoster,
} from '../src/convoy/verifiedTelemetry/contracts';

const GROUP = 'bmg1_authtelemetry001';
const NOW = 1_800_000_000_000;

function roster(size: number): VerifiedTelemetryRoster {
  return {
    verifiedBy: 'security-group-and-node-bindings',
    convoyId: 'bmc1_authenticated01',
    protocolConvoyId: 41,
    securityGroupId: GROUP,
    currentEpoch: 2,
    localDeviceId: 'device_0',
    localFingerprint: 'fingerprint_0',
    localNodeId: 100,
    revision: 'verified-revision-1',
    members: Array.from({length: size}, (_, i) => ({
      deviceId: 'device_' + i,
      fingerprint: 'fingerprint_' + i,
      nodeId: 100 + i,
      label: 'Vehicle ' + i,
      orderIndex: i,
      role: 1,
      state: 'active' as const,
    })),
  };
}

type Harness = {
  get: () => VerifiedTelemetryRoster | null;
  set: (value: VerifiedTelemetryRoster | null, notify?: boolean) => void;
  authority: VerifiedTelemetryAuthority;
};

function authority(initial: VerifiedTelemetryRoster | null): Harness {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (value, notify = true) => {
      current = value;
      if (notify) listeners.forEach(listener => listener());
    },
    authority: {
      resolveActiveRoster: async () => current,
      subscribeInvalidations: listener => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    },
  };
}

type PacketChange = {
  embeddedNode?: number;
  sourceNode?: number;
  groupId?: string;
  senderDeviceId?: string;
  epoch?: number;
  convoyId?: number;
  orderIndex?: number;
  role?: number;
  sequence?: number;
  messageId?: number;
  receivedAt?: number;
  latitude?: number;
  unavailable?: boolean;
};

function protectedAccepted(
  active: VerifiedTelemetryRoster,
  index: number,
  change: PacketChange = {},
): BushMeshInboundResult {
  const member = active.members[index];
  const groupId = change.groupId ?? active.securityGroupId;
  const sourceNodeId = change.sourceNode ?? member.nodeId;
  const messageId = change.messageId ?? 12;
  const wire = encodeBushMeshConvoyWire({
    convoyId: change.convoyId ?? active.protocolConvoyId,
    nodeId: change.embeddedNode ?? member.nodeId,
    sequence: change.sequence ?? 1,
    orderIndex: change.orderIndex ?? member.orderIndex,
    role: change.role ?? member.role,
    ...(change.unavailable
      ? {locationUnavailable: true}
      : {location: {latitude: change.latitude ?? -37.81, longitude: 144.96}}),
  }, messageId);
  const routing = {sourceNodeId, groupId};
  const header = createBushMeshSecurityProtocolContext(wire, routing);
  const payload = encodeBushMeshProtectedGroupContainer({
    routing,
    authenticatedHeader: header.authenticatedHeader,
    message: {
      securityVersion: 1,
      protocolVersion: 1,
      groupId,
      epoch: change.epoch ?? active.currentEpoch,
      senderDeviceId: change.senderDeviceId ?? member.deviceId,
      counter: '1',
      ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA',
    },
  });
  return {
    status: 'accepted',
    kind: 'protocol',
    protected: true,
    securityMode: 'protected-group',
    securityAssociation: {kind: 'group', groupId},
    securityRouting: routing,
    typed: decodeBushMeshTypedPacket(wire),
    decoded: decodeBushMeshWire(wire),
    datagram: {
      payload: Uint8Array.from(payload),
      receivedAtMs: change.receivedAt ?? NOW,
      channelIndex: 0,
      dataType: 1,
      source: 'live',
      transport: 'test-carrier',
    },
  };
}

/** Test-only fake; never install as production radio/security bridge. */
function outboundHarness(current: Harness, now: () => number) {
  let seq = 0;
  const submitted: Array<{wire: number[]; options: unknown}> = [];
  let air = true;
  const coordinator = new VerifiedConvoyTelemetry({
    authority: current.authority,
    clock: now,
    sequences: {
      next: async () => ({sequence: ++seq, messageId: 900 + seq}),
    },
    airtime: {allowProtectedPosition: async () => air},
    runtime: {
      prepareAndQueue: async (wire, options) => {
        submitted.push({wire: Array.from(wire), options});
        return {queued: true};
      },
    },
  });
  return {coordinator, submitted, blockAirtime: () => {air = false;}};
}

const target = {channelIndex: 0, dataType: 1, transport: 'test-carrier'};
function androidFix(now: number, latitude = -37.81) {
  return {
    providerId: 'android-gps' as const,
    fix: {
      latitude, longitude: 144.96, timestampMs: now,
      accuracyMeters: 8, speedKmh: 30, headingDegrees: 72,
    },
  };
}

describe('verified convoy telemetry: multi-vehicle authenticated projection', () => {
  it.each([2, 5, 20])('accepts all legitimate vehicles in a %i-vehicle convoy', async size => {
    const active = roster(size);
    const context = authority(active);
    const service = new VerifiedConvoyTelemetry({authority: context.authority, clock: () => NOW});
    const pre = await service.project();
    expect(pre?.members).toHaveLength(size - 1);
    expect(pre?.mapMembers.every(member => member.position === null)).toBe(true);

    for (let i = 1; i < size; i += 1) {
      expect(await service.ingest(protectedAccepted(active, i, {
        sequence: 10 + i, messageId: 100 + i,
        latitude: -37.81 + i * 0.0001,
      }))).toBe(true);
    }
    const projection = await service.project();
    expect(projection?.mapMembers).toHaveLength(size - 1);
    expect(projection?.mapMembers.every(member => member.position !== null)).toBe(true);
    expect(projection?.members.every(member => member.presence === 'live')).toBe(true);
    service.dispose();
  });

  it('rejects claimed identity, wrong convoy, wrong group and wrong key epoch', async () => {
    const active = roster(5);
    const service = new VerifiedConvoyTelemetry({
      authority: authority(active).authority, clock: () => NOW,
    });
    const attempts: PacketChange[] = [
      {embeddedNode: 400}, {sourceNode: 400},
      {convoyId: 999}, {groupId: 'bmg1_othergroup'},
      {senderDeviceId: 'device_2'}, {senderDeviceId: 'contact_forgery'},
      {epoch: 1}, {epoch: 3}, {orderIndex: 99}, {role: 4},
    ];
    for (const changed of attempts) {
      expect(await service.ingest(protectedAccepted(active, 1, changed))).toBe(false);
    }
    expect((await service.project())?.mapMembers[0].position).toBeNull();
  });

  it('rejects plaintext, direct traffic, malformed security container, and tampered AAD', async () => {
    const active = roster(2);
    const service = new VerifiedConvoyTelemetry({
      authority: authority(active).authority, clock: () => NOW,
    });
    const valid = protectedAccepted(active, 1);
    expect(await service.ingest({...valid, protected: false} as BushMeshInboundResult)).toBe(false);
    expect(await service.ingest({
      ...valid, securityMode: 'protected-direct',
    } as BushMeshInboundResult)).toBe(false);
    if (valid.status !== 'accepted' || valid.kind !== 'protocol') throw new Error('fixture');
    const broken = {
      ...valid, datagram: {...valid.datagram, payload: Uint8Array.from([0x01, 0x02])},
    };
    expect(await service.ingest(broken)).toBe(false);
    const tampered = {
      ...valid,
      decoded: {...valid.decoded, wireBytes: [...valid.decoded.wireBytes]},
    };
    tampered.decoded.wireBytes[4] ^= 1; // messageId participates in canonical AAD
    expect(await service.ingest(tampered)).toBe(false);
  });

  it('enforces serial sequence replay, duplicated frames and out-of-order positions', async () => {
    const active = roster(2);
    const service = new VerifiedConvoyTelemetry({
      authority: authority(active).authority, clock: () => NOW,
    });
    expect(await service.ingest(protectedAccepted(active, 1, {sequence: 10}))).toBe(true);
    expect(await service.ingest(protectedAccepted(active, 1, {sequence: 10}))).toBe(false);
    expect(await service.ingest(protectedAccepted(active, 1, {sequence: 9}))).toBe(false);
    expect(await service.ingest(protectedAccepted(active, 1, {sequence: 11, latitude: -37.82}))).toBe(true);
    expect((await service.project())?.mapMembers[0].position?.latitude).toBeCloseTo(-37.82, 3);
  });

  it('rejects stale and future ingress; derives disconnected and missing positions', async () => {
    let now = NOW;
    const active = roster(3);
    const service = new VerifiedConvoyTelemetry({
      authority: authority(active).authority, clock: () => now,
    });
    expect(await service.ingest(protectedAccepted(active, 1, {receivedAt: NOW - 91_000}))).toBe(false);
    expect(await service.ingest(protectedAccepted(active, 1, {receivedAt: NOW + 6_000}))).toBe(false);
    expect(await service.ingest(protectedAccepted(active, 1))).toBe(true);
    now += 150_000;
    expect((await service.project())?.members.map(m => m.presence)).toEqual(['stale', 'missing-position']);
    now += 200_000;
    expect((await service.project())?.members[0].presence).toBe('disconnected');
    now += 300_000;
    expect((await service.project())?.mapMembers[0].position).toBeNull();
  });

  it('GPS-unavailable marker drops the position and does not permit unauthenticated delta', async () => {
    const active = roster(2);
    const service = new VerifiedConvoyTelemetry({
      authority: authority(active).authority, clock: () => NOW,
    });
    expect(await service.ingest(protectedAccepted(active, 1, {sequence: 1}))).toBe(true);
    expect(await service.ingest(protectedAccepted(active, 1, {
      sequence: 2, unavailable: true,
    }))).toBe(true);
    expect((await service.project())?.mapMembers[0].position).toBeNull();
    expect(await service.ingest(protectedAccepted(active, 1, {sequence: 3}))).toBe(true);
    expect((await service.project())?.mapMembers[0].position).not.toBeNull();
  });

  it('revocation, identity rotation, group epoch and active convoy changes purge positions', async () => {
    const original = roster(3);
    const source = authority(original);
    const service = new VerifiedConvoyTelemetry({
      authority: source.authority, clock: () => NOW,
    });
    expect(await service.ingest(protectedAccepted(original, 1))).toBe(true);
    const changed = roster(3);
    changed.members = changed.members.map((m, i) => i === 1 ? {...m, state: 'revoked'} : m);
    changed.revision = 'verified-revision-2';
    source.set(changed);
    expect((await service.project())?.members.map(m => m.deviceId)).toEqual(['device_2']);
    expect(await service.ingest(protectedAccepted(original, 1))).toBe(false);
    changed.members = changed.members.map((m, i) => i === 1 ? {
      ...m, state: 'active', fingerprint: 'fingerprint_rotated',
    } : m);
    changed.currentEpoch = 3;
    changed.revision = 'verified-revision-3';
    source.set(changed);
    expect((await service.project())?.mapMembers[0].position).toBeNull();
    expect(await service.ingest(protectedAccepted(changed, 1, {epoch: 2}))).toBe(false);
    expect(await service.ingest(protectedAccepted(changed, 1, {epoch: 3}))).toBe(true);
    source.set(null);
    expect(await service.project()).toBeNull();
  });

  it('rejects unverified rosters, missing local group and duplicate node bindings', async () => {
    const source = authority(null);
    const service = new VerifiedConvoyTelemetry({authority: source.authority, clock: () => NOW});
    expect(await service.project()).toBeNull();
    expect(await service.ingest(protectedAccepted(roster(2), 1))).toBe(false);
    const bad = roster(2);
    bad.members = bad.members.map((m, i) => i === 1 ? {...m, nodeId: bad.localNodeId} : m);
    source.set(bad);
    expect(await service.project()).toBeNull();
    expect(await new VerifiedConvoyTelemetry().publish(androidFix(NOW), target))
      .toEqual({status: 'suppressed', reason: 'verified-security-or-runtime-unavailable'});
  });
});

describe('verified convoy telemetry: outgoing GPS, airtime and restart lifecycle', () => {
  it('encodes Protocol v1 convoy heartbeats with group protection and no delivery claim', async () => {
    let now = NOW;
    const source = authority(roster(2));
    const {coordinator, submitted, blockAirtime} = outboundHarness(source, () => now);
    expect(await coordinator.publish(androidFix(now), target)).toEqual({
      status: 'queued-locally', messageId: 901, sequence: 1,
    });
    expect(submitted).toHaveLength(1);
    const packet = decodeBushMeshTypedPacket(submitted[0].wire);
    expect(packet.kind).toBe('convoy');
    if (packet.kind !== 'convoy') throw new Error('expected convoy packet');
    expect(packet.value.nodeId).toBe(100);
    expect(packet.value.convoyId).toBe(41);
    expect(packet.value.location?.latitude).toBeCloseTo(-37.81, 3);
    expect(submitted[0].options).toEqual(expect.objectContaining({
      trafficClass: 'convoy-group',
      identityAssociation: {kind: 'group', groupId: GROUP},
      securityRouting: {sourceNodeId: 100, groupId: GROUP},
      retryIntent: {mode: 'none', maxTransportAttempts: 1},
    }));
    expect(await coordinator.publish(androidFix(now), target)).toEqual({
      status: 'suppressed', reason: 'minimum-interval',
    });
    now += 35_000;
    expect((await coordinator.publish(androidFix(now), target)).status).toBe('suppressed');
    now += 35_000;
    expect((await coordinator.publish(androidFix(now, -37.82), target)).status).toBe('queued-locally');
    now += 35_000;
    blockAirtime();
    expect((await coordinator.publish(androidFix(now, -37.84), target)).status).toBe('suppressed');
    expect(submitted).toHaveLength(2);
  });

  it('fails closed on simulated provider, inaccurate/future/stale GPS and missing keys', async () => {
    let now = NOW;
    const source = authority(roster(2));
    const {coordinator, submitted} = outboundHarness(source, () => now);
    expect((await coordinator.publish({
      providerId: 'simulated', fix: androidFix(now).fix,
    } as never, target)).status).toBe('suppressed');
    expect((await coordinator.publish({
      providerId: 'android-gps', fix: {...androidFix(now).fix, accuracyMeters: 150},
    }, target)).status).toBe('suppressed');
    expect((await coordinator.publish({
      providerId: 'android-gps', fix: {...androidFix(now).fix, timestampMs: now + 7_000},
    }, target)).status).toBe('suppressed');
    expect((await coordinator.publish({
      providerId: 'android-gps', fix: {...androidFix(now).fix, timestampMs: now - 40_000},
    }, target)).status).toBe('suppressed');
    expect(submitted).toHaveLength(0);
    expect((await coordinator.publish(androidFix(now), target)).status).toBe('queued-locally');
    now += 35_000;
    expect((await coordinator.publish({providerId: 'android-gps', fix: null}, target)).status)
      .toBe('queued-locally');
    const packet = decodeBushMeshTypedPacket(submitted[1].wire);
    expect(packet.kind).toBe('convoy');
    if (packet.kind !== 'convoy') throw new Error('expected convoy packet');
    expect(packet.value.locationUnavailable).toBe(true);
    expect(packet.value.location).toBeUndefined();
    now += 35_000;
    expect((await coordinator.publish({providerId: 'android-gps', fix: null}, target)).status)
      .toBe('suppressed');
    expect((await coordinator.publish(androidFix(now, -37.83), target)).status)
      .toBe('queued-locally');
    source.set(null);
    now += 35_000;
    expect((await coordinator.publish(androidFix(now), target)).status).toBe('suppressed');
  });

  it('restarts with no trusted position without a protected durable checkpoint', async () => {
    const source = authority(roster(2));
    const first = new VerifiedConvoyTelemetry({authority: source.authority, clock: () => NOW});
    expect(await first.ingest(protectedAccepted(roster(2), 1))).toBe(true);
    first.dispose();
    const second = new VerifiedConvoyTelemetry({authority: source.authority, clock: () => NOW});
    expect((await second.project())?.mapMembers[0].position).toBeNull();
    expect(await second.restore()).toBe(false);
  });

  it('restores only from a protected checkpoint reverified against exact roster and epoch', async () => {
    let saved: unknown = null;
    const checkpoint: ProtectedTelemetryCheckpointStore = {
      load: async () => saved,
      save: async value => {saved = JSON.parse(JSON.stringify(value));},
      clear: async () => {saved = null;},
      isDurableAndProtected: () => true,
    };
    const active = roster(2);
    const source = authority(active);
    const first = new VerifiedConvoyTelemetry({
      authority: source.authority, clock: () => NOW, checkpoint,
    });
    expect(await first.ingest(protectedAccepted(active, 1))).toBe(true);
    // Do not call dispose: it deliberately purges secret position cache.
    const second = new VerifiedConvoyTelemetry({
      authority: source.authority, clock: () => NOW, checkpoint,
    });
    expect(await second.restore()).toBe(true);
    expect((await second.project())?.mapMembers[0].position).not.toBeNull();
    const changed = roster(2);
    changed.currentEpoch = 3;
    changed.revision = 'epoch-3';
    source.set(changed, false);
    const third = new VerifiedConvoyTelemetry({
      authority: source.authority, clock: () => NOW, checkpoint,
    });
    expect(await third.restore()).toBe(false);
    expect((await third.project())?.mapMembers[0].position).toBeNull();
  });
});
