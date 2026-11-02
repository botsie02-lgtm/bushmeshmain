import {Device} from 'react-native-ble-plx';

import {AppRadioConnectionService} from '../src/radio/AppRadioConnectionService';
import {NativeMeshCoreSessionCoordinator} from '../src/meshcore/NativeMeshCoreSessionCoordinator';

function fakeDevice(id = 'AA:BB'): Device {
  const device = {
    id,
    name: 'Test MeshCore',
    localName: 'Test MeshCore',
    rssi: -55,
    discoverAllServicesAndCharacteristics: jest.fn(),
  } as unknown as Device;
  (device.discoverAllServicesAndCharacteristics as jest.Mock).mockResolvedValue(device);
  return device;
}

describe('AppRadioConnectionService', () => {
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
      sendDeviceQuery: jest.fn().mockResolvedValue({}),
      probeChannels: jest.fn().mockResolvedValue([]),
      sendChannelMessage: jest.fn().mockResolvedValue({}),
      getBatteryStatus: jest.fn().mockResolvedValue({}),
      syncContacts: jest.fn().mockResolvedValue([]),
      getChannel: jest.fn().mockResolvedValue({}),
    };
    let clientEvents: {
      onConnectionState?: (state: string, detail: string) => void;
    } | null = null;
    const createBleManager = jest.fn(() => manager as never);
    const createMeshCoreClient = jest.fn((...args: unknown[]) => {
      clientEvents = args[2] as typeof clientEvents;
      return client as never;
    });
    const nativeCoordinator = {
      isActive: jest.fn(() => false),
      start: jest.fn(),
      stop: jest.fn().mockResolvedValue(undefined),
    } as unknown as NativeMeshCoreSessionCoordinator;

    const service = new AppRadioConnectionService({
      createBleManager,
      createMeshCoreClient,
      requestPermissions: jest.fn().mockResolvedValue(true),
      discoverBle: jest.fn().mockResolvedValue({
        serviceFound: true,
        rxFound: true,
        txFound: true,
      }),
      nativeCoordinator,
      nativeSupported: () => false,
      getNativeStatus: jest.fn(),
    });

    return {
      service,
      device,
      manager,
      client,
      createBleManager,
      createMeshCoreClient,
      getClientEvents: () => clientEvents,
    };
  }

  it('keeps the connection alive while Device UI subscribers unmount and remount', async () => {
    const {service, device, client, createBleManager, createMeshCoreClient} = createHarness();
    await service.initialize();
    await service.connectToDevice(device);

    const firstUi = jest.fn();
    const unsubscribe = service.subscribe(firstUi);
    unsubscribe();

    expect(service.getSnapshot().status).toBe('Connected');
    expect(client.stop).not.toHaveBeenCalled();

    const secondUi = jest.fn();
    const unsubscribeSecond = service.subscribe(secondUi);
    expect(service.getSnapshot().connectedDeviceAddress).toBe(device.id);
    expect(createBleManager).toHaveBeenCalledTimes(1);
    expect(createMeshCoreClient).toHaveBeenCalledTimes(1);

    unsubscribeSecond();
    await service.dispose();
  });

  it('does not create duplicate BLE managers or clients across repeated navigation subscriptions', async () => {
    const {service, device, createBleManager, createMeshCoreClient} = createHarness();
    await service.initialize();
    await service.connectToDevice(device);

    for (let index = 0; index < 8; index += 1) {
      const unsubscribe = service.subscribe(jest.fn());
      unsubscribe();
    }

    expect(createBleManager).toHaveBeenCalledTimes(1);
    expect(createMeshCoreClient).toHaveBeenCalledTimes(1);
    await service.dispose();
  });

  it('explicit disconnect stops the client and closes the physical BLE connection', async () => {
    const {service, device, manager, client} = createHarness();
    await service.initialize();
    await service.connectToDevice(device);

    await service.disconnect();

    expect(client.stop).toHaveBeenCalledTimes(1);
    expect(manager.cancelDeviceConnection).toHaveBeenCalledWith(device.id);
    expect(service.getSnapshot().status).toBe('Disconnected');
    expect(service.getSnapshot().connectedDeviceAddress).toBeNull();
    await service.dispose();
  });

  it('keeps one client through reconnect state changes instead of recreating ownership', async () => {
    const {service, device, createMeshCoreClient, getClientEvents} = createHarness();
    await service.initialize();
    await service.connectToDevice(device);

    getClientEvents()?.onConnectionState?.('reconnecting', 'retrying BLE');
    expect(service.getSnapshot().status).toBe('Connecting');
    expect(service.getSnapshot().connectedDeviceAddress).toBe(device.id);

    getClientEvents()?.onConnectionState?.('connected', 'BLE recovered');
    expect(service.getSnapshot().status).toBe('Connected');
    expect(createMeshCoreClient).toHaveBeenCalledTimes(1);
    await service.dispose();
  });

  it('provider-style teardown disposes owned resources exactly once', async () => {
    const {service, device, manager, client} = createHarness();
    await service.initialize();
    await service.connectToDevice(device);

    await service.dispose();
    await service.dispose();

    expect(client.stop).toHaveBeenCalledTimes(1);
    expect(manager.stopDeviceScan).toHaveBeenCalledTimes(2);
    expect(manager.destroy).toHaveBeenCalledTimes(1);
  });
});
