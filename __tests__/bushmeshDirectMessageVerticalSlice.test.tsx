import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  decodeBushMeshSecurityContainer,
  encodeBushMeshProtectedDirectContainer,
  fragmentBushMeshDatagramPayload,
} from '../src/bushmesh/protocol/public';
import {BushMeshDatagramRuntime} from '../src/bushmesh/runtime/public';
import {BUSHMESH_MESHCORE_DEV_DATA_TYPE} from '../src/bushmesh/legacyProtocol';
import {
  BushMeshSecurityV1Adapter,
} from '../src/integration/BushMeshSecurityV1Adapter';
import {
  BushMeshV1RuntimeService,
} from '../src/integration/BushMeshV1RuntimeService';
import {BushMeshRadioSession} from '../src/radio/BushMeshRadioSession';
import {
  publishReceivedDatagram,
  type ReceivedDatagram,
} from '../src/radio/ReceivedDatagram';
import {
  DirectSessionManager,
  GroupKeyManager,
} from '../src/security';
import {BushMeshV1RuntimeProvider} from '../src/state/BushMeshV1RuntimeContext';
import {createSecurityNode, mutuallyTrust} from './securityTestHelpers';

const CHANNEL = 1;
const TRANSPORT = 'meshcore';

function received(
  payload: Uint8Array | number[],
  receivedAtMs = Date.now(),
): ReceivedDatagram {
  return {
    channelIndex: CHANNEL,
    dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
    payload: Uint8Array.from(payload),
    receivedAtMs,
    transport: TRANSPORT,
    source: 'live',
    link: {rssiDbm: -88, snrDb: 8, pathLength: 1},
    radioIdentityRef: 'loopback-radio',
    transportDeviceId: 'loopback-device',
    diagnosticLabel: 'direct-message-vertical-slice',
  };
}

async function establishDirectSecurity() {
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
    aGroups,
    bGroups,
    aSession,
    bSession: accepted.session,
  };
}

function createProtectedServices(
  setup: Awaited<ReturnType<typeof establishDirectSecurity>>,
) {
  const senderRadio = new BushMeshRadioSession();
  const receiverRadio = new BushMeshRadioSession();
  const senderRuntime = new BushMeshDatagramRuntime({
    security: new BushMeshSecurityV1Adapter(setup.aSessions, setup.aGroups),
  });
  const receiverRuntime = new BushMeshDatagramRuntime({
    security: new BushMeshSecurityV1Adapter(setup.bSessions, setup.bGroups),
  });
  return {
    senderRadio,
    receiverRadio,
    senderRuntime,
    receiverRuntime,
    senderService: new BushMeshV1RuntimeService({
      runtime: senderRuntime,
      radioSession: senderRadio,
    }),
    receiverService: new BushMeshV1RuntimeService({
      runtime: receiverRuntime,
      radioSession: receiverRadio,
    }),
  };
}

function protection(
  setup: Awaited<ReturnType<typeof establishDirectSecurity>>,
) {
  return {
    sessionId: setup.aSession.sessionId,
    peerDeviceId: setup.bIdentity.deviceId,
    sourceNodeId: 0x1001,
    destinationNodeId: 0x1002,
  };
}

