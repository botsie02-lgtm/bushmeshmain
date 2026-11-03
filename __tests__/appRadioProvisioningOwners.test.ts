import {Device} from 'react-native-ble-plx';

import {NativeMeshCoreSessionCoordinator} from '../src/meshcore/NativeMeshCoreSessionCoordinator';
import {AppRadioConnectionService} from '../src/radio/AppRadioConnectionService';

const deviceInfo = {
  firmwareVersion: 3,
  maxContacts: 64,
  maxChannels: 3,
  blePin: null,
  firmwareBuild: 'test',
  model: 'Heltec',
  version: 'test',
  clientRepeat: null,
  pathHashMode: null,
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
  const session = {
    start: jest.fn(),
    stop: jest.fn(),
    sendAppStart: jest.fn().mockResolvedValue({}),
    sendDeviceQuery: jest.fn().mockResolvedValue({deviceInfo}),
    getDeviceInfo: jest.fn().mockResolvedValue(deviceInfo),
    readChannel: jest.fn(async (index: number) => {
      const value = slots.get(index)!;
      return {...value, secret: Uint8Array.from(value.secret)};
    }),
    writeChannel: jest.fn(async (index: number, name: string, secret: Uint8Array) => {
      slots.set(index, {
        channelIndex: index,
        channelName: name,
        secret: Uint8Array.from(secret),
        empty: name.length === 0 && Array.from(secret).every(byte => byte === 0),
      });
    }),
    probeChannels: jest.fn().mockResolvedValue([]),
    getBatteryStatus: jest.fn().mockResolvedValue({parsed: {batteryInfo: null}}),
    syncContacts: jest.fn().mockResolvedValue([]),
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
  return {service, device, manager, react, native, nativeCoordinator, randomSecret};
}

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
});