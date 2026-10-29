import {parseMeshCoreChannelDataFrame} from '../src/meshcore/meshcoreChannelData';

describe('MeshCore channel-data receive parser', () => {
  test('parses SNR, channel, data type and payload', () => {
    const frame = [
      0x1b,
      0xf4, // -12 / 4 = -3 dB
      0x00,
      0x00,
      0x02,
      0x03,
      0x00,
      0xff,
      0x03,
      0x01,
      0x02,
      0x03,
    ];

    const parsed = parseMeshCoreChannelDataFrame(frame);

    expect(parsed).not.toBeNull();
    expect(parsed?.snrDb).toBe(-3);
    expect(parsed?.channelIndex).toBe(2);
    expect(parsed?.pathLength).toBe(3);
    expect(parsed?.dataType).toBe(0xff00);
    expect(Array.from(parsed?.payload ?? [])).toEqual([1, 2, 3]);
  });

  test('returns null for unrelated MeshCore frames', () => {
    expect(parseMeshCoreChannelDataFrame([0x05, 0x00])).toBeNull();
  });

  test('rejects a mismatched payload length', () => {
    expect(() =>
      parseMeshCoreChannelDataFrame([
        0x1b,
        0x00,
        0x00,
        0x00,
        0x00,
        0xff,
        0x00,
        0xff,
        0x04,
        0x01,
      ]),
    ).toThrow('declared payload length');
  });
});
