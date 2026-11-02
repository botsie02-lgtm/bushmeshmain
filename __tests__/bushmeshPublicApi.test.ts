import {
  BushMeshDatagramRuntime,
  BushMeshPacketType,
  BushMeshPriority,
  BushMeshProtocol,
  BushMeshRuntime,
} from '../src/bushmesh';

describe('BushMesh canonical public API', () => {
  it('exposes a small app-facing datagram runtime plus explicit protocol/runtime namespaces', () => {
    expect(typeof BushMeshDatagramRuntime).toBe('function');
    expect(BushMeshPacketType.Convoy).toBe(0x0f);
    expect(BushMeshPriority.Emergency).toBe(0);

    const wire = BushMeshProtocol.encodeBushMeshWire({
      type: BushMeshPacketType.Message,
      messageId: 1,
      priority: BushMeshPriority.DirectMessage,
      payload: [0x68, 0x69],
    });
    expect(wire.slice(0, 2)).toEqual([0xb5, 0x4d]);
    expect(
      BushMeshProtocol.getBushMeshPacketDefinition(BushMeshPacketType.Convoy)?.name,
    ).toBe('convoy');
    expect(typeof BushMeshRuntime.BushMeshDatagramRuntime).toBe('function');
  });

  it('does not leak compatibility runtimes or MeshCore carrier helpers through stable facades', () => {
    const protocol = BushMeshProtocol as Record<string, unknown>;
    const runtime = BushMeshRuntime as Record<string, unknown>;

    expect(protocol.prepareBushMeshWireFrames).toBeUndefined();
    expect(protocol.BushMeshCarrierMode).toBeUndefined();
    expect(runtime.BushMeshNetworkRuntime).toBeUndefined();
    expect(runtime.BushMeshRuntimeHub).toBeUndefined();
    expect(runtime.BushMeshNativeVoice).toBeUndefined();
  });
});
