import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  NativeMeshCoreOwnershipSnapshot,
  nativeMeshCoreSessionCoordinator,
} from '../src/meshcore/NativeMeshCoreSessionCoordinator';
import {
  NativeRadioServiceStatus,
  nativeRadioService,
} from '../src/native/NativeRadioService';
import {bushMeshRadioSession} from '../src/radio/BushMeshRadioSession';
import {BushMeshProvider} from '../src/state/BushMeshContext';
import {
  RadioSessionProvider,
  decideRadioSessionNativeLifecycle,
  syncNativeRuntimeForRadioSessionProvider,
} from '../src/state/RadioSessionContext';

function nativeStatus(
  overrides: Partial<NativeRadioServiceStatus> = {},
): NativeRadioServiceStatus {
  return {
    running: true,
    radioRequested: true,
    locationRequested: false,
    deviceLabel: 'Authority Heltec',
    deviceAddress: 'AA:BB:CC:DD:EE:FF',
    startedAtMs: 100,
    ownership: 'native-service',
    nativeBleState: 'ready',
    nativeBleDeviceAddress: 'AA:BB:CC:DD:EE:FF',
    nativeBleDeviceLabel: 'Authority Heltec',
    nativeBleMtu: 185,
    nativeBleReconnectAttempt: 0,
    nativeBleConnectedAtMs: 100,
    nativeBleLastError: null,
    nativeBleQueuedWrites: 0,
    nativeBleBufferedFrames: 0,
    persistedNativeTargetPresent: true,
    ...overrides,
  };
}

function reactNativeStatus(
  overrides: Partial<NativeRadioServiceStatus> = {},
): NativeRadioServiceStatus {
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
    ...overrides,
  };
}

function ownershipSnapshot(
  state: NativeMeshCoreOwnershipSnapshot['state'],
): NativeMeshCoreOwnershipSnapshot {
  return {
    state,
    deviceAddress:
      state === 'idle' ? null : 'AA:BB:CC:DD:EE:FF',
    deviceLabel: state === 'idle' ? null : 'Authority Heltec',
    statusMessage: null,
    errorMessage: null,
    lastFrame: null,
  };
}

