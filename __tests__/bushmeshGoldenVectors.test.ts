import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
  createBushMeshSecurityProtocolContext,
  encodeBushMeshNodeHelloWire,
  encodeBushMeshWire,
} from '../src/bushmesh/protocol/public';
import {
  encodeBushMeshDeliveryAckPacketWire,
  encodeBushMeshFragmentAckWire,
} from '../src/bushmesh/protocol/acknowledgement';
import {BushMeshCapability, BushMeshNodeRole} from '../src/bushmesh/protocol/discovery';

function hex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map(value => value.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

describe('BushMesh protocol-v1 golden vectors', () => {
  it('encodes a raw direct message envelope byte-for-byte', () => {
    const wire = encodeBushMeshWire({
      type: BushMeshPacketType.Message,
      priority: BushMeshPriority.DirectMessage,
      compression: BushMeshCompressionProfile.Raw,
      messageId: 42,
      ackRequested: true,
      payload: [0x4f, 0x4b],
    });

    expect(hex(wire)).toBe('B5 4D 41 22 2A 4F 4B');
  });

  it('encodes node discovery hello byte-for-byte', () => {
    const wire = encodeBushMeshNodeHelloWire(
      {
        nodeId: 0x1234,
        capabilities:
          BushMeshCapability.DictionaryText |
          BushMeshCapability.Fragmentation,
        role: BushMeshNodeRole.Vehicle,
        protocolMinVersion: 1,
        protocolMaxVersion: 1,
        batteryPercent: 88,
        dictionaryVersion: 1,
      },
      7,
    );

    expect(hex(wire)).toBe('B5 4D 46 80 07 11 85 B4 24 05 58 01');
  });

  it('encodes delivery and selective fragment ACK schemas deterministically', () => {
    expect(hex(encodeBushMeshDeliveryAckPacketWire(300, 9))).toBe(
      'B5 4D 4C 30 09 00 AC 02',
    );
    expect(hex(encodeBushMeshFragmentAckWire(300, 10, [0, 2, 9]))).toBe(
      'B5 4D 4C 20 AC 02 AC 02 0A 05 02',
    );
  });

  it('encodes immutable Security v1 AAD independently of mutable TTL and binds logical routing', () => {
    const base = {
      type: BushMeshPacketType.Message,
      priority: BushMeshPriority.DirectMessage,
      compression: BushMeshCompressionProfile.Raw,
      messageId: 42,
      ackRequested: true,
      storeAndForward: true,
      payload: [0x4f, 0x4b],
    };
    const ttlSix = encodeBushMeshWire({...base, ttlHops: 6});
    const ttlOne = encodeBushMeshWire({...base, ttlHops: 1});

    const contextSix = createBushMeshSecurityProtocolContext(ttlSix);
    const contextOne = createBushMeshSecurityProtocolContext(ttlOne);
    expect(hex(contextSix.authenticatedHeader)).toBe(
      '42 4D 41 01 41 23 2A 00',
    );
    expect(hex(contextOne.authenticatedHeader)).toBe(
      '42 4D 41 01 41 23 2A 00',
    );

    const routed = createBushMeshSecurityProtocolContext(ttlSix, {
      sourceNodeId: 1,
      destinationNodeId: 2,
    });
    expect(hex(routed.authenticatedHeader)).toBe(
      '42 4D 41 01 41 23 2A 03 01 02',
    );
  });
});
