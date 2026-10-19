import {parseMeshCorePacketFields} from '../src/meshcore/meshcoreParsers';

describe('MeshCore contact info parser', () => {
  test('rejects records shorter than the documented 148 bytes', () => {
    const truncated = new Array<number>(147).fill(0);
    truncated[0] = 0x03;

    const parsed = parseMeshCorePacketFields(truncated);

    expect(parsed?.title).toBe('Parsed Contact');
    expect(parsed?.contactInfo).toBeUndefined();
    expect(parsed?.lines.join(' ')).toContain('shorter than expected');
  });

  test('accepts a complete 148-byte contact record', () => {
    const complete = new Array<number>(148).fill(0);
    complete[0] = 0x03;
    complete[1] = 0xaa;
    complete[2] = 0xbb;
    complete[3] = 0xcc;
    complete[4] = 0xdd;
    complete[5] = 0xee;
    complete[6] = 0xff;

    const name = Array.from(Buffer.from('Test Vehicle', 'utf8'));
    name.forEach((byte, index) => {
      complete[100 + index] = byte;
    });

    complete[144] = 0x78;
    complete[145] = 0x56;
    complete[146] = 0x34;
    complete[147] = 0x12;

    const parsed = parseMeshCorePacketFields(complete);

    expect(parsed?.contactInfo?.publicKeyPrefix).toBe('AABBCCDDEEFF');
    expect(parsed?.contactInfo?.name).toBe('Test Vehicle');
    expect(parsed?.contactInfo?.lastModified).toBe(0x12345678);
  });
});
