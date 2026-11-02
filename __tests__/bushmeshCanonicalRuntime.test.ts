import {Buffer} from 'buffer';

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

function distressWire(messageId = 88): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Distress,
    priority: BushMeshPriority.Emergency,
    messageId,
    ackRequested: true,
    storeAndForward: true,
    payload: [0x01],
  });
}

function inbound(payload: number[], options?: {sourceNodeId?: number}) {
  return {
    channelIndex: 2,
    dataType: 0x42,
    payload: Uint8Array.from(payload),
    receivedAtMs: 1000,
    transport: 'lora',
    source: 'live' as const,
    sourceNodeId: options?.sourceNodeId,
    link: {rssiDbm: -91, snrDb: 7.5, pathLength: 1},
  };
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(value: string): Uint8Array {
  const padding = (4 - (value.length % 4)) % 4;
  return Uint8Array.from(
    Buffer.from(
      value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding),
      'base64',
    ),
  );
}

function fakeSecurity(options?: {failUnprotect?: boolean}): BushMeshSecurityAdapter {
  return {
    async protect(request) {
      const ciphertext = toBase64Url(request.plaintextWireBytes);
      if (request.association.kind === 'direct-session') {
        return {
          protectedPayload: {
            kind: 'direct' as const,
            message: {
              securityVersion: 1,
              protocolVersion: request.context.protocolVersion,
              sessionId: request.association.sessionId,
              keyEpoch: 1,
              counter: '1',
              ciphertext,
            },
          },
          securityVersion: 1,
        };
      }
      if (request.association.kind === 'group') {
        return {
          protectedPayload: {
            kind: 'group' as const,
            message: {
              securityVersion: 1,
              protocolVersion: request.context.protocolVersion,
              groupId: request.association.groupId,
              epoch: 1,
              senderDeviceId: 'bm1_sender',
              counter: '1',
              ciphertext,
            },
          },
          securityVersion: 1,
        };
      }
      throw new Error('fake Security adapter only supports direct/group payloads');
    },
    async unprotect(request) {
      if (options?.failUnprotect) {
        throw new Error('fake authentication failed');
      }
      const plaintextWireBytes = fromBase64Url(
        request.protectedPayload.message.ciphertext,
      );
      if (request.protectedPayload.kind === 'direct') {
        return {
          plaintextWireBytes,
          association: {
            kind: 'direct-session' as const,
            sessionId: request.protectedPayload.message.sessionId,
            peerDeviceId: 'peer-1',
          },
          securityVersion: 1,
        };
      }
      return {
        plaintextWireBytes,
        association: {
          kind: 'group' as const,
          groupId: request.protectedPayload.message.groupId,
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

  it('serializes Security v1 direct objects itself and validates canonical routing AAD on receive', async () => {
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
      securityRouting: {sourceNodeId: 1, destinationNodeId: 2},
    });

    expect(Array.from(prepared.payload).slice(0, 4)).toEqual([
      0xb5,
      0x53,
      0x01,
      0x01,
    ]);
    expect(prepared.diagnostics.protected).toBe(true);
    expect(prepared.diagnostics.securityMode).toBe('protected-direct');
    expect(prepared.retryIntent).toEqual({
      mode: 'protocol-managed',
      maxTransportAttempts: 1,
    });

    const result = await runtime.acceptInbound({
      ...inbound(Array.from(prepared.payload)),
      receivedAtMs: 1200,
    });
    expect(result.status).toBe('accepted');
    if (result.status === 'accepted' && result.kind === 'protocol') {
      expect(result.protected).toBe(true);
      expect(result.securityAssociation).toMatchObject({
        kind: 'direct-session',
        sessionId: 'session-1',
      });
      expect(result.securityRouting).toEqual({
        sourceNodeId: 1,
        destinationNodeId: 2,
      });
      expect(result.decoded.envelope.messageId).toBe(9);
    }
  });

  it('fails closed when Security verification fails or outer routing metadata is tampered', async () => {
    const encoder = new BushMeshDatagramRuntime({security: fakeSecurity()});
    const prepared = await encoder.prepareOutbound(messageWire(10), {
      channelIndex: 1,
      dataType: 0x42,
      transport: 'lora',
      trafficClass: 'direct-message',
      identityAssociation: {kind: 'direct-session', sessionId: 'session-1'},
      securityRouting: {sourceNodeId: 1, destinationNodeId: 2},
    });

    const failed = new BushMeshDatagramRuntime({
      security: fakeSecurity({failUnprotect: true}),
    });
    expect(
      await failed.acceptInbound(inbound(Array.from(prepared.payload))),
    ).toMatchObject({status: 'rejected', reason: 'security-failed'});

    const tampered = Array.from(prepared.payload);
    // Header layout: B5 53 01 01, routing flags 03, source varuint, destination varuint.
    tampered[5] = 3;
    const verifier = new BushMeshDatagramRuntime({security: fakeSecurity()});
    expect(await verifier.acceptInbound(inbound(tampered))).toMatchObject({
      status: 'rejected',
      reason: 'security-failed',
    });
  });

  it('requires explicit emergency fallback and never silently downgrades failed protected traffic', async () => {
    const strict = new BushMeshDatagramRuntime();
    await expect(
      strict.prepareOutbound(distressWire(), {
        channelIndex: 1,
        dataType: 0x42,
        transport: 'lora',
      }),
    ).rejects.toThrow(/forbidden/i);
    expect(await strict.acceptInbound(inbound(distressWire()))).toMatchObject({
      status: 'rejected',
      reason: 'security-required',
    });

    const fallback = new BushMeshDatagramRuntime({
      emergencySecurityPolicy: 'allow-unauthenticated-fallback',
    });
    const prepared = await fallback.prepareOutbound(distressWire(89), {
      channelIndex: 1,
      dataType: 0x42,
      transport: 'lora',
    });
    expect(prepared.diagnostics.securityMode).toBe(
      'unauthenticated-emergency-fallback',
    );
    const accepted = await fallback.acceptInbound(
      inbound(Array.from(prepared.payload), {sourceNodeId: 5}),
    );
    expect(accepted).toMatchObject({
      status: 'accepted',
      kind: 'protocol',
      protected: false,
      securityMode: 'unauthenticated-emergency-fallback',
    });
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

    const convoyWire = encodeBushMeshWire({
      type: BushMeshPacketType.Convoy,
      priority: BushMeshPriority.Location,
      messageId: 13,
      payload: [0x01],
    });
    await expect(
      runtime.prepareOutbound(convoyWire, {
        channelIndex: 1,
        dataType: 0x42,
        transport: 'lora',
        identityAssociation: {kind: 'group', groupId: 'convoy-1'},
        securityRouting: {sourceNodeId: 1, groupId: 'convoy-1'},
      }),
    ).rejects.toThrow(/security adapter/i);
  });
});
