import {Device} from 'react-native-ble-plx';
import * as chatPreferences from '../src/radio/chatManagement/chatPreferences';

import {AppRadioConnectionService} from '../src/radio/AppRadioConnectionService';
import {releasedNativeOwnerStatus} from './testNativeOwnerStatus';
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
      randomBytes: async length => new Uint8Array(length).fill(7),
      getNativeStatus: jest.fn().mockResolvedValue(releasedNativeOwnerStatus()),
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
      expect(nativeSession.readChannel).toHaveBeenCalledTimes(2);
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

  describe('guarded messenger management', () => {
    async function chatHarness() {
      const harness = createHarness();
      const {service, client, device} = harness;
      client.sendAppStart.mockResolvedValue({selfInfo: {publicKeyHex: 'a'.repeat(64)}});
      const channels = [emptyChannel(0), emptyChannel(1)];
      const ids = new Map<string, string>();
      jest.spyOn(chatPreferences, 'configurationId').mockImplementation(async (...args) => {
        const key = JSON.stringify(args);
        if (!ids.has(key)) ids.set(key, (ids.size + 1).toString(16).padStart(64, '0'));
        return ids.get(key)!;
      });
      jest.spyOn(chatPreferences.chatPreferenceStore, 'load').mockResolvedValue({});
      const provenance = jest.spyOn(chatPreferences.chatPreferenceStore, 'recordProvisioned')
        .mockResolvedValue({});
      const forget = jest.spyOn(chatPreferences.chatPreferenceStore, 'forget').mockResolvedValue({});
      client.readChannel.mockImplementation(async slot => ({
        ...channels[slot], secret: Uint8Array.from(channels[slot].secret),
      }));
      client.writeChannel.mockImplementation(async (slot: number, name: string, secret: Uint8Array) => {
        channels[slot] = {channelIndex: slot, channelName: name,
          secret: Uint8Array.from(secret), empty: name === '' && secret.every(b => b === 0)};
      });
      await service.initialize();
      await service.connectToDevice(device);
      const radio = service.getChatRadio();
      if (!radio) throw new Error('Missing test radio identity');
      return {...harness, radio, channels, provenance, forget};
    }

    afterEach(() => jest.restoreAllMocks());

    it('creates and joins verified empty slots, without exposing PSKs in list results', async () => {
      const {service, radio, provenance, client} = await chatHarness();
      const created = await service.provisionChat(radio, {name: 'Created'});
      const joined = await service.provisionChat(radio, {name: 'Joined', secretHex: 'ab'.repeat(16)});
      expect(created.slot).toBe(0);
      expect(joined.slot).toBe(1);
      expect(provenance).toHaveBeenNthCalledWith(1, created.id, true);
      expect(provenance).toHaveBeenNthCalledWith(2, joined.id, false);
      expect(await service.listChatConfigurations(radio)).toEqual([created, joined]);
      expect(JSON.stringify(service.getSnapshot().channels)).not.toContain('AB'.repeat(16));
      await expect(service.provisionChat(radio, {name: 'Full'})).rejects.toThrow();
      expect(client.writeChannel).toHaveBeenCalledTimes(2);
      await service.dispose();
    });

    it('refuses a slot that becomes occupied after empty-slot selection', async () => {
      const {service, radio, client, provenance, channels} = await chatHarness();
      client.readChannel.mockImplementationOnce(async slot => {
        const empty = emptyChannel(slot);
        channels[slot] = {channelIndex: slot, channelName: 'Other',
          secret: new Uint8Array(16).fill(3), empty: false};
        return empty;
      });
      await expect(service.provisionChat(radio, {name: 'Mine'})).rejects.toThrow('no longer empty');
      expect(client.writeChannel).not.toHaveBeenCalled();
      expect(provenance).not.toHaveBeenCalled();
      await service.dispose();
    });

    it('refuses stale same-name slots for leave and credential sharing', async () => {
      const {service, radio, channels, client, forget} = await chatHarness();
      const chat = await service.provisionChat(radio, {name: 'Chat'});
      channels[chat.slot].secret = new Uint8Array(16).fill(8);
      await expect(service.revealChatCredential(chat)).rejects.toThrow('changed');
      await expect(service.leaveChat(chat)).rejects.toThrow('changed');
      expect(client.writeChannel).toHaveBeenCalledTimes(1);
      expect(forget).not.toHaveBeenCalled();
      await service.dispose();
    });

    it('cancels provisioning after transient disconnect even if the same session reconnects', async () => {
      const {service, radio, client, provenance, getClientEvents} = await chatHarness();
      client.readChannel.mockImplementationOnce(async slot => {
        getClientEvents()?.onConnectionState?.('reconnecting', 'test reconnect');
        getClientEvents()?.onConnectionState?.('connected', 'test recovered');
        return emptyChannel(slot);
      });
      await expect(service.provisionChat(radio, {name: 'Chat'})).rejects.toThrow('session changed');
      expect(client.writeChannel).not.toHaveBeenCalled();
      expect(provenance).not.toHaveBeenCalled();
      await service.dispose();
    });

    it('does not claim creator when firmware readback fails', async () => {
      const {service, radio, client, provenance} = await chatHarness();
      client.writeChannel.mockResolvedValueOnce(undefined);
      await expect(service.provisionChat(radio, {name: 'Chat'})).rejects.toThrow('did not verify');
      expect(provenance).not.toHaveBeenCalled();
      await service.dispose();
    });

    it('clears only the matching slot after verification', async () => {
      const {service, radio, channels, forget} = await chatHarness();
      const first = await service.provisionChat(radio, {name: 'First'});
      const second = await service.provisionChat(radio, {name: 'Second'});
      expect(await service.revealChatCredential(first)).toBe('07'.repeat(16));
      await service.leaveChat(first);
      expect(channels[first.slot].empty).toBe(true);
      expect(channels[second.slot].channelName).toBe('Second');
      expect(forget).toHaveBeenCalledWith(first.id);
      await service.dispose();
    });
  });
});