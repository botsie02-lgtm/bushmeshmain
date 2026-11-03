import {Buffer} from 'buffer';

import {MeshCoreFrameTransport} from '../src/meshcore/MeshCoreFrameTransport';
import {NativeMeshCoreSession} from '../src/meshcore/NativeMeshCoreSession';

function writeUInt32LE(bytes: number[], offset: number, value: number): void {
  const safe = value >>> 0;
  bytes[offset] = safe & 0xff;
  bytes[offset + 1] = (safe >>> 8) & 0xff;
  bytes[offset + 2] = (safe >>> 16) & 0xff;
  bytes[offset + 3] = (safe >>> 24) & 0xff;
}

function selfInfoFrame(profile: {
  frequencyMhz: number;
  bandwidthKhz: number;
  spreadingFactor: number;
  codingRate: number;
  txPower: number;
}): number[] {
  const bytes = new Array<number>(70).fill(0);
  bytes[0] = 0x05;
  bytes[1] = 0;
  bytes[2] = profile.txPower;
  bytes[3] = 22;
  for (let index = 0; index < 32; index += 1) bytes[4 + index] = index + 1;
  writeUInt32LE(bytes, 48, Math.round(profile.frequencyMhz * 1000));
  writeUInt32LE(bytes, 52, Math.round(profile.bandwidthKhz * 1000));
  bytes[56] = profile.spreadingFactor;
  bytes[57] = profile.codingRate;
  'Native Test'.split('').forEach((char, index) => {
    bytes[58 + index] = char.charCodeAt(0);
  });
  return bytes;
}

function deviceInfoFrame(repeat = 1): number[] {
  const bytes = new Array<number>(82).fill(0);
  bytes[0] = 0x0d;
  bytes[1] = 9;
  bytes[2] = 32;
  bytes[3] = 8;
  bytes[80] = repeat;
  bytes[81] = 0;
  return bytes;
}

type SetBehavior = 'success' | 'packet-error' | 'timeout' | 'disconnect' | 'mismatch';

function harness(behavior: SetBehavior) {
  let handlers: Parameters<MeshCoreFrameTransport['start']>[0] | null = null;
  let profile = {
    frequencyMhz: 869.618,
    bandwidthKhz: 62.5,
    spreadingFactor: 8,
    codingRate: 5,
    txPower: 20,
  };
  const writes: number[][] = [];

  const transport: MeshCoreFrameTransport = {
    id: 'native-radio-test',
    start: jest.fn(async next => {
      handlers = next;
    }),
    stop: jest.fn(async () => undefined),
    ensureReady: jest.fn(async () => 185),
    writeBase64: jest.fn(async encoded => {
      const bytes = Array.from(Buffer.from(encoded, 'base64'));
      writes.push(bytes);
      const command = bytes[0];
      if (command === 0x01) {
        queueMicrotask(() => handlers?.onFrame(selfInfoFrame(profile)));
        return;
      }
      if (command === 0x16) {
        queueMicrotask(() => handlers?.onFrame(deviceInfoFrame(1)));
        return;
      }
      if (command === 0x0b) {
        if (behavior === 'disconnect') {
          throw new Error('Native BLE disconnected during radio write.');
        }
        if (behavior === 'packet-error') {
          queueMicrotask(() => handlers?.onFrame([0x01, 2]));
          return;
        }
        if (behavior === 'timeout') return;

        if (behavior !== 'mismatch') {
          const frequencyRaw = Buffer.from(bytes.slice(1, 5)).readUInt32LE(0);
          const bandwidthRaw = Buffer.from(bytes.slice(5, 9)).readUInt32LE(0);
          profile = {
            ...profile,
            frequencyMhz: frequencyRaw / 1000,
            bandwidthKhz: bandwidthRaw / 1000,
            spreadingFactor: bytes[9],
            codingRate: bytes[10],
          };
        }
        queueMicrotask(() => handlers?.onFrame([0x00]));
        return;
      }
      if (command === 0x0c) {
        const signed = bytes[1] > 127 ? bytes[1] - 256 : bytes[1];
        profile = {...profile, txPower: signed};
        queueMicrotask(() => handlers?.onFrame([0x00]));
      }
    }),
  };

  const session = new NativeMeshCoreSession(transport);
  return {session, transport, writes};
}

const requested = {
  frequencyMhz: 916.58,
  bandwidthKhz: 62.5,
  spreadingFactor: 8,
  codingRate: 5,
};

describe('NativeMeshCoreSession radio settings', () => {
  it('accepts PACKET_OK, reads SELF_INFO back and verifies the exact profile', async () => {
    const {session, writes} = harness('success');
    await session.start();
    const verified = await session.setRadioParams(requested);

    expect(verified.frequencyMhz).toBe(916.58);
    expect(verified.bandwidthKhz).toBe(62.5);
    const command = writes.find(bytes => bytes[0] === 0x0b);
    expect(command?.[11]).toBe(1);
    await session.stop();
  });

  it('rejects PACKET_ERROR for CMD_SET_RADIO_PARAMS', async () => {
    const {session} = harness('packet-error');
    await session.start();
    await expect(session.setRadioParams(requested)).rejects.toThrow(/PACKET_ERROR/i);
    await session.stop();
  });

  it('rejects a disconnect/write failure during CMD_SET_RADIO_PARAMS', async () => {
    const {session} = harness('disconnect');
    await session.start();
    await expect(session.setRadioParams(requested)).rejects.toThrow(/disconnected/i);
    await session.stop();
  });

  it('rejects SELF_INFO read-back mismatch after PACKET_OK', async () => {
    const {session} = harness('mismatch');
    await session.start();
    await expect(session.setRadioParams(requested)).rejects.toThrow(/read-back mismatch/i);
    await session.stop();
  });

  it(
    'times out when firmware never answers the radio parameter command',
    async () => {
      const {session} = harness('timeout');
      await session.start();
      await expect(session.setRadioParams(requested)).rejects.toThrow(/timed out/i);
      await session.stop();
    },
    7_000,
  );
});
