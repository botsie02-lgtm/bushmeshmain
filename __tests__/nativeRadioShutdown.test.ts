import {NativeMeshCoreFrameTransport} from '../src/meshcore/NativeMeshCoreFrameTransport';
import {
  NativeMeshCoreOwnershipSnapshot,
  NativeMeshCoreSessionCoordinator,
} from '../src/meshcore/NativeMeshCoreSessionCoordinator';
import {NativeMeshCoreSession} from '../src/meshcore/NativeMeshCoreSession';
import {
  NativeRadioServiceStatus,
  isNativeRadioShutdownConfirmed,
  nativeRadioService,
  waitForNativeRadioShutdown,
} from '../src/native/NativeRadioService';

function activeStatus(
  overrides: Partial<NativeRadioServiceStatus> = {},
): NativeRadioServiceStatus {
  return {
    running: true,
    radioRequested: true,
    locationRequested: false,
    deviceLabel: 'Test Heltec',
    deviceAddress: 'AA:BB:CC:DD:EE:FF',
    startedAtMs: 1,
    ownership: 'native-service',
    nativeBleState: 'ready',
    nativeBleDeviceAddress: 'AA:BB:CC:DD:EE:FF',
    nativeBleDeviceLabel: 'Test Heltec',
    nativeBleMtu: 185,
    nativeBleReconnectAttempt: 0,
    nativeBleConnectedAtMs: 1,
    nativeBleLastError: null,
    nativeBleQueuedWrites: 0,
    nativeBleBufferedFrames: 0,
    persistedNativeTargetPresent: true,
    ...overrides,
  };
}

function releasedStatus(
  overrides: Partial<NativeRadioServiceStatus> = {},
): NativeRadioServiceStatus {
  return activeStatus({
    running: false,
    radioRequested: false,
    deviceLabel: null,
    deviceAddress: null,
    startedAtMs: 0,
    ownership: 'react-native-session',
    nativeBleState: 'disconnected',
    nativeBleDeviceAddress: null,
    nativeBleDeviceLabel: null,
    nativeBleMtu: 0,
    nativeBleConnectedAtMs: 0,
    persistedNativeTargetPresent: false,
    ...overrides,
  });
}

function deterministicWait(
  statuses: NativeRadioServiceStatus[],
): Parameters<typeof waitForNativeRadioShutdown>[0] {
  let nowMs = 0;
  let index = 0;
  return {
    timeoutMs: 500,
    pollIntervalMs: 10,
    now: () => nowMs,
    delay: async ms => {
      nowMs += ms;
    },
    getStatus: async () => {
      const status = statuses[Math.min(index, statuses.length - 1)];
      index += 1;
      return status;
    },
  };
}

