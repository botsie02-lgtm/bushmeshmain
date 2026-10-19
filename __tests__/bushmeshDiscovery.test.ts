import {
  BUSHMESH_DEFAULT_CAPABILITIES,
  BushMeshCapability,
  BushMeshNeighborTable,
  BushMeshNodeRole,
  decodeNodeHello,
  decodePing,
  encodeNodeHello,
  encodePing,
  hasBushMeshCapability,
  negotiateBushMeshCapabilities,
} from '../src/bushmesh/protocol';

describe('Bushmesh discovery and link metrics', () => {
  test('round-trips compact node hello and capability mask', () => {
    const encoded = encodeNodeHello({
      nodeId: 42,
      capabilities:
        BUSHMESH_DEFAULT_CAPABILITIES | BushMeshCapability.BinaryTransport,
      role: BushMeshNodeRole.Handheld,
      protocolMinVersion: 1,
      protocolMaxVersion: 1,
      batteryPercent: 87,
    });
    const decoded = decodeNodeHello(encoded);

    expect(decoded.nodeId).toBe(42);
    expect(decoded.batteryPercent).toBe(87);
    expect(
      hasBushMeshCapability(
        decoded.capabilities,
        BushMeshCapability.BinaryTransport,
      ),
    ).toBe(true);
  });

  test('negotiates only capabilities both nodes advertise', () => {
    const local =
      BushMeshCapability.Fragmentation |
      BushMeshCapability.SelectiveAck |
      BushMeshCapability.BinaryTransport;
    const remote =
      BushMeshCapability.Fragmentation | BushMeshCapability.SelectiveAck;
    const common = negotiateBushMeshCapabilities(local, remote);

    expect(hasBushMeshCapability(common, BushMeshCapability.Fragmentation)).toBe(
      true,
    );
    expect(hasBushMeshCapability(common, BushMeshCapability.SelectiveAck)).toBe(
      true,
    );
    expect(
      hasBushMeshCapability(common, BushMeshCapability.BinaryTransport),
    ).toBe(false);
  });

  test('round-trips ping nonce and optional sender time', () => {
    expect(decodePing(encodePing({nonce: 12345}))).toEqual({nonce: 12345});
    expect(
      decodePing(encodePing({nonce: 12346, senderTimeSeconds: 100000})),
    ).toEqual({nonce: 12346, senderTimeSeconds: 100000});
  });

  test('smooths repeated observations and ranks healthier links higher', () => {
    const table = new BushMeshNeighborTable(0.5, 60000);

    table.observe({
      nodeId: 1,
      rssi: -70,
      snr: 8,
      hopCount: 1,
      batteryPercent: 90,
      seenAt: 1000,
    });
    table.observe({
      nodeId: 1,
      rssi: -74,
      snr: 6,
      hopCount: 1,
      seenAt: 2000,
    });
    table.observe({
      nodeId: 2,
      rssi: -115,
      snr: -12,
      hopCount: 2,
      batteryPercent: 20,
      seenAt: 2000,
    });

    const node1 = table.get(1);
    expect(node1?.smoothedRssi).toBe(-72);
    expect(node1?.smoothedSnr).toBe(7);
    expect(table.best(2500)?.nodeId).toBe(1);
  });

  test('prunes stale neighbors', () => {
    const table = new BushMeshNeighborTable(0.35, 1000);
    table.observe({nodeId: 9, rssi: -80, snr: 3, seenAt: 1000});

    expect(table.prune(1999)).toEqual([]);
    expect(table.prune(2000)).toEqual([9]);
    expect(table.size()).toBe(0);
  });
});
