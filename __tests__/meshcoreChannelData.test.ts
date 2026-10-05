import {Buffer} from 'buffer';

import {
  buildSendChannelDataFloodCommand,
  sendChannelDataFloodCommandHex,
} from '../src/meshcore/meshcoreCommands';

describe('MeshCore channel data commands', () => {
  test('builds the documented flood frame layout', () => {
    const payload = Uint8Array.from([0x01, 0x02, 0x03]);
    const base64 = buildSendChannelDataFloodCommand(2, 0xff00, payload);
    const bytes = Array.from(Buffer.from(base64, 'base64'));

    expect(bytes).toEqual([
      0x3e,
      0x02,
      0xff,
      0x00,
      0xff,
      0x01,
      0x02,
      0x03,
    ]);

    expect(sendChannelDataFloodCommandHex(2, 0xff00, payload)).toBe(
      '3E 02 FF 00 FF 01 02 03',
    );
  });

  test('rejects channel data larger than MeshCore allows', () => {
    expect(() =>
      buildSendChannelDataFloodCommand(0, 0xff00, new Uint8Array(164)),
    ).toThrow('163 bytes');
  });

  test('rejects reserved data type zero', () => {
    expect(() =>
      buildSendChannelDataFloodCommand(0, 0x0000, Uint8Array.from([1])),
    ).toThrow('0x0001');
  });
});
