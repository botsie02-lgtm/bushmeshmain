import {
  BushMeshDatagramRuntime,
  BushMeshRuntimeClock,
  BushMeshRuntimePersistence,
  BushMeshSecurityAdapter,
  BushMeshTransportAvailability,
  BushMeshTransportAvailabilityPort,
} from '../src/bushmesh/runtime/public';
import {
  BushMeshPacketType,
  BushMeshPriority,
  createBushMeshSecurityProtocolContext,
  encodeBushMeshWire,
} from '../src/bushmesh/protocol/public';

class MemoryStore implements BushMeshRuntimePersistence {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class FakeAvailability implements BushMeshTransportAvailabilityPort {
  value: BushMeshTransportAvailability = {
    transport: 'lora',
    available: false,
    reason: 'disconnected',
    maxPayloadBytes: 220,
  };

  getAvailability(): BushMeshTransportAvailability {
    return {...this.value};
  }
}

function fakeClock(initial = 1000): BushMeshRuntimeClock & {setNow(value: number): void} {
  let now = initial;
  return {
    now: () => now,
    setNow: value => {
      now = value;
    },
    setTimeout: () => ({kind: 'fake-timer'}),
    clearTimeout: () => undefined,
  };
}

function messageWire(messageId = 55, version = 1): number[] {
  return encodeBushMeshWire({
    version,
    type: BushMeshPacketType.Message,
    priority: BushMeshPriority.DirectMessage,
    messageId,
    ackRequested: true,
    payload: [0x68, 0x69],
  });
}

function inbound(payload: number[], options?: {sourceNodeId?: number; protected?: boolean}) {
  return {
    channelIndex: 2,
    dataType: 0x42,
    payload: Uint8Array.from(payload),
    receivedAtMs: 1000,
    transport: 'lora',
    source: 'live' as const,
    sourceNodeId: options?.sourceNodeId,
    securityProtected: options?.protected,
    link: {rssiDbm: -91, snrDb: 7.5, pathLength: 1},
  };
}

function fakeSecurity(options?: {failUnprotect?: boolean; corruptAad?: boolean}): BushMeshSecurityAdapter {
  return {
    async protect(request) {
      return {
        datagramPayload: Uint8Array.from([
          0xa5,
          ...Array.from(request.plaintextWireBytes),
        ]),
        protectedPayload: {
          kind: request.association.kind,
          contextVersion: request.context.protocolVersion,
        },
        securityVersion: 1,
      };
    },
    async unprotect(request) {
      if (options?.failUnprotect) {
        throw new Error('fake authentication failed');
      }
      if (request.datagramPayload[0] !== 0xa5) {
        throw new Error('fake protected payload marker missing');
      }
      const plaintextWireBytes = request.datagramPayload.slice(1);
      const context = createBushMeshSecurityProtocolContext(
        Array.from(plaintextWireBytes),
      );
      const authenticatedHeader = Uint8Array.from(context.authenticatedHeader);
      if (options?.corruptAad && authenticatedHeader.length > 0) {
        authenticatedHeader[authenticatedHeader.length - 1] ^= 0x01;
      }
      return {
        plaintextWireBytes,
        authenticatedHeader,
        protectedPayload: {kind: 'direct'},
        association: {
          kind: 'direct-session' as const,
          sessionId: 'session-1',
          peerDeviceId: 'peer-1',
        },
        securityVersion: 1,
      };
    },
  };
}

describe('BushMesh canonical datagram runtime', () => {
  it('rejects malformed and unsupported-version inbound datagrams without throwing', async () => {
    const runtime = new BushMeshDatagramRuntime();

    await expect(runtime.acceptInbound(inbound([0x01, 0x02]))).resolves.toMatchObject({
      status: 'rejected',
      reason: 'malformed',
    });

    await expect(runtime.acceptInbound(inbound(messageWire(1, 2)))).resolves.toMatchObject({
      status: 'rejected',
      reason: 'unsupported-version',
    });
  });

  it('suppresses duplicate delivery and restores dedup state after restart', async () => {
    const store = new MemoryStore();
    const clock = fakeClock(1000);
    const first = new BushMeshDatagramRuntime({clock, persistence: store});
    await first.initialize();

    const datagram = inbound(messageWire(77), {sourceNodeId: 0x1234});
    expect((await first.acceptInbound(datagram)).status).toBe('accepted');
    expect((await first.acceptInbound(datagram)).status).toBe('duplicate');
    await first.flush();

    clock.setNow(1100);
    const restarted = new BushMeshDatagramRuntime({clock, persistence: store});
    expect(await restarted.initialize()).toBe(1);
    const replayed = {...datagram, receivedAtMs: 1100};
    expect((await restarted.acceptInbound(replayed)).status).toBe('duplicate');
  });

  it('reports transport disconnect/reconnect without owning the radio send queue', async () => {
    const availability = new FakeAvailability();
    const runtime = new BushMeshDatagramRuntime({transportAvailability: availability});

    expect(runtime.transportAvailability()).toMatchObject({available: false});
    const disconnected = await runtime.prepareOutbound(messageWire(2), {
      channelIndex: 1,
      dataType: 0x42,
      transport: 'lora',
    });
    expect(disconnected.diagnostics.transportAvailable).toBe(false);

    availability.value = {
      transport: 'lora',
      available: true,
      maxPayloadBytes: 220,
    };
    expect(runtime.transportAvailability()).toMatchObject({available: true});
    const reconnected = await runtime.prepareOutbound(messageWire(3), {
      channelIndex: 1,
      dataType: 0x42,
      transport: 'lora',
    });
    expect(reconnected.diagnostics.transportAvailable).toBe(true);
  });

  it('uses a Security v1 adapter for direct traffic and validates canonical AAD on receive', async () => {
    const runtime = new BushMeshDatagramRuntime({security: fakeSecurity()});
    const prepared = await runtime.prepareOutbound(messageWire(9), {
      channelIndex: 4,
      dataType: 0x42,
      transport: 'lora',
      trafficClass: 'direct-message',
      identityAssociation: {
        kind: 'direct-session',
        sessionId: 'session-1',
        peerDeviceId: 'peer-1',
      },
    });

    expect(Array.from(prepared.payload).slice(0, 1)).toEqual([0xa5]);
    expect(prepared.diagnostics.protected).toBe(true);
    expect(prepared.retryIntent).toEqual({
      mode: 'protocol-managed',
      maxTransportAttempts: 1,
    });

    const result = await runtime.acceptInbound({
      ...inbound(Array.from(prepared.payload), {sourceNodeId: 9, protected: true}),
      receivedAtMs: 1200,
    });
    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.protected).toBe(true);
      expect(result.securityAssociation).toMatchObject({
        kind: 'direct-session',
        sessionId: 'session-1',
      });
      expect(result.decoded.envelope.messageId).toBe(9);
    }
  });

