import {
  BUSHMESH_PACKET_DEFINITIONS,
  BushMeshPacketType,
  BushMeshPacketTypeClass,
  classifyBushMeshPacketType,
  decodeNodeHello,
  encodeNodeHello,
  negotiateBushMeshProtocolRanges,
  prepareBushMeshWireFrames,
  encodeBushMeshWire,
} from '../src/bushmesh/protocol/public';

describe('BushMesh canonical protocol registry', () => {
  it('allocates each canonical packet ID once', () => {
    const ids = BUSHMESH_PACKET_DEFINITIONS.map(definition => definition.type);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('treats convoy as core and weather as explicitly reserved', () => {
    expect(classifyBushMeshPacketType(BushMeshPacketType.Convoy)).toBe(
      BushMeshPacketTypeClass.Core,
    );
    expect(classifyBushMeshPacketType(BushMeshPacketType.Weather)).toBe(
      BushMeshPacketTypeClass.ReservedCore,
    );
  });

  it('keeps the v1 battery name as an alias of telemetry only', () => {
    expect(BushMeshPacketType.Battery).toBe(BushMeshPacketType.Telemetry);
    const telemetryDefinitions = BUSHMESH_PACKET_DEFINITIONS.filter(
      definition => definition.type === BushMeshPacketType.Telemetry,
    );
    expect(telemetryDefinitions).toHaveLength(1);
    expect(telemetryDefinitions[0].name).toBe('telemetry');
  });

  it('negotiates only versions representable by the envelope', () => {
    expect(negotiateBushMeshProtocolRanges(1, 1, 1, 1)).toMatchObject({
      compatible: true,
      negotiatedVersion: 1,
    });
    expect(() => negotiateBushMeshProtocolRanges(1, 1, 1, 4)).toThrow();
  });

  it('rejects discovery advertisements outside the two-bit version range', () => {
    expect(() =>
      encodeNodeHello({
        nodeId: 1,
        capabilities: 0,
        role: 0,
        protocolMinVersion: 1,
        protocolMaxVersion: 4,
      }),
    ).toThrow();

    expect(() => decodeNodeHello([0x14, 0x00, 0x01, 0x00])).toThrow();
  });

  it('prepares transport frames without any hardware-specific dependency', () => {
    const wire = encodeBushMeshWire({
      type: BushMeshPacketType.Message,
      messageId: 9,
      payload: Array.from({length: 80}, (_, index) => index & 0xff),
    });

    const frames = prepareBushMeshWireFrames(wire, 9, {
      carrier: 'text-safe',
      maxPayloadBytes: 60,
    });

    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every(frame => frame.payloadBytes.length <= 60)).toBe(true);
  });
});
