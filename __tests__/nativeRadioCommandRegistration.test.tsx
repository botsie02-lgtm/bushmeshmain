import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Device} from 'react-native-ble-plx';

import {NativeMeshCoreSession} from '../src/meshcore/NativeMeshCoreSession';
import {NativeMeshCoreSessionCoordinator} from '../src/meshcore/NativeMeshCoreSessionCoordinator';
import {AppRadioConnectionService} from '../src/radio/AppRadioConnectionService';
import {BushMeshProvider, useBushMesh} from '../src/state/BushMeshContext';
import {RadioConnectionProvider} from '../src/state/RadioConnectionContext';
import {releasedNativeOwnerStatus} from './testNativeOwnerStatus';

const device = {id: 'AA:BB:CC:DD:EE:FF', name: 'Heltec A'} as Device;
const deviceInfo = {
  firmwareVersion: 9, maxChannels: 8, maxContacts: 32, blePin: null,
  firmwareBuild: 'test', model: 'Heltec', version: 'test',
  clientRepeat: 1, pathHashMode: null,
};

describe('native radio send handler survives optional startup synchronization failure', () => {
  it('registers a usable handler only after exact coordinator/session ownership is active', async () => {
    const nativeSession = {
      sendAppStart: jest.fn(async () => ({selfInfo: null})),
      sendDeviceQuery: jest.fn(async () => ({deviceInfo})),
      getDeviceInfo: jest.fn(async () => deviceInfo),
      readChannel: jest.fn(async () => {throw new Error('CMD_GET_CHANNEL timed out');}),
      getBatteryStatus: jest.fn(async () => ({parsed: {batteryInfo: null}})),
      syncContacts: jest.fn(async () => []),
      sendChannelMessage: jest.fn(async () => ({packetType: 0x00})),
    } as unknown as NativeMeshCoreSession;
    let owned = false;
    const coordinator = {
      isActive: jest.fn(() => owned),
      start: jest.fn(async () => {owned = true; return nativeSession;}),
      stop: jest.fn(async () => {owned = false;}),
      getSession: jest.fn(() => owned ? nativeSession : null),
      getSnapshot: jest.fn(() => ({
        state: owned ? 'active' : 'idle',
        deviceAddress: owned ? device.id : null,
        deviceLabel: owned ? device.name : null,
        statusMessage: null, errorMessage: null, lastFrame: null,
      })),
    } as unknown as NativeMeshCoreSessionCoordinator;
    const manager = {
      startDeviceScan: jest.fn(),
      stopDeviceScan: jest.fn(),
      connectToDevice: jest.fn(),
      cancelDeviceConnection: jest.fn(),
      destroy: jest.fn(),
    };
    const service = new AppRadioConnectionService({
      createBleManager: () => manager as never,
      createMeshCoreClient: jest.fn() as never,
      requestPermissions: jest.fn(async () => true),
      discoverBle: jest.fn() as never,
      nativeCoordinator: coordinator,
      nativeSupported: () => true,
      getNativeStatus: jest.fn(async () => releasedNativeOwnerStatus()),
    });
    let meshContext: ReturnType<typeof useBushMesh> | null = null;
    function Probe(): null {
      meshContext = useBushMesh();
      return null;
    }
    function currentContext(): ReturnType<typeof useBushMesh> {
      if (!meshContext) throw new Error('BushMesh context probe has not mounted.');
      return meshContext;
    }
    let renderer: ReactTestRenderer.ReactTestRenderer | null = null;
    try {
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <BushMeshProvider>
            <RadioConnectionProvider service={service}>
              <Probe/>
            </RadioConnectionProvider>
          </BushMeshProvider>,
        );
        await Promise.resolve();
      });
      expect(currentContext().canSendChannelMessage).toBe(false);
      await ReactTestRenderer.act(async () => {
        await service.handoffDiscoveredDeviceToAndroid(device);
        await Promise.resolve();
      });
      expect(service.getSnapshot().connectionOwner).toBe('android-native');
      expect(service.getSnapshot().status).toBe('Connected');
      expect(service.hasUsableSendSession()).toBe(true);
      expect(currentContext().canSendChannelMessage).toBe(true);
      await ReactTestRenderer.act(async () => {
        await currentContext().sendChannelMessage(4, 'A TO B NATIVE LIVE');
      });
      expect(nativeSession.sendChannelMessage).toHaveBeenCalledWith(
        4, 'A TO B NATIVE LIVE',
      );
      expect(manager.connectToDevice).not.toHaveBeenCalled();
    } finally {
      await ReactTestRenderer.act(async () => {renderer?.unmount();});
    }
  });
});
