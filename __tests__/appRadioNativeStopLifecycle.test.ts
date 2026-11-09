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

function activeNativeStatus(): NativeRadioServiceStatus {
  return {
    ...releasedNativeStatus(), running: true, radioRequested: true,
    deviceLabel: 'Test Heltec', deviceAddress: 'AA:BB:CC:DD:EE:FF',
    ownership: 'native-service', nativeBleState: 'ready',
    nativeBleDeviceAddress: 'AA:BB:CC:DD:EE:FF',
    nativeBleDeviceLabel: 'Test Heltec', nativeBleMtu: 185,
    persistedNativeTargetPresent: true,
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
    sendChannelMessage: jest.fn().mockResolvedValue({packetType: 0x00}),
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
  const getNativeStatus = jest.fn().mockResolvedValue(releasedNativeStatus());
  const stopNativeRadio = jest.fn().mockResolvedValue(true);
  const waitForNativeShutdown = jest.fn().mockResolvedValue(releasedNativeStatus());
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
    getNativeStatus,
    stopNativeRadio,
    waitForNativeShutdown,
  });

  return {
    service,
    device,
    manager,
    client,
    nativeSession,
    nativeCoordinator,
    getNativeStatus,
    stopNativeRadio,
    waitForNativeShutdown,
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
  it('keeps native ownership and a usable send session after a post-connect channel sync error', async () => {
    const {service, device, manager, nativeSession} = createHarness();
    (nativeSession.readChannel as jest.Mock).mockRejectedValueOnce(
      new Error('CMD_GET_CHANNEL timed out'),
    );
    await service.initialize();
    await service.handoffDiscoveredDeviceToAndroid(device);
    expect(service.getSnapshot()).toMatchObject({
      status: 'Connected',
      connectionOwner: 'android-native',
      connectedDeviceAddress: device.id,
    });
    expect(service.hasUsableSendSession()).toBe(true);
    await service.sendChannelMessage(4, 'A TO B FROM NATIVE');
    expect(nativeSession.sendChannelMessage).toHaveBeenCalledWith(4, 'A TO B FROM NATIVE');
    expect(manager.connectToDevice).not.toHaveBeenCalled();
    await service.disconnect();
    await service.dispose();
  });

  it('retains send ownership if optional contact enumeration fails after radio startup', async () => {
    const {service, device, nativeSession} = createHarness();
    (nativeSession.syncContacts as jest.Mock).mockRejectedValueOnce(
      new Error('CMD_GET_CONTACTS timed out'),
    );
    await service.initialize();
    await service.handoffDiscoveredDeviceToAndroid(device);
    expect(service.getSnapshot().status).toBe('Connected');
    expect(service.getSnapshot().connectionOwner).toBe('android-native');
    expect(service.hasUsableSendSession()).toBe(true);
    await service.sendChannelMessage(4, 'NATIVE TX');
    await service.disconnect();
    await service.dispose();
  });

  it('recovers an active coordinator session from ERROR/no BLE owner without creating another GATT owner', async () => {
    const {service, device, manager, nativeSession, nativeCoordinator, getNativeStatus} = createHarness();
    await service.initialize();
    await service.handoffDiscoveredDeviceToAndroid(device);
    getNativeStatus.mockResolvedValue(activeNativeStatus());
    const coordinator = nativeCoordinator as NativeMeshCoreSessionCoordinator & {
      getSession: jest.Mock;
      getSnapshot: jest.Mock;
    };
    let owned = true;
    coordinator.getSession = jest.fn(() => owned ? nativeSession : null);
    coordinator.getSnapshot = jest.fn(() => ({
      state: owned ? 'active' as const : 'idle' as const,
      deviceAddress: owned ? device.id : null,
      deviceLabel: owned ? 'Test Heltec' : null,
      statusMessage: null,
      errorMessage: null,
      lastFrame: null,
    }));
    (nativeCoordinator.stop as jest.Mock).mockImplementation(async () => {owned = false;});
    const internals = service as unknown as {
      snapshot: ReturnType<typeof service.getSnapshot>;
      nativeSession: NativeMeshCoreSession | null;
    };
    internals.snapshot = {...internals.snapshot, status: 'Error', connectionOwner: 'none'};
    internals.nativeSession = null;

    expect(service.hasUsableSendSession()).toBe(false);
    expect(await service.recoverNativeCommandSession()).toBe(true);
    expect(service.getSnapshot().connectionOwner).toBe('android-native');
    await service.sendChannelMessage(4, 'RECOVERED NATIVE TX');
    expect(nativeSession.sendChannelMessage).toHaveBeenCalledWith(4, 'RECOVERED NATIVE TX');
    expect(nativeCoordinator.start).toHaveBeenCalledTimes(1);
    expect(manager.connectToDevice).not.toHaveBeenCalled();
    getNativeStatus.mockResolvedValue(releasedNativeStatus());
    await service.disconnect();
    await service.dispose();
  });

  it('Stop succeeds with app owner none but live native coordinator, then BLE Tools may connect', async () => {
    const {service, device, manager, nativeCoordinator, getNativeStatus} = createHarness();
    await service.initialize();
    await service.handoffDiscoveredDeviceToAndroid(device);
    const internals = service as unknown as {
      snapshot: ReturnType<typeof service.getSnapshot>;
    };
    internals.snapshot = {...internals.snapshot, status: 'Error', connectionOwner: 'none'};
    getNativeStatus.mockResolvedValue(activeNativeStatus());
    // Stop dispatch is requested by coordinator; status release is observed.
    (nativeCoordinator.stop as jest.Mock).mockImplementation(async () => {
      getNativeStatus.mockResolvedValue(releasedNativeStatus());
    });

    await service.disconnect();
    expect(nativeCoordinator.stop).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().connectionOwner).toBe('none');
    await service.connectToDevice(device);
    expect(manager.connectToDevice).toHaveBeenCalledTimes(1);
    await service.disconnect();
    await service.dispose();
  });

  it('stops Android from service evidence when the coordinator and app have lost their session', async () => {
    const {service, device, manager, nativeCoordinator, getNativeStatus,
      stopNativeRadio, waitForNativeShutdown} = createHarness();
    await service.initialize();
    getNativeStatus.mockResolvedValue(activeNativeStatus());
    await expect(service.connectToDevice(device)).rejects.toThrow(/Android still owns/i);
    expect(manager.connectToDevice).not.toHaveBeenCalled();

    await service.disconnect();
    expect(nativeCoordinator.stop).not.toHaveBeenCalled();
    expect(stopNativeRadio).toHaveBeenCalledTimes(1);
    expect(waitForNativeShutdown).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().connectionOwner).toBe('none');
    getNativeStatus.mockResolvedValue(releasedNativeStatus());
    await service.connectToDevice(device);
    expect(manager.connectToDevice).toHaveBeenCalledWith(device.id);
    await service.disconnect();
    await service.dispose();
  });

  it('failed Android shutdown acknowledgement remains error/retryable until persisted owner is released', async () => {
    const {service, nativeCoordinator, getNativeStatus, stopNativeRadio,
      waitForNativeShutdown} = createHarness();
    await service.initialize();
    getNativeStatus.mockResolvedValue(activeNativeStatus());
    waitForNativeShutdown.mockRejectedValueOnce(new Error('persisted target still present'));
    await expect(service.disconnect()).rejects.toThrow(/persisted target still present/);
    expect(service.getSnapshot()).toMatchObject({
      status: 'Error',
      connectionOwner: 'android-native',
      isWriting: false,
    });
    expect(nativeCoordinator.stop).not.toHaveBeenCalled();
    await service.disconnect();
    expect(stopNativeRadio).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot().connectionOwner).toBe('none');
    await service.dispose();
  });

  it('never tears down unrelated JS BLE owner when Android status unexpectedly claims native ownership', async () => {
    const {service, device, manager, getNativeStatus, stopNativeRadio} = createHarness();
    await service.initialize();
    await service.connectToDevice(device);
    getNativeStatus.mockResolvedValue(activeNativeStatus());
    await expect(service.disconnect()).rejects.toThrow(/Conflicting native and React Native/i);
    expect(stopNativeRadio).not.toHaveBeenCalled();
    expect(manager.cancelDeviceConnection).not.toHaveBeenCalled();
    getNativeStatus.mockResolvedValue(releasedNativeStatus());
    await service.disconnect();
    await service.dispose();
  });

  it('fails closed rather than opening JS GATT when Android status cannot be read', async () => {
    const {service, device, manager, getNativeStatus} = createHarness();
    getNativeStatus.mockRejectedValue(new Error('Native bridge status unavailable'));
    await expect(service.connectToDevice(device)).rejects.toThrow(/verify Android radio ownership/i);
    expect(manager.connectToDevice).not.toHaveBeenCalled();
    expect(service.getSnapshot().connectionOwner).toBe('none');
  });

  it('does not start Android GATT takeover when native ownership is unknown', async () => {
    const {service, device, nativeCoordinator, getNativeStatus} = createHarness();
    getNativeStatus.mockRejectedValue(new Error('Native bridge status unavailable'));
    await service.handoffDiscoveredDeviceToAndroid(device);
    expect(nativeCoordinator.start).not.toHaveBeenCalled();
    expect(service.getSnapshot()).toMatchObject({
      connectionOwner: 'none',
      status: 'Error',
    });
    expect(service.getSnapshot().statusDetail).toMatch(/verify Android radio ownership/i);
  });

  it('keeps ambiguous orphan native Stop retryable until Android status can be queried', async () => {
    const {service, getNativeStatus, stopNativeRadio, waitForNativeShutdown} = createHarness();
    getNativeStatus.mockRejectedValueOnce(new Error('Android status binder unavailable'));
    await expect(service.disconnect()).rejects.toThrow(/Stop is not confirmed/i);
    expect(stopNativeRadio).not.toHaveBeenCalled();
    expect(service.getSnapshot().status).toBe('Error');

    getNativeStatus.mockResolvedValue(activeNativeStatus());
    await service.disconnect();
    expect(stopNativeRadio).toHaveBeenCalledTimes(1);
    expect(waitForNativeShutdown).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().connectionOwner).toBe('none');
  });

});