  it('fails closed when security verification fails or authenticates the wrong header', async () => {
    const failed = new BushMeshDatagramRuntime({
      security: fakeSecurity({failUnprotect: true}),
    });
    expect(
      await failed.acceptInbound(
        inbound([0xa5, ...messageWire(10)], {protected: true}),
      ),
    ).toMatchObject({status: 'rejected', reason: 'security-failed'});

    const wrongAad = new BushMeshDatagramRuntime({
      security: fakeSecurity({corruptAad: true}),
    });
    expect(
      await wrongAad.acceptInbound(
        inbound([0xa5, ...messageWire(11)], {protected: true}),
      ),
    ).toMatchObject({status: 'rejected', reason: 'security-failed'});
  });

  it('refuses direct or group protected traffic without the required association/adapter', async () => {
    const runtime = new BushMeshDatagramRuntime();

    await expect(
      runtime.prepareOutbound(messageWire(12), {
        channelIndex: 1,
        dataType: 0x42,
        transport: 'lora',
        trafficClass: 'direct-message',
      }),
    ).rejects.toThrow(/direct-session/);

    await expect(
      runtime.prepareOutbound(messageWire(13), {
        channelIndex: 1,
        dataType: 0x42,
        transport: 'lora',
        trafficClass: 'convoy-group',
        identityAssociation: {kind: 'group', groupId: 'convoy-1'},
      }),
    ).rejects.toThrow(/security adapter/i);
  });
});
