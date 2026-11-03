import {Buffer} from 'buffer';

import {
  buildSetChannelCommand,
  setChannelCommandSafeHex,
} from '../src/meshcore/meshcoreCommands';
import {
  clearMeshCoreChannel,
  provisionMeshCoreChannel,
  readAllMeshCoreChannels,
} from '../src/meshcore/meshcoreProvisioning';
import {MeshCoreChannelInfo} from '../src/meshcore/meshcoreChannelInfo';
import {MeshCoreDeviceInfo} from '../src/meshcore/meshcoreDeviceInfo';

function deviceInfo(maxChannels: number | null): MeshCoreDeviceInfo {
  return {
    firmwareVersion: 3,
    maxContacts: 100,
    maxChannels,
    blePin: null,
    firmwareBuild: 'test',
    model: 'heltec',
    version: 'test',
    clientRepeat: null,
    pathHashMode: null,
  };
}

function channel(
  channelIndex: number,
  channelName = '',
  secret = new Uint8Array(16),
): MeshCoreChannelInfo {
  return {
    channelIndex,
    channelName,
    secret: Uint8Array.from(secret),
    empty:
      channelName.length === 0 && Array.from(secret).every(byte => byte === 0),
  };
}

function createPort(maxChannels = 3) {
  const slots = new Map<number, MeshCoreChannelInfo>();
  for (let index = 0; index < maxChannels; index += 1) {
    slots.set(index, channel(index));
  }
  const getDeviceInfo = jest.fn(async () => deviceInfo(maxChannels));
  const readChannel = jest.fn(async (index: number) => {
    const value = slots.get(index);
    if (!value) throw new Error('bad slot');
    return channel(value.channelIndex, value.channelName, value.secret);
  });
  const writeChannel = jest.fn(
    async (index: number, name: string, secret: Uint8Array) => {
      slots.set(index, channel(index, name, secret));
    },
  );
  return {port: {getDeviceInfo, readChannel, writeChannel}, slots, getDeviceInfo, readChannel, writeChannel};
}

describe('MeshCore SET_CHANNEL provisioning', () => {
  it('encodes CMD_SET_CHANNEL byte-exactly with a 32-byte padded name and 16-byte secret', () => {
    const secret = Uint8Array.from({length: 16}, (_, index) => index + 1);
    const bytes = Array.from(
      Buffer.from(buildSetChannelCommand(5, 'Bush Convoy', secret), 'base64'),
    );

    expect(bytes).toHaveLength(50);
    expect(bytes[0]).toBe(0x20);
    expect(bytes[1]).toBe(5);
    expect(Buffer.from(bytes.slice(2, 34)).toString('utf8').replace(/\0/g, '')).toBe(
      'Bush Convoy',
    );
    expect(bytes.slice(34)).toEqual(Array.from(secret));
  });

  it('accepts exactly 32 UTF-8 name bytes and rejects longer names instead of truncating', () => {
    const secret = new Uint8Array(16);
    expect(() => buildSetChannelCommand(0, 'a'.repeat(32), secret)).not.toThrow();
    expect(() => buildSetChannelCommand(0, 'a'.repeat(33), secret)).toThrow(
      /cannot exceed 32 UTF-8 bytes/i,
    );
    expect(() => buildSetChannelCommand(0, '🚙'.repeat(9), secret)).toThrow(
      /cannot exceed 32 UTF-8 bytes/i,
    );
  });

  it('requires an exact 16-byte channel secret', () => {
    expect(() => buildSetChannelCommand(0, 'Convoy', new Uint8Array(15))).toThrow(
      /exactly 16 bytes/i,
    );
    expect(() => buildSetChannelCommand(0, 'Convoy', new Uint8Array(17))).toThrow(
      /exactly 16 bytes/i,
    );
  });

  it('never includes the secret in the safe diagnostic description', () => {
    const secretHex = 'A5'.repeat(16);
    const safe = setChannelCommandSafeHex(2, 'Private');
    expect(safe).toContain('<16-byte secret redacted>');
    expect(safe).not.toContain(secretHex);
  });

  it('uses DeviceInfo maxChannels rather than a hard-coded eight-slot limit', async () => {
    const {port, readChannel} = createPort(12);
    const channels = await readAllMeshCoreChannels(port);
    expect(channels).toHaveLength(12);
    expect(readChannel).toHaveBeenCalledTimes(12);
    expect(readChannel).toHaveBeenLastCalledWith(11);
  });

  it('fails clearly when firmware does not advertise channel capacity', async () => {
    const port = {
      getDeviceInfo: jest.fn(async () => deviceInfo(null)),
      readChannel: jest.fn(),
      writeChannel: jest.fn(),
    };
    await expect(readAllMeshCoreChannels(port)).rejects.toThrow(/did not advertise/i);
  });

  it('creates a private channel in the first empty slot with secure random bytes and verifies read-back', async () => {
    const {port, slots, writeChannel} = createPort(4);
    slots.set(0, channel(0, 'Existing', Uint8Array.from({length: 16}, () => 7)));
    const randomSecret = Uint8Array.from({length: 16}, (_, index) => 0x80 + index);
    const randomBytes = jest.fn(async (length: number) => {
      expect(length).toBe(16);
      return randomSecret;
    });

    const provisioned = await provisionMeshCoreChannel(port, {
      channelName: 'BushMesh Private',
      randomBytes,
    });

    expect(provisioned.channelIndex).toBe(1);
    expect(provisioned.channelName).toBe('BushMesh Private');
    expect(Array.from(provisioned.secret)).toEqual(Array.from(randomSecret));
    expect(writeChannel).toHaveBeenCalledWith(1, 'BushMesh Private', expect.any(Uint8Array));
  });

  it('clears a channel with an empty name and zero secret, then verifies it', async () => {
    const {port, slots, writeChannel} = createPort(3);
    slots.set(2, channel(2, 'Old Convoy', Uint8Array.from({length: 16}, () => 9)));

    const cleared = await clearMeshCoreChannel(port, 2);

    expect(cleared.empty).toBe(true);
    expect(writeChannel).toHaveBeenCalledWith(2, '', expect.any(Uint8Array));
    const secret = writeChannel.mock.calls[0][2] as Uint8Array;
    expect(Array.from(secret)).toEqual(new Array(16).fill(0));
  });

  it('does not claim provisioning success when read-back differs', async () => {
    const {port} = createPort(2);
    port.readChannel = jest
      .fn()
      .mockResolvedValueOnce(channel(0))
      .mockResolvedValueOnce(
        channel(0, 'Different', Uint8Array.from({length: 16}, () => 1)),
      );

    await expect(
      provisionMeshCoreChannel(port, {
        channelName: 'Expected',
        channelIndex: 0,
        secret: Uint8Array.from({length: 16}, () => 2),
      }),
    ).rejects.toThrow(/did not verify/i);
  });
});