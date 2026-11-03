import {Device} from 'react-native-ble-plx';

import {NativeMeshCoreSession} from '../src/meshcore/NativeMeshCoreSession';
import {NativeMeshCoreSessionCoordinator} from '../src/meshcore/NativeMeshCoreSessionCoordinator';
import {NativeRadioServiceStatus} from '../src/native/NativeRadioService';
import {AppRadioConnectionService} from '../src/radio/AppRadioConnectionService';

function fakeDevice(id = 'AA:BB:CC:DD:EE:FF'): Device {
  const device = {
    id,
    name: 'Test Heltec',
    localName: 'Test Heltec',
    rssi: -47,
    discoverAllServicesAndCharacteristics: jest.fn(),
  } as unknown as Device;
  (device.discoverAllServicesAndCharacteristics as jest.Mock).mockResolvedValue(device);
  return device;
}

const fakeDeviceInfo = {
  firmwareVersion: 3,
  maxContacts: 32,
  maxChannels: 2,
  blePin: null,
  firmwareBuild: 'test',
  model: 'test',
  version: 'test',
  clientRepeat: null,
  pathHashMode: null,
};

function emptyChannel(channelIndex: number) {
  return {
    channelIndex,
    channelName: '',
    secret: new Uint8Array(16),
    empty: true,
  };
}

function releasedNativeStatus(): NativeRadioServiceStatus {
  return {
    running: false,
    radioRequested: false,
    locationRequested: false,
    deviceLabel: null,
    deviceAddress: null,
    startedAtMs: 0,
    ownership: 'react-native-session',
    nativeBleState: 'disconnected',
    nativeBleDeviceAddress: null,
    nativeBleDeviceLabel: null,
    nativeBleMtu: 0,
    nativeBleReconnectAttempt: 0,
    nativeBleConnectedAtMs: 0,
    nativeBleLastError: null,
    nativeBleQueuedWrites: 0,
    nativeBleBufferedFrames: 0,
    persistedNativeTargetPresent: false,
  };
}

function createHarness() {
  const device = fakeDevice();
  const manager = {
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
    connectToDevice: jest.fn().mockResolvedValue(device),
    cancelDeviceConnection: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn(),
  };
  const client = {
    start: jest.fn(),
    stop: jest.fn(),
    sendAppStart: jest.fn().mockResolvedValue({}),
    sendDeviceQuery: jest.fn().mockResolvedValue({deviceInfo: fakeDeviceInfo}),
    getDeviceInfo: jest.fn().mockResolvedValue(fakeDeviceInfo),
    readChannel: jest.fn(async (channelIndex: number) => emptyChannel(channelIndex)),
    writeChannel: jest.fn().mockResolvedValue(undefined),
    probeChannels: jest.fn().mockResolvedValue([]),
    sendChannelMessage: jest.fn().mockResolvedValue({}),
    getBatteryStatus: jest.fn().mockResolvedValue({}),
    syncContacts: jest.fn().mockResolvedValue([]),
    getChannel: jest.fn().mockResolvedValue({}),
  };
  const nativeSession = {
    sendAppStart: jest.fn().mockResolvedValue({}),
    sendDeviceQuery: jest.fn().mockResolvedValue({deviceInfo: fakeDeviceInfo}),
    getDeviceInfo: jest.fn().mockResolvedValue(fakeDeviceInfo),
    readChannel: jest.fn(async (channelIndex: number) => emptyChannel(channelIndex)),
    writeChannel: jest.fn().mockResolvedValue(undefined),
    probeChannels: jest.fn().mockResolvedValue([]),
    sendChannelMessage: jest.fn().mockResolvedValue({}),
    getBatteryStatus: jest.fn().mockResolvedValue({parsed: {batteryInfo: null}}),
    syncContacts: jest.fn().mockResolvedValue([]),
    syncQueuedMessages: jest.fn().mockResolvedValue([]),
    getChannel: jest.fn().mockResolvedValue({}),
    stop: jest.fn().mockResolvedValue(undefined),
  } as unknown as NativeMeshCoreSession;
  const nativeCoordinator = {
    isActive: jest.fn(() => false),
    start: jest.fn().mockResolvedValue(nativeSession),
    stop: jest.fn().mockResolvedValue(undefined),
  } as unknown as NativeMeshCoreSessionCoordinator;
  const service = new AppRadioConnectionService({
    createBleManager: jest.fn(() => manager as never),
    createMeshCoreClient: jest.fn(() => client as never),
    requestPermissions: jest.fn().mockResolvedValue(true),
    discoverBle: jest.fn().mockResolvedValue({
      serviceFound: true,
      rxFound: true,
      txFound: true,
    }),
    nativeCoordinator,
    nativeSupported: () => true,
    getNativeStatus: jest.fn().mockResolvedValue(releasedNativeStatus()),
  });

  return {
    service,
    device,
    manager,
    client,
    nativeSession,
    nativeCoordinator,
  };
}

