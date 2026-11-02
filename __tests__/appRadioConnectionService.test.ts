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

type ScanCallback = (error: Error | null, device: Device | null) => void;

describe('AppRadioConnectionService', () => {
  function createHarness(options: {
    nativeSupported?: boolean;
    requestPermissions?: () => Promise<boolean>;
  } = {}) {
    const device = fakeDevice();
    const scanCallbacks: ScanCallback[] = [];
    const manager = {
      startDeviceScan: jest.fn(
        (_uuids: unknown, _options: unknown, callback: ScanCallback) => {
          scanCallbacks.push(callback);
        },
      ),
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
    const nativeSession = {
      sendAppStart: jest.fn().mockResolvedValue({}),
      sendDeviceQuery: jest.fn().mockResolvedValue({}),
      probeChannels: jest.fn().mockResolvedValue([]),
      sendChannelMessage: jest.fn().mockResolvedValue({}),
      getBatteryStatus: jest.fn().mockResolvedValue({parsed: {}}),
      syncContacts: jest.fn().mockResolvedValue([]),
      syncQueuedMessages: jest.fn().mockResolvedValue([]),
      getChannel: jest.fn().mockResolvedValue({}),
      stop: jest.fn().mockResolvedValue(undefined),
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
      start: jest.fn().mockResolvedValue(nativeSession),
      stop: jest.fn().mockResolvedValue(undefined),
    } as unknown as NativeMeshCoreSessionCoordinator;
    const requestPermissions =
      options.requestPermissions ?? jest.fn().mockResolvedValue(true);

    const service = new AppRadioConnectionService({
      createBleManager,
      createMeshCoreClient,
      requestPermissions,
      discoverBle: jest.fn().mockResolvedValue({
        serviceFound: true,
        rxFound: true,
        txFound: true,
      }),
      nativeCoordinator,
      nativeSupported: () => options.nativeSupported ?? false,
      getNativeStatus: jest.fn(),
    });

    return {
      service,
      device,
      manager,
      client,
      nativeSession,
      nativeCoordinator,
      scanCallbacks,
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

  it('keeps repeated scans on one live manager and ignores callbacks from superseded scans', async () => {
    jest.useFakeTimers();
    try {
      const {service, manager, scanCallbacks, createBleManager} = createHarness();
      await service.initialize();
      await service.startScan();
      expect(scanCallbacks).toHaveLength(1);
      scanCallbacks[0](null, fakeDevice('FIRST'));
      expect(service.getSnapshot().devices.map(item => item.id)).toEqual(['FIRST']);

      await service.startScan();
      expect(scanCallbacks).toHaveLength(2);
      expect(createBleManager).toHaveBeenCalledTimes(1);
      scanCallbacks[0](new Error('stale scan error'), null);
      expect(service.getSnapshot().status).toBe('Scanning');
      scanCallbacks[1](null, fakeDevice('SECOND'));
      expect(service.getSnapshot().devices.map(item => item.id)).toEqual(['SECOND']);

      const stopsBeforeDispose = manager.stopDeviceScan.mock.calls.length;
      await service.dispose();
      const stopsAfterDispose = manager.stopDeviceScan.mock.calls.length;
      expect(stopsAfterDispose).toBe(stopsBeforeDispose + 1);
      expect(() => scanCallbacks[1](new Error('late native callback'), null)).not.toThrow();
      jest.runOnlyPendingTimers();
      expect(manager.stopDeviceScan).toHaveBeenCalledTimes(stopsAfterDispose);
      expect(manager.destroy).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not resume a pending scan after the application manager is disposed', async () => {
    let grantPermissions!: (granted: boolean) => void;
    const permissions = new Promise<boolean>(resolve => {
      grantPermissions = resolve;
    });
    const {service, manager} = createHarness({
      requestPermissions: () => permissions,
    });
    await service.initialize();

    const scan = service.startScan();
    await Promise.resolve();
    await service.dispose();
    grantPermissions(true);
    await scan;

    expect(manager.startDeviceScan).not.toHaveBeenCalled();
    expect(manager.destroy).toHaveBeenCalledTimes(1);
  });

  it('hands a discovered device directly to Android without opening a JS GATT connection', async () => {
    jest.useFakeTimers();
    try {
      const {
        service,
        device,
        manager,
        nativeCoordinator,
        nativeSession,
        scanCallbacks,
      } = createHarness({nativeSupported: true});
      await service.initialize();
      await service.startScan();
      scanCallbacks[0](null, device);

      await service.handoffDiscoveredDeviceToAndroid(device);

      expect(manager.connectToDevice).not.toHaveBeenCalled();
      expect(manager.cancelDeviceConnection).not.toHaveBeenCalled();
      expect(manager.stopDeviceScan).toHaveBeenCalled();
      expect(nativeCoordinator.start).toHaveBeenCalledWith(
        device.id,
        device.name,
        expect.any(Object),
      );
      const stopOrders = (manager.stopDeviceScan as jest.Mock).mock
        .invocationCallOrder;
      expect(stopOrders[stopOrders.length - 1]).toBeLessThan(
        (nativeCoordinator.start as jest.Mock).mock.invocationCallOrder[0],
      );
      expect(nativeSession.probeChannels).toHaveBeenCalled();
      expect(service.getSnapshot().connectionOwner).toBe('android-native');
      expect(service.getSnapshot().status).toBe('Connected');
      await service.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it('provider-style teardown disposes owned resources exactly once', async () => {
    const {service, device, manager, client} = createHarness();
    await service.initialize();
    await service.connectToDevice(device);

    await service.dispose();
    await service.dispose();

    expect(client.stop).toHaveBeenCalledTimes(1);
    expect(manager.destroy).toHaveBeenCalledTimes(1);
  });
});