describe('native radio shutdown acknowledgement', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('waits for active native ownership to become fully disconnected', async () => {
    const result = await waitForNativeRadioShutdown(
      deterministicWait([
        activeStatus(),
        activeStatus({nativeBleState: 'disconnecting'}),
        releasedStatus(),
      ]),
    );

    expect(isNativeRadioShutdownConfirmed(result)).toBe(true);
    expect(result.radioRequested).toBe(false);
    expect(result.nativeBleState).toBe('disconnected');
    expect(result.nativeBleDeviceAddress).toBeNull();
    expect(result.deviceAddress).toBeNull();
    expect(result.persistedNativeTargetPresent).toBe(false);
  });

  it('does not confirm shutdown while native ownership or persisted target remains', () => {
    expect(
      isNativeRadioShutdownConfirmed(
        releasedStatus({ownership: 'native-service'}),
      ),
    ).toBe(false);
    expect(
      isNativeRadioShutdownConfirmed(
        releasedStatus({persistedNativeTargetPresent: true}),
      ),
    ).toBe(false);
    expect(
      isNativeRadioShutdownConfirmed(
        releasedStatus({nativeBleDeviceAddress: 'AA:BB'}),
      ),
    ).toBe(false);
  });

  it('waits through reconnecting state and stops polling after explicit release', async () => {
    const statuses = [
      activeStatus({nativeBleState: 'reconnecting', nativeBleReconnectAttempt: 3}),
      releasedStatus(),
      activeStatus({nativeBleState: 'reconnecting', nativeBleReconnectAttempt: 4}),
    ];
    let calls = 0;
    let nowMs = 0;

    const result = await waitForNativeRadioShutdown({
      timeoutMs: 500,
      pollIntervalMs: 10,
      now: () => nowMs,
      delay: async ms => {
        nowMs += ms;
      },
      getStatus: async () => {
        const status = statuses[Math.min(calls, statuses.length - 1)];
        calls += 1;
        return status;
      },
    });

    expect(result.nativeBleState).toBe('disconnected');
    expect(calls).toBe(2);
  });

  it('fails with native state details when Android never acknowledges shutdown', async () => {
    let nowMs = 0;
    await expect(
      waitForNativeRadioShutdown({
        timeoutMs: 30,
        pollIntervalMs: 10,
        now: () => nowMs,
        delay: async ms => {
          nowMs += ms;
        },
        getStatus: async () =>
          activeStatus({nativeBleState: 'reconnecting', nativeBleReconnectAttempt: 5}),
      }),
    ).rejects.toThrow(
      /did not confirm shutdown.*radioRequested=true.*ownership=native-service.*nativeBleState=reconnecting.*persistedTarget=true/i,
    );
  });

  it('transport stop does not resolve at ACTION_STOP dispatch alone', async () => {
    const stop = jest.spyOn(nativeRadioService, 'stop').mockResolvedValue(true);
    const getStatus = jest
      .spyOn(nativeRadioService, 'getStatus')
      .mockResolvedValue(releasedStatus());
    const transport = new NativeMeshCoreFrameTransport(
      'AA:BB:CC:DD:EE:FF',
      'Test Heltec',
      {stopTimeoutMs: 250},
    );

    await transport.stop();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('transport stop rejects when Android rejects the stop dispatch', async () => {
    jest.spyOn(nativeRadioService, 'stop').mockResolvedValue(false);
    const getStatus = jest.spyOn(nativeRadioService, 'getStatus');
    const transport = new NativeMeshCoreFrameTransport(
      'AA:BB:CC:DD:EE:FF',
      'Test Heltec',
      {stopTimeoutMs: 250},
    );

    await expect(transport.stop()).rejects.toThrow(/did not accept.*stop request/i);
    expect(getStatus).not.toHaveBeenCalled();
  });
});

describe('NativeMeshCoreSessionCoordinator stop serialization', () => {
  type CoordinatorInternals = {
    session: NativeMeshCoreSession | null;
    snapshot: NativeMeshCoreOwnershipSnapshot;
  };

  function installSession(
    coordinator: NativeMeshCoreSessionCoordinator,
    stop: jest.Mock<Promise<void>, []>,
  ): void {
    const internals = coordinator as unknown as CoordinatorInternals;
    internals.session = {stop} as unknown as NativeMeshCoreSession;
    internals.snapshot = {
      state: 'active',
      deviceAddress: 'AA:BB:CC:DD:EE:FF',
      deviceLabel: 'Test Heltec',
      statusMessage: 'Android owns the MeshCore BLE connection.',
      errorMessage: null,
      lastFrame: null,
    };
  }

  it('coalesces repeated stop calls and becomes idle only after confirmation', async () => {
    const deferred: {resolve: () => void} = {resolve: () => {}};
    const stopPromise = new Promise<void>(resolve => {
      deferred.resolve = resolve;
    });
    const sessionStop = jest.fn<Promise<void>, []>(() => stopPromise);
    const coordinator = new NativeMeshCoreSessionCoordinator();
    installSession(coordinator, sessionStop);

    const first = coordinator.stop();
    const second = coordinator.stop();
    expect(coordinator.getSnapshot().state).toBe('stopping');
    expect(sessionStop).toHaveBeenCalledTimes(1);

    deferred.resolve();
    await Promise.all([first, second]);

    expect(sessionStop).toHaveBeenCalledTimes(1);
    expect(coordinator.getSnapshot()).toMatchObject({
      state: 'idle',
      deviceAddress: null,
      deviceLabel: null,
      errorMessage: null,
    });
  });

  it('keeps the native session visible after a failed stop so stop can be retried', async () => {
    const sessionStop = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('Android stop acknowledgement timed out'))
      .mockResolvedValueOnce(undefined);
    const coordinator = new NativeMeshCoreSessionCoordinator();
    installSession(coordinator, sessionStop);

    await expect(coordinator.stop()).rejects.toThrow(/acknowledgement timed out/i);
    expect(coordinator.getSnapshot()).toMatchObject({
      state: 'error',
      deviceAddress: 'AA:BB:CC:DD:EE:FF',
    });
    expect(coordinator.getSession()).not.toBeNull();

    await coordinator.stop();

    expect(sessionStop).toHaveBeenCalledTimes(2);
    expect(coordinator.getSnapshot().state).toBe('idle');
    expect(coordinator.getSession()).toBeNull();
  });
});