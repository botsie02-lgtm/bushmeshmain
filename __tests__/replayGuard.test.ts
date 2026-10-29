import {
  compareBushMeshPacketClock,
  isNewerBushMeshPacket,
} from '../src/bushmesh/replayGuard';

describe('Bushmesh replay ordering', () => {
  test('timestamps take precedence across app and radio restarts', () => {
    expect(
      compareBushMeshPacketClock(
        {timestampSeconds: 100, sequence: 65000},
        {timestampSeconds: 101, sequence: 1},
      ),
    ).toBe('newer');

    expect(
      compareBushMeshPacketClock(
        {timestampSeconds: 100, sequence: 1},
        {timestampSeconds: 99, sequence: 65000},
      ),
    ).toBe('older');
  });

  test('detects exact duplicates', () => {
    expect(
      compareBushMeshPacketClock(
        {timestampSeconds: 100, sequence: 44},
        {timestampSeconds: 100, sequence: 44},
      ),
    ).toBe('duplicate');
  });

  test('orders normal same-second sequence increments', () => {
    expect(
      compareBushMeshPacketClock(
        {timestampSeconds: 100, sequence: 44},
        {timestampSeconds: 100, sequence: 45},
      ),
    ).toBe('newer');
  });

  test('orders uint16 wraparound without treating wrapped packets as old', () => {
    expect(
      compareBushMeshPacketClock(
        {timestampSeconds: 100, sequence: 0xffff},
        {timestampSeconds: 100, sequence: 1},
      ),
    ).toBe('newer');

    expect(
      compareBushMeshPacketClock(
        {timestampSeconds: 100, sequence: 1},
        {timestampSeconds: 100, sequence: 0xffff},
      ),
    ).toBe('older');
  });

  test('new sender state accepts the first packet', () => {
    expect(
      isNewerBushMeshPacket(null, {timestampSeconds: 100, sequence: 1}),
    ).toBe(true);
  });

  test('rejects invalid sequence numbers', () => {
    expect(() =>
      isNewerBushMeshPacket(null, {timestampSeconds: 100, sequence: 0x10000}),
    ).toThrow('uint16');
  });
});
