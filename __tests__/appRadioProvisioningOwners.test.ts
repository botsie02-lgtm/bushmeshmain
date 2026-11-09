import {Device} from 'react-native-ble-plx';

import {NativeMeshCoreSessionCoordinator} from '../src/meshcore/NativeMeshCoreSessionCoordinator';
import {AppRadioConnectionService} from '../src/radio/AppRadioConnectionService';

const deviceInfo = {
  firmwareVersion: 9,
  maxContacts: 64,
  maxChannels: 3,
  blePin: null,
  firmwareBuild: 'test',
  model: 'Heltec',
  version: 'test',
  clientRepeat: 1,
  pathHashMode: 0,
};

const baseSelfInfo = {
  advertisementType: 0,
  txPower: 20,
  maxTxPower: 22,
  publicKeyPrefix: 'AABBCCDDEEFF',
  bushMeshIdentityRef: 'AABBCCDDEEFF',
  latitude: null,
  longitude: null,
  frequencyMhz: 869.618,
  bandwidthKhz: 62.5,
  spreadingFactor: 8,
  codingRate: 5,
  deviceName: 'Provisioning Heltec',
};

const contactPublicKey = 'AB'.repeat(32);
const parsedContact = {
  publicKey: contactPublicKey,
  publicKeyPrefix: contactPublicKey.slice(0, 12),
  name: 'Heltec B',
  type: 0,
  flags: 0,
  outPathLength: 0,
  lastAdvert: 1234,
  latitude: null,
  longitude: null,
  lastModified: 1234,
};

function fakeDevice(): Device {
  const device = {
    id: 'AA:BB:CC:DD:EE:FF',
    name: 'Provisioning Heltec',
    localName: 'Provisioning Heltec',
    rssi: -45,
    discoverAllServicesAndCharacteristics: jest.fn(),
  } as unknown as Device;
  (device.discoverAllServicesAndCharacteristics as jest.Mock).mockResolvedValue(device);
  return device;
}

function mutableSession() {
  const slots = new Map(
    [0, 1, 2].map(index => [
      index,
      {
        channelIndex: index,
        channelName: '',
        secret: new Uint8Array(16),
        empty: true,
      },
    ]),
  );
  let currentSelfInfo = {...baseSelfInfo};
  const session = {
    start: jest.fn(),
    stop: jest.fn(),
    sendAppStart: jest.fn(async () => ({selfInfo: {...currentSelfInfo}})),
    sendDeviceQuery: jest.fn().mockResolvedValue({deviceInfo}),
    getDeviceInfo: jest.fn().mockResolvedValue(deviceInfo),
    setRadioParams: jest.fn(async (input: {
      frequencyMhz: number;
      bandwidthKhz: number;
      spreadingFactor: number;
      codingRate: number;
    }) => {
      currentSelfInfo = {...currentSelfInfo, ...input};
      return {...currentSelfInfo};
    }),
    setRadioTxPower: jest.fn(async (txPower: number) => {
      currentSelfInfo = {...currentSelfInfo, txPower};
      return {...currentSelfInfo};
    }),
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
    probeChannels: jest.fn().mockResolvedValue([]),
    getBatteryStatus: jest.fn().mockResolvedValue({parsed: {batteryInfo: null}}),
    syncContacts: jest.fn().mockResolvedValue([]),
    lookupContact: jest.fn().mockResolvedValue(parsedContact),
    addOrUpdateContact: jest.fn().mockResolvedValue(parsedContact),
    removeContact: jest.fn().mockResolvedValue(undefined),
    exportContact: jest.fn().mockResolvedValue(Uint8Array.from([0x0b, 1, 2, 3])),
    importContact: jest.fn().mockResolvedValue(undefined),
    syncQueuedMessages: jest.fn().mockResolvedValue([]),
    sendChannelMessage: jest.fn().mockResolvedValue({}),
    getChannel: jest.fn().mockResolvedValue({}),
  };
  return {session, slots};
}

