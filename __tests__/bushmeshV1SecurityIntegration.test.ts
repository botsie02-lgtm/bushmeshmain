import {
  BushMeshDatagramRuntime,
  BushMeshPacketType,
  BushMeshPriority,
} from '../src/bushmesh';
import {
  encodeBushMeshConvoyWire,
  encodeBushMeshWire,
  fragmentBushMeshDatagramPayload,
} from '../src/bushmesh/protocol/public';
import {BUSHMESH_MESHCORE_DEV_DATA_TYPE} from '../src/bushmesh/protocol';
import {BushMeshSecurityV1Adapter} from '../src/integration/BushMeshSecurityV1Adapter';
import {
  DirectSessionManager,
  GroupKeyManager,
} from '../src/security';
import {createSecurityNode, mutuallyTrust} from './securityTestHelpers';

function messageWire(messageId: number): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Message,
    priority: BushMeshPriority.DirectMessage,
    messageId,
    ackRequested: true,
    payload: [0x73, 0x65, 0x63, 0x75, 0x72, 0x65],
  });
}

function inbound(payload: number[] | Uint8Array, receivedAtMs = 1000) {
  return {
    channelIndex: 1,
    dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
    payload: Uint8Array.from(payload),
    receivedAtMs,
    transport: 'meshcore',
    source: 'live' as const,
  };
}

async function establishDirect() {
  const a = createSecurityNode();
  const b = createSecurityNode();
  const {aIdentity, bIdentity} = await mutuallyTrust(a, b);
  const aSessions = new DirectSessionManager(
    a.crypto,
    a.secrets,
    a.metadata,
    a.identity,
    a.trust,
    a.versions,
    a.clock,
  );
  const bSessions = new DirectSessionManager(
    b.crypto,
    b.secrets,
    b.metadata,
    b.identity,
    b.trust,
    b.versions,
    b.clock,
  );
  const offer = await aSessions.createOffer(bIdentity.deviceId);
  const accepted = await bSessions.acceptOffer(offer);
  const aSession = await aSessions.finalizeOffer(accepted.response);
  const aGroups = new GroupKeyManager(
    a.crypto,
    a.secrets,
    a.metadata,
    a.identity,
    a.trust,
    a.versions,
    a.clock,
  );
  const bGroups = new GroupKeyManager(
    b.crypto,
    b.secrets,
    b.metadata,
    b.identity,
    b.trust,
    b.versions,
    b.clock,
  );

  return {
    a,
    b,
    aIdentity,
    bIdentity,
    aSessions,
    bSessions,
    aSession,
    bSession: accepted.session,
    aGroups,
    bGroups,
  };
}

async function establishGroup() {
  const direct = await establishDirect();
  const group = await direct.aGroups.createGroup('bmg1_convoy-alpha', [
    {deviceId: direct.aIdentity.deviceId, role: 'leader'},
    {deviceId: direct.bIdentity.deviceId, role: 'member'},
  ]);
  const distributionContext = {
    protocolVersion: 1,
    authenticatedHeader: Uint8Array.from([0x67, 0x72, 0x6f, 0x75, 0x70]),
  };
  const wrapped = await direct.aGroups.wrapActiveKeyForPeer(
    group.groupId,
    direct.bIdentity.deviceId,
    direct.aSession.sessionId,
    direct.aSessions,
    distributionContext,
  );
  await direct.bGroups.installWrappedGroupKey(
    wrapped,
    direct.bSessions,
    distributionContext,
  );
  return {...direct, group};
}

