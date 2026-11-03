import {Buffer} from 'buffer';

import {
  createBushMeshConvoy,
  decodeBushMeshConvoyInvite,
  joinBushMeshConvoy,
} from '../src/convoy/convoyProvisioning';
import {MeshCoreChannelInfo} from '../src/meshcore/meshcoreChannelInfo';
import {MeshCoreDeviceInfo} from '../src/meshcore/meshcoreDeviceInfo';

function deviceInfo(): MeshCoreDeviceInfo {
  return {
    firmwareVersion: 3,
    maxContacts: 100,
    maxChannels: 4,
    blePin: null,
    firmwareBuild: 'test',
    model: 'heltec',
    version: 'test',
    clientRepeat: null,
    pathHashMode: null,
  };
}

function empty(index: number): MeshCoreChannelInfo {
  return {
    channelIndex: index,
    channelName: '',
    secret: new Uint8Array(16),
    empty: true,
  };
}

function createPort() {
  const slots = new Map<number, MeshCoreChannelInfo>(
    [0, 1, 2, 3].map(index => [index, empty(index)]),
  );
  return {
    getDeviceInfo: jest.fn(async () => deviceInfo()),
    readChannel: jest.fn(async (index: number) => {
      const value = slots.get(index)!;
      return {...value, secret: Uint8Array.from(value.secret)};
    }),
    writeChannel: jest.fn(
      async (index: number, name: string, secret: Uint8Array): Promise<void> => {
        slots.set(index, {
          channelIndex: index,
          channelName: name,
          secret: Uint8Array.from(secret),
          empty: name.length === 0 && Array.from(secret).every(byte => byte === 0),
        });
      },
    ),
    slots,
  };
}

describe('BushMesh convoy carrier provisioning', () => {
  it('creates a convoy only after provisioning and verifying a private MeshCore channel', async () => {
    const port = createPort();
    const randomBytes = jest.fn(async (length: number) =>
      length === 8
        ? Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])
        : Uint8Array.from({length: 16}, (_, index) => index + 0x20),
    );

    const enrollment = await createBushMeshConvoy(port, {
      convoyName: 'High Country',
      channelName: 'BM High Country',
      randomBytes,
    });

    expect(enrollment.convoyId).toBe('0102030405060708');
    expect(enrollment.channel.channelIndex).toBe(0);
    const invite = decodeBushMeshConvoyInvite(enrollment.invite);
    expect(invite.convoy).toEqual({
      id: '0102030405060708',
      name: 'High Country',
    });
    expect(invite.carrier.kind).toBe('meshcore-channel');
    expect(invite.carrier.channelName).toBe('BM High Country');
    expect(invite.carrier.secretHex).toHaveLength(32);
    expect(invite.security).toEqual({
      contract: 'bushmesh-security-v1',
      enrollment: null,
    });
  });

  it('joins another node with the exact same carrier name and secret', async () => {
    const creator = createPort();
    const creatorEnrollment = await createBushMeshConvoy(creator, {
      convoyName: 'Two Node Test',
      randomBytes: async length =>
        length === 8
          ? Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2])
          : Uint8Array.from({length: 16}, (_, index) => 0xa0 + index),
    });

    const joiner = createPort();
    const joined = await joinBushMeshConvoy(joiner, {
      invite: creatorEnrollment.invite,
      channelIndex: 2,
    });

    expect(joined.convoyId).toBe(creatorEnrollment.convoyId);
    expect(joined.convoyName).toBe(creatorEnrollment.convoyName);
    expect(joined.channel.channelIndex).toBe(2);
    expect(joined.channel.channelName).toBe(creatorEnrollment.channel.channelName);
    expect(Array.from(joined.channel.secret)).toEqual(
      Array.from(creatorEnrollment.channel.secret),
    );
  });

  it('does not return an enrollment when channel read-back verification fails', async () => {
    const port = createPort();
    port.writeChannel = jest.fn(
      async (
        _index: number,
        _name: string,
        _secret: Uint8Array,
      ): Promise<void> => undefined,
    );

    await expect(
      createBushMeshConvoy(port, {
        convoyName: 'Must Verify',
        channelIndex: 0,
        randomBytes: async length => new Uint8Array(length).fill(7),
      }),
    ).rejects.toThrow(/did not verify/i);
  });

  it('rejects invites that blur or omit the Security v1 enrollment boundary', () => {
    const invalid = Buffer.from(
      JSON.stringify({
        schema: 'bushmesh-convoy-invite',
        version: 1,
        convoy: {id: 'x', name: 'x'},
        carrier: {
          kind: 'meshcore-channel',
          channelName: 'x',
          secretHex: 'AA'.repeat(16),
        },
        security: {contract: 'bushmesh-security-v1', enrollment: 'not-supported'},
      }),
      'utf8',
    ).toString('base64');
    expect(() =>
      decodeBushMeshConvoyInvite(`BUSHMESH-CONVOY-1:${invalid}`),
    ).toThrow(/unsupported or incomplete/i);
  });
});