function createLifecycleHarness(initial: NativeRadioServiceStatus) {
  let current = {...initial};
  const getStatus = jest.fn(async () => ({...current}));
  const start = jest.fn(async (_label: string | null) => {
    current = reactNativeStatus({
      running: true,
      radioRequested: true,
      startedAtMs: 200,
    });
    return true;
  });
  const stop = jest.fn(async () => {
    current = reactNativeStatus();
    return true;
  });
  const service = {getStatus, start, stop};
  const coordinator = {
    getSnapshot: jest.fn(() => ownershipSnapshot('idle')),
  };

  return {service, coordinator, getStatus, start, stop};
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('RadioSessionProvider native lifecycle authority', () => {
  it('classifies native-service and coordinator transitions as observation-only', () => {
    expect(
      decideRadioSessionNativeLifecycle(
        false,
        nativeStatus(),
        'idle',
      ),
    ).toBe('observe-native-owner');
    expect(
      decideRadioSessionNativeLifecycle(
        true,
        nativeStatus(),
        'idle',
      ),
    ).toBe('observe-native-owner');

    for (const state of ['taking-over', 'active', 'stopping', 'error'] as const) {
      expect(
        decideRadioSessionNativeLifecycle(
          false,
          reactNativeStatus(),
          state,
        ),
      ).toBe('observe-native-owner');
      expect(
        decideRadioSessionNativeLifecycle(
          true,
          reactNativeStatus(),
          state,
        ),
      ).toBe('observe-native-owner');
    }
  });

  it('active native-service observation performs no START or STOP command', async () => {
    const {service, coordinator, start, stop} = createLifecycleHarness(
      nativeStatus(),
    );

    const whileRequested = await syncNativeRuntimeForRadioSessionProvider(
      true,
      service,
      coordinator,
    );
    const afterTransportRelease = await syncNativeRuntimeForRadioSessionProvider(
      false,
      service,
      coordinator,
    );

    expect(whileRequested.ownership).toBe('native-service');
    expect(afterTransportRelease.ownership).toBe('native-service');
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('explicit native stop cannot be raced after the BushMesh transport is released', async () => {
    const {service, coordinator, start, stop} = createLifecycleHarness(
      nativeStatus(),
    );
    coordinator.getSnapshot.mockReturnValue(ownershipSnapshot('stopping'));

    const observed = await syncNativeRuntimeForRadioSessionProvider(
      false,
      service,
      coordinator,
    );

    expect(observed).toMatchObject({
      ownership: 'native-service',
      radioRequested: true,
      deviceAddress: 'AA:BB:CC:DD:EE:FF',
    });
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not resurrect a native owner that is reconnecting while explicit stop is in progress', async () => {
    const reconnecting = nativeStatus({
      nativeBleState: 'reconnecting',
      nativeBleReconnectAttempt: 3,
      nativeBleConnectedAtMs: 0,
    });
    const {service, coordinator, start, stop} =
      createLifecycleHarness(reconnecting);
    coordinator.getSnapshot.mockReturnValue(ownershipSnapshot('stopping'));

    const observed = await syncNativeRuntimeForRadioSessionProvider(
      false,
      service,
      coordinator,
    );

    expect(observed.nativeBleState).toBe('reconnecting');
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('reserves a persisted native target while Android restores process recovery state', async () => {
    const recovered = reactNativeStatus({
      persistedNativeTargetPresent: true,
    });
    const {service, coordinator, start, stop} = createLifecycleHarness(recovered);

    const observed = await syncNativeRuntimeForRadioSessionProvider(
      false,
      service,
      coordinator,
    );

    expect(observed).toMatchObject({
      ownership: 'react-native-session',
      radioRequested: false,
      deviceAddress: null,
      nativeBleDeviceAddress: null,
      persistedNativeTargetPresent: true,
    });
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('preserves legacy React-Native-owned service start and stop behavior', async () => {
    const {service, coordinator, start, stop} = createLifecycleHarness(
      reactNativeStatus(),
    );

    const started = await syncNativeRuntimeForRadioSessionProvider(
      true,
      service,
      coordinator,
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(null);
    expect(stop).not.toHaveBeenCalled();
    expect(started).toMatchObject({
      ownership: 'react-native-session',
      radioRequested: true,
    });

    const stopped = await syncNativeRuntimeForRadioSessionProvider(
      false,
      service,
      coordinator,
    );
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stopped).toMatchObject({
      ownership: 'react-native-session',
      radioRequested: false,
    });
  });

  it('transport release and ordinary provider rerenders cannot command an active native owner', async () => {
    const owner = {};
    const getStatus = jest
      .spyOn(nativeRadioService, 'getStatus')
      .mockResolvedValue(nativeStatus());
    const start = jest
      .spyOn(nativeRadioService, 'start')
      .mockResolvedValue(true);
    const stop = jest.spyOn(nativeRadioService, 'stop').mockResolvedValue(true);
    const getCoordinatorSnapshot = jest
      .spyOn(nativeMeshCoreSessionCoordinator, 'getSnapshot')
      .mockReturnValue(ownershipSnapshot('active'));

    bushMeshRadioSession.claimTransport(owner, async () => undefined);

    const app = (marker: string) => (
      <BushMeshProvider>
        <RadioSessionProvider>
          <React.Fragment key={marker} />
        </RadioSessionProvider>
      </BushMeshProvider>
    );

    let renderer: ReactTestRenderer.ReactTestRenderer | null = null;
    try {
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(app('first'));
        await flushEffects();
      });

      start.mockClear();
      stop.mockClear();
      getStatus.mockClear();

      await ReactTestRenderer.act(async () => {
        renderer!.update(app('rerender'));
        await flushEffects();
      });

      expect(start).not.toHaveBeenCalled();
      expect(stop).not.toHaveBeenCalled();

      getCoordinatorSnapshot.mockReturnValue(ownershipSnapshot('stopping'));
      await ReactTestRenderer.act(async () => {
        expect(bushMeshRadioSession.releaseTransport(owner)).toBe(true);
        await flushEffects();
      });

      expect(getStatus).toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
      expect(stop).not.toHaveBeenCalled();
    } finally {
      bushMeshRadioSession.releaseTransport(owner);
      if (renderer) {
        await ReactTestRenderer.act(async () => {
          renderer!.unmount();
          await flushEffects();
        });
      }
      getCoordinatorSnapshot.mockRestore();
      getStatus.mockRestore();
      start.mockRestore();
      stop.mockRestore();
    }
  });
});