describe('canonical direct/message end-to-end vertical slice', () => {
  test('ordinary message intent round-trips through radio-core to an application event', async () => {
    const senderRadio = new BushMeshRadioSession();
    const receiverService = new BushMeshV1RuntimeService({
      runtime: new BushMeshDatagramRuntime(),
      radioSession: new BushMeshRadioSession(),
    });
    const senderService = new BushMeshV1RuntimeService({
      runtime: new BushMeshDatagramRuntime(),
      radioSession: senderRadio,
    });
    await receiverService.start();

    senderRadio.setTransport(async (channelIndex, dataType, payload) => {
      publishReceivedDatagram({
        ...received(payload),
        channelIndex,
        dataType,
      });
    });
    senderRadio.setIdentity('loopback-radio');

    const eventPromise = new Promise(resolve => {
      const unsubscribe = receiverService.subscribeDirectMessageEvents(event => {
        unsubscribe();
        resolve(event);
      });
    });
    const entry = await senderService.sendDirectMessage({
      text: 'canonical hello',
      messageId: 5001,
      channelIndex: CHANNEL,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: TRANSPORT,
    });

    await expect(senderRadio.drainOnce(entry.createdAtMs + 1)).resolves.toMatchObject({
      outcome: 'accepted',
    });
    await expect(eventPromise).resolves.toMatchObject({
      kind: 'direct-message',
      text: 'canonical hello',
      messageId: 5001,
      protected: false,
    });
    await receiverService.dispose();
  });

  test('protected direct message round-trips through frozen Security v1 managers', async () => {
    const setup = await establishDirectSecurity();
    const services = createProtectedServices(setup);
    await services.receiverService.start();
    services.senderRadio.setTransport(async (channelIndex, dataType, payload) => {
      publishReceivedDatagram({...received(payload), channelIndex, dataType});
    });
    services.senderRadio.setIdentity('loopback-radio');

    const eventPromise = new Promise(resolve => {
      const unsubscribe = services.receiverService.subscribeDirectMessageEvents(event => {
        unsubscribe();
        resolve(event);
      });
    });
    const entry = await services.senderService.sendDirectMessage({
      text: 'protected canonical hello',
      messageId: 5002,
      channelIndex: CHANNEL,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: TRANSPORT,
      protection: protection(setup),
    });

    await expect(
      services.senderRadio.drainOnce(entry.createdAtMs + 1),
    ).resolves.toMatchObject({outcome: 'accepted'});
    await expect(eventPromise).resolves.toMatchObject({
      text: 'protected canonical hello',
      messageId: 5002,
      protected: true,
      sourceNodeId: 0x1001,
      destinationNodeId: 0x1002,
      securityAssociation: {
        kind: 'direct-session',
        sessionId: setup.bSession.sessionId,
      },
    });
    await services.receiverService.dispose();
  });

  test('tampered authenticated routing is rejected without an application delivery', async () => {
    const setup = await establishDirectSecurity();
    const services = createProtectedServices(setup);
    let deliveries = 0;
    services.receiverService.subscribeDirectMessageEvents(() => {
      deliveries += 1;
    });
    const entry = await services.senderService.sendDirectMessage({
      text: 'aad protected',
      messageId: 5003,
      channelIndex: CHANNEL,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: TRANSPORT,
      protection: protection(setup),
    });
    const container = decodeBushMeshSecurityContainer(entry.payload);
    if (container.kind !== 'protected-direct') {
      throw new Error('Expected protected-direct test container.');
    }
    const tampered = encodeBushMeshProtectedDirectContainer({
      routing: {
        sourceNodeId: container.routing.sourceNodeId,
        destinationNodeId: (container.routing.destinationNodeId ?? 0) + 1,
      },
      authenticatedHeader: container.authenticatedHeader,
      message: container.protectedPayload.message,
    });

    await expect(
      services.receiverService.acceptInbound(received(tampered)),
    ).resolves.toMatchObject({status: 'rejected', reason: 'security-failed'});
    expect(deliveries).toBe(0);
  });

  test('Security v1 replay rejection maps to a stable integration outcome', async () => {
    const setup = await establishDirectSecurity();
    const services = createProtectedServices(setup);
    const entry = await services.senderService.sendDirectMessage({
      text: 'one time',
      messageId: 5004,
      channelIndex: CHANNEL,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: TRANSPORT,
      protection: protection(setup),
    });

    await expect(
      services.receiverService.acceptInbound(received(entry.payload, 2000)),
    ).resolves.toMatchObject({status: 'accepted', protected: true});
    await expect(
      services.receiverService.acceptInbound(received(entry.payload, 2001)),
    ).resolves.toMatchObject({status: 'rejected', reason: 'security-failed'});
    expect(services.receiverService.getSnapshot().lastSecurityFailure).toBe(
      'replay-detected',
    );
  });

  test('revoked direct session rejects delivery and reports peer-revoked', async () => {
    const setup = await establishDirectSecurity();
    const services = createProtectedServices(setup);
    const entry = await services.senderService.sendDirectMessage({
      text: 'revoked traffic',
      messageId: 5005,
      channelIndex: CHANNEL,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: TRANSPORT,
      protection: protection(setup),
    });
    await setup.bSessions.retireSession(setup.bSession.sessionId, 'revoked');

    await expect(
      services.receiverService.acceptInbound(received(entry.payload)),
    ).resolves.toMatchObject({status: 'rejected', reason: 'security-failed'});
    expect(services.receiverService.getSnapshot().lastSecurityFailure).toBe(
      'peer-revoked',
    );
  });

  test('outbound queue preserves canonical bytes, priority, carrier and opaque metadata', async () => {
    const radio = new BushMeshRadioSession();
    const runtime = new BushMeshDatagramRuntime();
    const service = new BushMeshV1RuntimeService({runtime, radioSession: radio});
    const entry = await service.sendDirectMessage({
      text: 'mapping',
      messageId: 5006,
      channelIndex: 2,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: TRANSPORT,
      label: 'mapping-test',
    });

    expect(entry.priority).toBe('message');
    expect(entry.transport).toBe(TRANSPORT);
    expect(entry.description).toBe('mapping-test');
    expect(entry.opaqueMetadata).toBeDefined();
    expect(JSON.parse(entry.opaqueMetadata!['bushmesh.identityAssociation'])).toEqual({
      kind: 'none',
    });
    expect(JSON.parse(entry.opaqueMetadata!['bushmesh.diagnostics'])).toMatchObject({
      wireKind: 'protocol',
      protected: false,
      securityMode: 'plain',
      label: 'mapping-test',
    });
    expect(Array.from(entry.payload).slice(0, 2)).toEqual([0xb5, 0x4d]);
  });

  test('protocol-managed reliability remains one radio-core carrier attempt', async () => {
    const radio = new BushMeshRadioSession();
    const service = new BushMeshV1RuntimeService({
      runtime: new BushMeshDatagramRuntime(),
      radioSession: radio,
    });
    const entry = await service.sendDirectMessage({
      text: 'single carrier attempt',
      messageId: 5007,
      channelIndex: CHANNEL,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: TRANSPORT,
    });

    expect(entry.maxAttempts).toBe(1);
    expect(JSON.parse(entry.opaqueMetadata!['bushmesh.retryIntent'])).toEqual({
      mode: 'protocol-managed',
      maxTransportAttempts: 1,
    });
  });

  test('fragment-pending is diagnostic only and delivers one application event after reassembly', async () => {
    const radio = new BushMeshRadioSession();
    const service = new BushMeshV1RuntimeService({
      runtime: new BushMeshDatagramRuntime(),
      radioSession: radio,
    });
    const entry = await service.sendDirectMessage({
      text: 'fragment me '.repeat(20),
      messageId: 5008,
      channelIndex: CHANNEL,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: TRANSPORT,
    });
    const fragments = fragmentBushMeshDatagramPayload(
      Array.from(entry.payload),
      0x5008,
      20,
    );
    expect(fragments.length).toBeGreaterThan(1);
    const events: unknown[] = [];
    service.subscribeDirectMessageEvents(event => events.push(event));

    for (let index = 0; index < fragments.length - 1; index += 1) {
      await expect(
        service.acceptInbound(received(fragments[index], 3000 + index)),
      ).resolves.toMatchObject({status: 'fragment-pending'});
      expect(events).toHaveLength(0);
    }
    await expect(
      service.acceptInbound(received(fragments[fragments.length - 1], 4000)),
    ).resolves.toMatchObject({status: 'accepted', kind: 'protocol'});
    expect(events).toHaveLength(1);
  });

  test('radio disconnect/reconnect does not destroy canonical Security/runtime state', async () => {
    const setup = await establishDirectSecurity();
    const services = createProtectedServices(setup);
    services.receiverRadio.setTransport(async () => undefined);
    services.receiverRadio.setIdentity('radio-before');
    await services.receiverService.start();
    const entry = await services.senderService.sendDirectMessage({
      text: 'state survives carrier changes',
      messageId: 5009,
      channelIndex: CHANNEL,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: TRANSPORT,
      protection: protection(setup),
    });

    await expect(
      services.receiverService.acceptInbound(received(entry.payload, 5000)),
    ).resolves.toMatchObject({status: 'accepted'});
    services.receiverRadio.setTransport(null);
    services.receiverRadio.setTransport(async () => undefined);
    services.receiverRadio.setIdentity('radio-after');
    expect(services.receiverService.getSnapshot().state).toBe('ready');
    await expect(
      services.receiverService.acceptInbound(received(entry.payload, 5001)),
    ).resolves.toMatchObject({status: 'rejected', reason: 'security-failed'});
    expect(services.receiverService.getSnapshot().lastSecurityFailure).toBe(
      'replay-detected',
    );
    await services.receiverService.dispose();
  });

  test('provider teardown disposes the neutral inbound subscription exactly once', async () => {
    let subscriptions = 0;
    let unsubscriptions = 0;
    const service = new BushMeshV1RuntimeService({
      runtime: new BushMeshDatagramRuntime(),
      radioSession: new BushMeshRadioSession(),
      subscribeInbound: () => {
        subscriptions += 1;
        return () => {
          unsubscriptions += 1;
        };
      },
    });
    let renderer: ReactTestRenderer.ReactTestRenderer | null = null;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <BushMeshV1RuntimeProvider service={service}>
          <></>
        </BushMeshV1RuntimeProvider>,
      );
      await Promise.resolve();
    });
    expect(subscriptions).toBe(1);

    await ReactTestRenderer.act(async () => {
      renderer?.unmount();
      await Promise.resolve();
    });
    expect(unsubscriptions).toBe(1);
    await service.dispose();
    expect(unsubscriptions).toBe(1);
  });
});