function createHarness(nativeSupported: boolean) {
  const device = fakeDevice();
  const manager = {
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
    connectToDevice: jest.fn().mockResolvedValue(device),
    cancelDeviceConnection: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn(),
  };
  const react = mutableSession();
  const native = mutableSession();
  const nativeCoordinator = {
    isActive: jest.fn(() => false),
    start: jest.fn().mockResolvedValue(native.session),
    stop: jest.fn().mockResolvedValue(undefined),
  } as unknown as NativeMeshCoreSessionCoordinator;
  const randomSecret = Uint8Array.from({length: 16}, (_, index) => index + 1);
  const service = new AppRadioConnectionService({
    createBleManager: jest.fn(() => manager as never),
    createMeshCoreClient: jest.fn(() => react.session as never),
    requestPermissions: jest.fn().mockResolvedValue(true),
    discoverBle: jest.fn().mockResolvedValue({
      serviceFound: true,
      rxFound: true,
      txFound: true,
    }),
    nativeCoordinator,
    nativeSupported: () => nativeSupported,
    getNativeStatus: jest.fn(),
    randomBytes: jest.fn(async length => {
      if (length === 16) return randomSecret;
      return new Uint8Array(length).fill(9);
    }),
  });
  return {
    service,
    device,
    manager,
    react,
    native,
    nativeCoordinator,
    randomSecret,
  };
}

const targetRadio = {
  frequencyMhz: 916.58,
  bandwidthKhz: 62.5,
  spreadingFactor: 8,
  codingRate: 5,
  txPowerDbm: 20,
};