describe('AppRadioConnectionService native stop lifecycle', () => {
  it('confirmed native stop returns to none and enables a subsequent JS BLE Diagnostics connection', async () => {
    const {service, device, manager, nativeCoordinator} = createHarness();
    await service.initialize();
    await service.handoffDiscoveredDeviceToAndroid(device);
    expect(service.getSnapshot().connectionOwner).toBe('android-native');

    await service.disconnect();

    expect(nativeCoordinator.stop).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot()).toMatchObject({
      status: 'Disconnected',
      connectionOwner: 'none',
      connectedDeviceAddress: null,
      connectedDeviceLabel: null,
    });

    await service.connectToDevice(device);

    expect(manager.connectToDevice).toHaveBeenCalledWith(device.id);
    expect(service.getSnapshot().connectionOwner).toBe('react-native');
    await service.dispose();
  });

  it('can start Background Radio again after a confirmed stop', async () => {
    const {service, device, nativeCoordinator} = createHarness();
    await service.initialize();

    await service.handoffDiscoveredDeviceToAndroid(device);
    await service.disconnect();
    await service.handoffDiscoveredDeviceToAndroid(device);

    expect(nativeCoordinator.start).toHaveBeenCalledTimes(2);
    expect(nativeCoordinator.stop).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().connectionOwner).toBe('android-native');
    await service.disconnect();
    await service.dispose();
  });

  it('survives repeated native start and confirmed stop cycles without recreating the BLE manager', async () => {
    const {service, device, manager, nativeCoordinator} = createHarness();
    await service.initialize();

    for (let cycle = 0; cycle < 4; cycle += 1) {
      await service.handoffDiscoveredDeviceToAndroid(device);
      expect(service.getSnapshot().connectionOwner).toBe('android-native');
      await service.disconnect();
      expect(service.getSnapshot().connectionOwner).toBe('none');
    }

    expect(nativeCoordinator.start).toHaveBeenCalledTimes(4);
    expect(nativeCoordinator.stop).toHaveBeenCalledTimes(4);
    expect(manager.destroy).not.toHaveBeenCalled();
    await service.dispose();
    expect(manager.destroy).toHaveBeenCalledTimes(1);
  });

  it('treats stop as idempotent after ownership has already been confirmed released', async () => {
    const {service, device, nativeCoordinator} = createHarness();
    await service.initialize();
    await service.handoffDiscoveredDeviceToAndroid(device);

    await service.disconnect();
    await service.disconnect();

    expect(nativeCoordinator.stop).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().connectionOwner).toBe('none');
    await service.dispose();
  });

  it('keeps Android ownership visible when native shutdown acknowledgement fails', async () => {
    const {service, device, nativeCoordinator} = createHarness();
    const stop = nativeCoordinator.stop as jest.MockedFunction<
      NativeMeshCoreSessionCoordinator['stop']
    >;
    stop.mockRejectedValueOnce(
      new Error('Android native radio did not confirm shutdown within 6000ms'),
    );
    await service.initialize();
    await service.handoffDiscoveredDeviceToAndroid(device);

    await expect(service.disconnect()).rejects.toThrow(/did not confirm shutdown/i);

    expect(service.getSnapshot()).toMatchObject({
      status: 'Error',
      connectionOwner: 'android-native',
      connectedDeviceAddress: device.id,
      connectedDeviceLabel: 'Test Heltec',
      isWriting: false,
    });

    stop.mockResolvedValueOnce(undefined);
    await service.disconnect();
    expect(service.getSnapshot().connectionOwner).toBe('none');
    await service.dispose();
  });
});