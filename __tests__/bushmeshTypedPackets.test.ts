import {
  BUSHMESH_DEFAULT_CAPABILITIES,
  BushMeshDistressType,
  BushMeshNodeRole,
  BushMeshRoutingTable,
  LocationPrecision,
  decodeBushMeshTypedPacket,
  decodeRouteAdvertisement,
  encodeBushMeshDistressWire,
  encodeBushMeshNodeHelloWire,
  encodeBushMeshPingWire,
  encodeBushMeshRouteWire,
  encodeBushMeshTelemetryWire,
  learnRouteAdvertisement,
} from '../src/bushmesh/protocol';

describe('Bushmesh typed wire packets', () => {
  test('builds an emergency distress envelope with store-and-forward TTL', () => {
    const wire = encodeBushMeshDistressWire(
      {
        type: BushMeshDistressType.Lost,
        location: {
          latitude: -37.8,
          longitude: 145.3,
          precision: LocationPrecision.Approx10M,
        },
        batteryPercent: 31,
      },
      900,
    );
    const decoded = decodeBushMeshTypedPacket(wire);

    expect(decoded.kind).toBe('distress');
    expect(decoded.wire.envelope.priority).toBe(0);
    expect(decoded.wire.envelope.storeAndForward).toBe(true);
    expect(decoded.wire.envelope.ttlHops).toBe(6);
  });

  test('round-trips node hello, ping, and telemetry through complete wire envelopes', () => {
    const hello = decodeBushMeshTypedPacket(
      encodeBushMeshNodeHelloWire(
        {
          nodeId: 44,
          capabilities: BUSHMESH_DEFAULT_CAPABILITIES,
          role: BushMeshNodeRole.Vehicle,
          protocolMinVersion: 1,
          protocolMaxVersion: 1,
          batteryPercent: 81,
        },
        901,
      ),
    );
    expect(hello.kind).toBe('device-info');

    const ping = decodeBushMeshTypedPacket(
      encodeBushMeshPingWire({nonce: 1234, senderTimeSeconds: 5000}, 902),
    );
    expect(ping.kind).toBe('ping');

    const telemetry = decodeBushMeshTypedPacket(
      encodeBushMeshTelemetryWire({batteryPercent: 70, temperatureC: 21.5}, 903),
    );
    expect(telemetry.kind).toBe('telemetry');
  });

  test('route advertisement can be learned through the previous hop', () => {
    const wire = encodeBushMeshRouteWire(
      {
        destinationNodeId: 88,
        sequence: 12,
        hopCount: 1,
        pathQuality: 80,
      },
      904,
    );
    const decoded = decodeBushMeshTypedPacket(wire);
    expect(decoded.kind).toBe('route');

    const advertisement = decodeRouteAdvertisement(decoded.wire.envelope.payload);
    const table = new BushMeshRoutingTable();
    learnRouteAdvertisement(table, advertisement, 7, 90, {
      now: 1000,
      ttlMs: 10000,
    });

    const route = table.bestRoute(88, 1200);
    expect(route?.nextHopNodeId).toBe(7);
    expect(route?.hopCount).toBe(2);
    expect(route?.linkScore).toBeCloseTo(87);
  });
});