describe('AppRadioConnectionService provisioning owners', () => {
  it('provisions and verifies through the existing React-Native BLE session', async () => {
    const {service, device, react, randomSecret} = createHarness(false);
    await service.initialize();
    await service.connectToDevice(device);

    const created = await service.createPrivateChannel({channelName: 'RN Private'});

    expect(service.getSnapshot().connectionOwner).toBe('react-native');
    expect(react.session.writeChannel).toHaveBeenCalledWith(
      0,
      'RN Private',
      expect.any(Uint8Array),
    );
    expect(created.secretHex).toBe(
      Array.from(randomSecret)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase(),
    );
    expect(service.getSnapshot().channels[0]).toMatchObject({
      channelIndex: '0',
      channelName: 'RN Private',
      secret: 'Configured (redacted)',
    });
    await service.dispose();
  });

  it('provisions through the existing Android-native session without opening a second JS GATT connection', async () => {
    const {service, device, manager, native} = createHarness(true);
    await service.initialize();
    await service.handoffDiscoveredDeviceToAndroid(device);

    const joined = await service.joinPrivateChannel({
      channelName: 'Native Private',
      secretHex: 'AB'.repeat(16),
      channelIndex: 2,
    });

    expect(manager.connectToDevice).not.toHaveBeenCalled();
    expect(service.getSnapshot().connectionOwner).toBe('android-native');
    expect(native.session.writeChannel).toHaveBeenCalledWith(
      2,
      'Native Private',
      expect.any(Uint8Array),
    );
    expect(joined).toMatchObject({
      channelIndex: 2,
      channelName: 'Native Private',
      secretHex: 'AB'.repeat(16),
    });
    expect(service.getSnapshot().channels[2].secret).toBe('Configured (redacted)');
    await service.disconnect();
    await service.dispose();
  });

  it('applies and verifies radio settings through the existing JS-GATT owner without rewriting channels', async () => {
    const {service, device, react} = createHarness(false);
    await service.initialize();
    await service.connectToDevice(device);
    await service.createPrivateChannel({channelName: 'Keep Me', channelIndex: 1});
    const channelsBefore = service.getSnapshot().channels;
    react.session.writeChannel.mockClear();

    const verified = await service.applyAndVerifyRadioSettings(targetRadio);

    expect(react.session.setRadioParams).toHaveBeenCalledWith({
      frequencyMhz: 916.58,
      bandwidthKhz: 62.5,
      spreadingFactor: 8,
      codingRate: 5,
    });
    expect(react.session.setRadioTxPower).not.toHaveBeenCalled();
    expect(verified.selfInfo.frequencyMhz).toBe(916.58);
    expect(service.getSnapshot().channels).toEqual(channelsBefore);
    expect(react.session.writeChannel).not.toHaveBeenCalled();
    await service.dispose();
  });

  it('applies and verifies radio settings through Android-native ownership without opening JS GATT or rewriting channels', async () => {
    const {service, device, manager, native} = createHarness(true);
    await service.initialize();
    await service.handoffDiscoveredDeviceToAndroid(device);
    await service.joinPrivateChannel({
      channelName: 'Keep Native',
      secretHex: 'AB'.repeat(16),
      channelIndex: 2,
    });
    const channelsBefore = service.getSnapshot().channels;
    native.session.writeChannel.mockClear();

    const verified = await service.applyAndVerifyRadioSettings({
      ...targetRadio,
      txPowerDbm: 21,
    });

    expect(manager.connectToDevice).not.toHaveBeenCalled();
    expect(native.session.setRadioParams).toHaveBeenCalledWith({
      frequencyMhz: 916.58,
      bandwidthKhz: 62.5,
      spreadingFactor: 8,
      codingRate: 5,
    });
    expect(native.session.setRadioTxPower).toHaveBeenCalledWith(21);
    expect(verified.selfInfo.txPower).toBe(21);
    expect(service.getSnapshot().channels).toEqual(channelsBefore);
    expect(native.session.writeChannel).not.toHaveBeenCalled();
    await service.disconnect();
    await service.dispose();
  });

  it('runs sync, unique-prefix lookup, add/update, export/import and verified remove through the active session', async () => {
    const {service, device, react} = createHarness(false);
    await service.initialize();
    await service.connectToDevice(device);

    react.session.syncContacts
      .mockResolvedValueOnce([parsedContact])
      .mockResolvedValueOnce([parsedContact])
      .mockResolvedValueOnce([]);

    const synced = await service.syncContacts();
    expect(synced).toHaveLength(1);

    const lookedUp = await service.lookupContact(contactPublicKey.slice(0, 8));
    expect(react.session.lookupContact).toHaveBeenCalledWith(contactPublicKey);
    expect(lookedUp.name).toBe('Heltec B');

    const updated = await service.addOrUpdateContact({
      publicKey: contactPublicKey,
      name: 'Heltec B',
    });
    expect(react.session.addOrUpdateContact).toHaveBeenCalledWith({
      publicKey: contactPublicKey,
      name: 'Heltec B',
      type: undefined,
    });
    expect(updated.publicKey).toBe(contactPublicKey);

    const exported = await service.exportContact(contactPublicKey);
    expect(react.session.exportContact).toHaveBeenCalledWith(contactPublicKey);
    expect(typeof exported).toBe('string');

    await service.importContact(exported);
    expect(react.session.importContact).toHaveBeenCalledWith(expect.any(Uint8Array));

    await service.removeContact(contactPublicKey);
    expect(react.session.removeContact).toHaveBeenCalledWith(contactPublicKey);
    expect(service.getSnapshot().contacts).toEqual([]);

    await service.dispose();
  });
  it.each([false, true])('reveals an existing PSK read-only on native=%s without rewriting carrier settings', async nativeSupported => {
    const {service, device, react, native, manager} = createHarness(nativeSupported);
    await service.initialize();
    if (nativeSupported) {
      await service.handoffDiscoveredDeviceToAndroid(device);
    } else {
      await service.connectToDevice(device);
    }
    const stored = await service.createPrivateChannel({
      channelName: 'Existing Private Carrier',
      channelIndex: 2,
    });
    const owner = nativeSupported ? native : react;
    owner.session.writeChannel.mockClear();
    owner.session.setRadioParams.mockClear();
    owner.session.setRadioTxPower.mockClear();

    const revealed = await service.revealChannelSecret(2, 'Existing Private Carrier');
    expect(revealed).toBe(stored.secretHex);
    await expect(service.revealChannelSecret(2, 'Wrong channel name')).rejects.toThrow(
      /name changed/i,
    );
    expect(owner.session.readChannel).toHaveBeenCalledWith(2);
    expect(owner.session.writeChannel).not.toHaveBeenCalled();
    expect(owner.session.setRadioParams).not.toHaveBeenCalled();
    expect(owner.session.setRadioTxPower).not.toHaveBeenCalled();
    if (nativeSupported) expect(manager.connectToDevice).not.toHaveBeenCalled();
    await service.disconnect();
    await service.dispose();
  });

});