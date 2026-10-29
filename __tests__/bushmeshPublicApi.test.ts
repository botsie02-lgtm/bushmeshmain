import {
  BushMeshPacketType,
  BushMeshPeerRegistry,
  BushMeshPriority,
  BushMeshTransportQueue,
  encodeBushMeshWire,
  getBushMeshPacketDefinition,
} from '../src/bushmesh';

describe('BushMesh canonical public API', () => {
  it('exposes protocol and transport-neutral runtime contracts from one facade', () => {
    expect(getBushMeshPacketDefinition(BushMeshPacketType.Convoy)?.name).toBe(
      'convoy',
    );

    const wire = encodeBushMeshWire({
      type: BushMeshPacketType.Message,
      messageId: 1,
      priority: BushMeshPriority.DirectMessage,
      payload: [0x68, 0x69],
    });
    expect(wire.slice(0, 2)).toEqual([0xb5, 0x4d]);

    expect(typeof BushMeshPeerRegistry).toBe('function');
    expect(typeof BushMeshTransportQueue).toBe('function');
  });
});