describe('BushMesh Protocol v1 + Security v1 integration', () => {
  test('protected direct traffic round-trips through the canonical runtime and rejects replay', async () => {
    const setup = await establishDirect();
    const sender = new BushMeshDatagramRuntime({
      security: new BushMeshSecurityV1Adapter(
        setup.aSessions,
        setup.aGroups,
      ),
    });
    const receiver = new BushMeshDatagramRuntime({
      security: new BushMeshSecurityV1Adapter(
        setup.bSessions,
        setup.bGroups,
      ),
    });
    const prepared = await sender.prepareOutbound(messageWire(100), {
      channelIndex: 1,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: 'meshcore',
      trafficClass: 'direct-message',
      identityAssociation: {
        kind: 'direct-session',
        sessionId: setup.aSession.sessionId,
        peerDeviceId: setup.bIdentity.deviceId,
      },
      securityRouting: {sourceNodeId: 1, destinationNodeId: 2},
    });

    const first = await receiver.acceptInbound(inbound(prepared.payload));
    expect(first).toMatchObject({
      status: 'accepted',
      kind: 'protocol',
      protected: true,
      securityMode: 'protected-direct',
    });
    expect(await receiver.acceptInbound(inbound(prepared.payload, 1001))).toMatchObject({
      status: 'rejected',
      reason: 'security-failed',
    });
  });

  test('tampered canonical routing/AAD is rejected after Security v1 unprotection', async () => {
    const setup = await establishDirect();
    const sender = new BushMeshDatagramRuntime({
      security: new BushMeshSecurityV1Adapter(setup.aSessions, setup.aGroups),
    });
    const receiver = new BushMeshDatagramRuntime({
      security: new BushMeshSecurityV1Adapter(setup.bSessions, setup.bGroups),
    });
    const prepared = await sender.prepareOutbound(messageWire(101), {
      channelIndex: 1,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: 'meshcore',
      trafficClass: 'direct-message',
      identityAssociation: {
        kind: 'direct-session',
        sessionId: setup.aSession.sessionId,
      },
      securityRouting: {sourceNodeId: 1, destinationNodeId: 2},
    });
    const tampered = Array.from(prepared.payload);
    tampered[5] = 3;

    expect(await receiver.acceptInbound(inbound(tampered))).toMatchObject({
      status: 'rejected',
      reason: 'security-failed',
    });
  });

  test('revoked peers cannot deliver protected direct traffic through the adapter', async () => {
    const setup = await establishDirect();
    const sender = new BushMeshDatagramRuntime({
      security: new BushMeshSecurityV1Adapter(setup.aSessions, setup.aGroups),
    });
    const receiver = new BushMeshDatagramRuntime({
      security: new BushMeshSecurityV1Adapter(setup.bSessions, setup.bGroups),
    });
    const prepared = await sender.prepareOutbound(messageWire(102), {
      channelIndex: 1,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: 'meshcore',
      trafficClass: 'direct-message',
      identityAssociation: {
        kind: 'direct-session',
        sessionId: setup.aSession.sessionId,
      },
      securityRouting: {sourceNodeId: 1, destinationNodeId: 2},
    });
    await setup.b.trust.revoke(setup.aIdentity.deviceId, 'integration revocation');
    await setup.bSessions.revokeSessionsForPeer(setup.aIdentity.deviceId);

    expect(await receiver.acceptInbound(inbound(prepared.payload))).toMatchObject({
      status: 'rejected',
      reason: 'security-failed',
    });
  });

  test('protected group/convoy traffic round-trips using frozen GroupKeyManager semantics', async () => {
    const setup = await establishGroup();
    const sender = new BushMeshDatagramRuntime({
      security: new BushMeshSecurityV1Adapter(setup.aSessions, setup.aGroups),
    });
    const receiver = new BushMeshDatagramRuntime({
      security: new BushMeshSecurityV1Adapter(setup.bSessions, setup.bGroups),
    });
    const convoyWire = encodeBushMeshConvoyWire(
      {
        convoyId: 7,
        nodeId: 1,
        sequence: 1,
        orderIndex: 0,
        role: 0,
        speedKph: 42,
      },
      103,
    );
    const prepared = await sender.prepareOutbound(convoyWire, {
      channelIndex: 1,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: 'meshcore',
      identityAssociation: {kind: 'group', groupId: setup.group.groupId},
      securityRouting: {sourceNodeId: 1, groupId: setup.group.groupId},
    });

    const result = await receiver.acceptInbound(inbound(prepared.payload));
    expect(result).toMatchObject({
      status: 'accepted',
      kind: 'protocol',
      protected: true,
      securityMode: 'protected-group',
    });
    if (result.status === 'accepted' && result.kind === 'protocol') {
      expect(result.typed.kind).toBe('convoy');
    }
  });

  test('fragment reassembly completes before Security v1 unprotection', async () => {
    const setup = await establishDirect();
    const sender = new BushMeshDatagramRuntime({
      security: new BushMeshSecurityV1Adapter(setup.aSessions, setup.aGroups),
    });
    const receiver = new BushMeshDatagramRuntime({
      security: new BushMeshSecurityV1Adapter(setup.bSessions, setup.bGroups),
    });
    const prepared = await sender.prepareOutbound(messageWire(104), {
      channelIndex: 1,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: 'meshcore',
      trafficClass: 'direct-message',
      identityAssociation: {
        kind: 'direct-session',
        sessionId: setup.aSession.sessionId,
      },
      securityRouting: {sourceNodeId: 1, destinationNodeId: 2},
    });
    const fragments = fragmentBushMeshDatagramPayload(
      Array.from(prepared.payload),
      900,
      24,
    );
    expect(fragments.length).toBeGreaterThan(1);

    for (let index = 0; index < fragments.length - 1; index += 1) {
      expect(
        await receiver.acceptInbound(inbound(fragments[index], 1100 + index)),
      ).toMatchObject({status: 'fragment-pending'});
    }
    expect(
      await receiver.acceptInbound(
        inbound(fragments[fragments.length - 1], 1200),
      ),
    ).toMatchObject({
      status: 'accepted',
      kind: 'protocol',
      protected: true,
      securityMode: 'protected-direct',
    });
  });
});
