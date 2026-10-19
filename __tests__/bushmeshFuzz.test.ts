import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  encodeBushMeshWire,
  inspectBushMeshWireFrame,
} from '../src/bushmesh/protocol';

function createPrng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

describe('Bushmesh malformed frame handling', () => {
  test('frame inspector never throws for deterministic random radio garbage', () => {
    const random = createPrng(0x42555348);

    for (let sample = 0; sample < 500; sample += 1) {
      const length = random() % 700;
      const bytes = Array.from({length}, () => random() & 0xff);

      expect(() => inspectBushMeshWireFrame(bytes)).not.toThrow();
    }
  });

  test('truncated valid-looking frames fail closed instead of escaping errors', () => {
    const valid = encodeBushMeshWire({
      type: BushMeshPacketType.Message,
      compression: BushMeshCompressionProfile.Raw,
      messageId: 0x1ffff,
      storeAndForward: true,
      ttlHops: 3,
      payload: [1, 2, 3, 4, 5],
    });

    for (let length = 0; length < valid.length; length += 1) {
      const inspected = inspectBushMeshWireFrame(valid.slice(0, length));
      expect(typeof inspected.ok).toBe('boolean');
    }
  });

  test('corrupted varint headers are rejected safely', () => {
    const frame = [
      0xb5,
      0x4d,
      0x41,
      0x20,
      0x80,
      0x80,
      0x80,
      0x80,
      0x80,
      0x01,
    ];

    const inspected = inspectBushMeshWireFrame(frame);
    expect(inspected.ok).toBe(false);
  });
});
