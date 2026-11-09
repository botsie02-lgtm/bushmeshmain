import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Device} from 'react-native-ble-plx';

import {NativeMeshCoreSessionCoordinator} from '../src/meshcore/NativeMeshCoreSessionCoordinator';
import {AppRadioConnectionService} from '../src/radio/AppRadioConnectionService';
import {releasedNativeOwnerStatus} from './testNativeOwnerStatus';
import {BushMeshProvider, useBushMesh} from '../src/state/BushMeshContext';
import {
  RadioConnectionProvider,
  useRadioConnection,
} from '../src/state/RadioConnectionContext';

function fakeDevice(): Device {
  const device = {
    id: 'AA:BB',
    name: 'Lifecycle Heltec',
    localName: 'Lifecycle Heltec',
    rssi: -48,
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

function createServiceHarness() {
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
    readChannel: jest.fn(async (channelIndex: number) => ({
      channelIndex,
      channelName: '',
      secret: new Uint8Array(16),
      empty: true,
    })),
    writeChannel: jest.fn().mockResolvedValue(undefined),
    probeChannels: jest.fn().mockResolvedValue([]),
    sendChannelMessage: jest.fn().mockResolvedValue({}),
    getBatteryStatus: jest.fn().mockResolvedValue({}),
    syncContacts: jest.fn().mockResolvedValue([]),
    getChannel: jest.fn().mockResolvedValue({}),
  };
  const createBleManager = jest.fn(() => manager as never);
  const nativeCoordinator = {
    isActive: jest.fn(() => false),
    start: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
  } as unknown as NativeMeshCoreSessionCoordinator;
  const service = new AppRadioConnectionService({
    createBleManager,
    createMeshCoreClient: jest.fn(() => client as never),
    requestPermissions: jest.fn().mockResolvedValue(true),
    discoverBle: jest.fn().mockResolvedValue({
      serviceFound: true,
      rxFound: true,
      txFound: true,
    }),
    nativeCoordinator,
    nativeSupported: () => false,
    getNativeStatus: jest.fn().mockResolvedValue(releasedNativeOwnerStatus()),
  });

  return {service, manager, client, createBleManager, device};
}

describe('RadioConnectionProvider application lifetime', () => {
  it('does not dispose or recreate BLE ownership during BushMesh rerenders and handler registration', async () => {
    const {service, manager, createBleManager, device} = createServiceHarness();
    const initialize = jest.spyOn(service, 'initialize');
    const dispose = jest.spyOn(service, 'dispose');
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    let bushMesh: ReturnType<typeof useBushMesh> | null = null;
    let radio: ReturnType<typeof useRadioConnection> | null = null;
    let renderCount = 0;

    function Probe(): null {
      bushMesh = useBushMesh();
      radio = useRadioConnection();
      renderCount += 1;
      return null;
    }

    const app = (showProbe: boolean) => (
      <BushMeshProvider>
        <RadioConnectionProvider service={service}>
          {showProbe ? <Probe /> : null}
        </RadioConnectionProvider>
      </BushMeshProvider>
    );

    let renderer: ReactTestRenderer.ReactTestRenderer | null = null;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(app(true));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(createBleManager).toHaveBeenCalledTimes(1);
    expect(bushMesh).not.toBeNull();
    expect(radio).not.toBeNull();

    const firstSendRegistration = bushMesh!.setSendChannelMessageHandler;
    const firstSyncRegistration = bushMesh!.setSyncContactsHandler;

    await ReactTestRenderer.act(async () => {
      bushMesh!.setSendChannelMessageHandler(async () => undefined);
      bushMesh!.setSyncContactsHandler(async () => []);
      bushMesh!.setChannels([
        {channelIndex: '0', channelName: 'Convoy', secret: 'test'},
      ]);
      bushMesh!.setContacts([
        {
          publicKey: 'a'.repeat(64),
          publicKeyPrefix: 'a'.repeat(12),
          name: 'Peer',
          type: 1,
          flags: 0,
          outPathLength: 1,
          lastAdvert: null,
          latitude: null,
          longitude: null,
          lastModified: null,
        },
      ]);
      bushMesh!.setConnectionStatus('Connected');
      await Promise.resolve();
    });

    expect(bushMesh!.setSendChannelMessageHandler).toBe(firstSendRegistration);
    expect(bushMesh!.setSyncContactsHandler).toBe(firstSyncRegistration);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(createBleManager).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      await radio!.startScan();
      await Promise.resolve();
    });
    expect(dispose).not.toHaveBeenCalled();
    expect(createBleManager).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      await radio!.connectToDevice(device);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(service.getSnapshot().status).toBe('Connected');
    expect(bushMesh!.canSendChannelMessage).toBe(true);
    expect(bushMesh!.canSyncContacts).toBe(true);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(createBleManager).toHaveBeenCalledTimes(1);
    expect(renderCount).toBeLessThan(30);
    expect(
      consoleError.mock.calls.some(call =>
        call.some(value =>
          String(value).includes('Maximum update depth exceeded'),
        ),
      ),
    ).toBe(false);

    await ReactTestRenderer.act(async () => {
      renderer!.update(app(false));
      await Promise.resolve();
      renderer!.update(app(true));
      await Promise.resolve();
    });
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(createBleManager).toHaveBeenCalledTimes(1);
    expect(manager.destroy).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(manager.destroy).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});