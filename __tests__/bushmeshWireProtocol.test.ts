import {
  BushMeshCompressionProfile,
  BushMeshFragmentReassembler,
  BushMeshPacketType,
  BushMeshPriority,
  LocationPrecision,
  SemanticDestination,
  SemanticIntent,
  decodeEnvelope,
  decodeFragmentAck,
  decodeLocationDelta,
  decodeLocationPayload,
  decodeSemanticMessage,
  decodeSignedVarInt,
  decodeVarUint,
  encodeEnvelope,
  encodeFragmentAck,
  encodeLocationDelta,
  encodeLocationPayload,
  encodeSemanticMessage,
  encodeSignedVarInt,
  encodeVarUint,
  fragmentPayload,
  renderSemanticMessage,
} from '../src/bushmesh/protocol';

describe('Bushmesh wire protocol', () => {
  test('encodes and decodes varints and ZigZag signed values', () => {
    expect(encodeVarUint(300)).toEqual([0xac, 0x02]);
    expect(decodeVarUint([0xac, 0x02]).value).toBe(300);

    for (const value of [-100000, -1, 0, 1, 100000]) {
      expect(decodeSignedVarInt(encodeSignedVarInt(value)).value).toBe(value);
    }
  });

  test('packs packet type, priority, compression and flags into a compact envelope', () => {
    const encoded = encodeEnvelope({
      type: BushMeshPacketType.Location,
      priority: BushMeshPriority.Emergency,
      compression: BushMeshCompressionProfile.Gps,
      messageId: 513,
      ackRequested: true,
      storeAndForward: true,
      ttlHops: 4,
      payload: [0x11, 0x22],
    });

    const decoded = decodeEnvelope(encoded);

    expect(decoded.version).toBe(1);
    expect(decoded.type).toBe(BushMeshPacketType.Location);
    expect(decoded.priority).toBe(BushMeshPriority.Emergency);
    expect(decoded.compression).toBe(BushMeshCompressionProfile.Gps);
    expect(decoded.messageId).toBe(513);
    expect(decoded.ackRequested).toBe(true);
    expect(decoded.storeAndForward).toBe(true);
    expect(decoded.ttlHops).toBe(4);
    expect(decoded.payload).toEqual([0x11, 0x22]);
  });

  test('encodes location in 7-8 bytes with adaptive precision and 7-bit battery', () => {
    const encoded = encodeLocationPayload({
      latitude: -37.784873,
      longitude: 145.30086,
      precision: LocationPrecision.Approx1M,
      batteryPercent: 87,
    });

    expect(encoded).toHaveLength(8);
    const decoded = decodeLocationPayload(encoded);

    expect(Math.abs(decoded.latitude - -37.784873)).toBeLessThan(0.00002);
    expect(Math.abs(decoded.longitude - 145.30086)).toBeLessThan(0.00003);
    expect(decoded.batteryPercent).toBe(87);
    expect(decoded.precision).toBe(LocationPrecision.Approx1M);
  });

  test('uses ZigZag varints for compact GPS deltas', () => {
    const encoded = encodeLocationDelta({northMetres: 14, eastMetres: -7});
    expect(encoded.length).toBeLessThanOrEqual(2);
    expect(decodeLocationDelta(encoded)).toEqual({
      northMetres: 14,
      eastMetres: -7,
    });
  });

  test('encodes semantic codewords and reconstructs a readable message', () => {
    const encoded = encodeSemanticMessage({
      intent: SemanticIntent.Returning,
      destination: SemanticDestination.Camp,
      etaMinutes: 20,
    });

    expect(encoded).toEqual([
      SemanticIntent.Returning,
      0x03,
      SemanticDestination.Camp,
      20,
    ]);

    const decoded = decodeSemanticMessage(encoded);
    expect(renderSemanticMessage(decoded)).toBe(
      'Returning to camp. ETA approximately 20 minutes.',
    );
  });

  test('reassembles out-of-order fragments and ignores duplicates', () => {
    const payload = Array.from({length: 103}, (_, index) => index & 0xff);
    const fragments = fragmentPayload(82, payload, 20);
    const reassembler = new BushMeshFragmentReassembler();

    expect(fragments).toHaveLength(6);

    reassembler.accept(fragments[2].bytes);
    reassembler.accept(fragments[0].bytes);
    reassembler.accept(fragments[2].bytes);
    reassembler.accept(fragments[5].bytes);
    reassembler.accept(fragments[1].bytes);
    reassembler.accept(fragments[4].bytes);

    expect(reassembler.getMissing(82)).toEqual([3]);

    const complete = reassembler.accept(fragments[3].bytes);
    expect(complete.complete).toBe(true);
    expect(complete.data).toEqual(payload);
    expect(reassembler.getMissing(82)).toBeNull();
  });

  test('uses ACK bitmaps to request only missing fragments', () => {
    const encoded = encodeFragmentAck(82, 7, [0, 1, 2, 4, 6]);
    const decoded = decodeFragmentAck(encoded);

    expect(decoded.messageId).toBe(82);
    expect(decoded.receivedFragments).toEqual([0, 1, 2, 4, 6]);
    expect(decoded.missingFragments).toEqual([3, 5]);
  });
});
