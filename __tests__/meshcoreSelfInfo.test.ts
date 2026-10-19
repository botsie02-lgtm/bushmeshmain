import {
  meshCorePublicKeyToBushMeshIdentityRef,
  parseMeshCoreSelfInfo,
} from '../src/meshcore/meshcoreSelfInfo';

function writeInt32LE(bytes: number[], offset: number, value: number): void {
  const safe = value >>> 0;
  bytes[offset] = safe & 0xff;
  bytes[offset + 1] = (safe >>> 8) & 0xff;
  bytes[offset + 2] = (safe >>> 16) & 0xff;
  bytes[offset + 3] = (safe >>> 24) & 0xff;
}

function writeUInt32LE(bytes: number[], offset: number, value: number): void {
  writeInt32LE(bytes, offset, value);
}

describe('MeshCore SELF_INFO', () => {
  test('derives a 48-bit Bushmesh identity from the radio public key', () => {
    const key = 'A1B2C3D4E5F6'.padEnd(64, '0');
    expect(meshCorePublicKeyToBushMeshIdentityRef(key)).toBe('A1B2C3D4E5F6');
  });

  test('parses identity and radio metadata', () => {
    const bytes = new Array<number>(64).fill(0);
    bytes[0] = 0x05;
    bytes[1] = 2;
    bytes[2] = 20;
    bytes[3] = 22;

    for (let index = 0; index < 32; index += 1) {
      bytes[4 + index] = index + 1;
    }

    writeInt32LE(bytes, 36, Math.round(-37.8136 * 1_000_000));
    writeInt32LE(bytes, 40, Math.round(144.9631 * 1_000_000));
    writeUInt32LE(bytes, 48, 918_000);
    writeUInt32LE(bytes, 52, 125_000);
    bytes[56] = 10;
    bytes[57] = 5;
    'Bush Radio'.split('').forEach((character, index) => {
      bytes[58 + index] = character.charCodeAt(0);
    });

    const parsed = parseMeshCoreSelfInfo(bytes);
    expect(parsed?.bushMeshIdentityRef).toBe('010203040506');
    expect(parsed?.latitude).toBeCloseTo(-37.8136, 4);
    expect(parsed?.longitude).toBeCloseTo(144.9631, 4);
    expect(parsed?.frequencyMhz).toBe(918);
    expect(parsed?.bandwidthKhz).toBe(125);
    expect(parsed?.spreadingFactor).toBe(10);
    expect(parsed?.codingRate).toBe(5);
    expect(parsed?.deviceName).toBe('Bush Radio');
  });

  test('ignores unrelated packet types', () => {
    expect(parseMeshCoreSelfInfo([0x0d, 1, 2, 3])).toBeNull();
  });
});
