import {NativeModules} from 'react-native';

import {gpsPreferences} from '../src/device/gps/gpsPreferences';
import {DEFAULT_GPS_PREFERENCES} from '../src/device/gps/gpsPreferenceCodec';
import {AndroidGpsLocationProvider} from '../src/location/AndroidGpsLocationProvider';

jest.mock('react-native', () => {
  const original = jest.requireActual('react-native');
  return {
    ...original,
    Platform: {...original.Platform, OS: 'android'},
    NativeModules: {
      ...original.NativeModules,
      BushMeshLocation: {
        start: jest.fn(async () => true),
        stop: jest.fn(async () => true),
        getStatus: jest.fn(async () => ({
          tracking: false, gpsEnabled: true, provider: 'gps',
        })),
        addListener: jest.fn(),
        removeListeners: jest.fn(),
      },
    },
    NativeEventEmitter: jest.fn().mockImplementation(() => ({
      addListener: jest.fn(() => ({remove: jest.fn()})),
    })),
  };
});

const native = NativeModules.BushMeshLocation as {
  start: jest.Mock;
  stop: jest.Mock;
};

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe('existing Android GPS provider policy lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not start GPS until explicitly invoked, and applies persisted acquisition policy', async () => {
    const provider = new AndroidGpsLocationProvider();
    jest.spyOn(gpsPreferences, 'initialize').mockResolvedValue();
    jest.spyOn(gpsPreferences, 'snapshot').mockReturnValue({
      ...DEFAULT_GPS_PREFERENCES, acquisitionMode: 'battery-saver',
    });
    expect(native.start).not.toHaveBeenCalled();
    const stop = provider.start(jest.fn());
    await flushMicrotasks();
    expect(native.start).toHaveBeenCalledWith(15_000, 25);
    stop();
    await flushMicrotasks();
    expect(native.stop).toHaveBeenCalledTimes(1);
  });

  it('cancels pending preference restore without starting a late native GPS session', async () => {
    const provider = new AndroidGpsLocationProvider();
    let restore: (() => void) | null = null;
    jest.spyOn(gpsPreferences, 'initialize').mockImplementation(() =>
      new Promise<void>(resolve => {restore = resolve;}));
    const stop = provider.start(jest.fn());
    await flushMicrotasks();
    expect(native.start).not.toHaveBeenCalled();
    stop();
    if (restore !== null) (restore as () => void)();
    await flushMicrotasks();
    expect(native.start).not.toHaveBeenCalled();
    expect(native.stop).not.toHaveBeenCalled();
  });

  it('serializes stop then restart and never lets the old stop clobber the new session', async () => {
    const provider = new AndroidGpsLocationProvider();
    jest.spyOn(gpsPreferences, 'initialize').mockResolvedValue();
    jest.spyOn(gpsPreferences, 'snapshot').mockReturnValue({
      ...DEFAULT_GPS_PREFERENCES,
    });
    const first = provider.start(jest.fn());
    await flushMicrotasks();
    first();
    const second = provider.start(jest.fn());
    await flushMicrotasks();
    expect(native.start).toHaveBeenCalledTimes(2);
    expect(native.stop).toHaveBeenCalledTimes(1);
    const startOrder = native.start.mock.invocationCallOrder;
    const stopOrder = native.stop.mock.invocationCallOrder;
    expect(startOrder[0]).toBeLessThan(stopOrder[0]);
    expect(stopOrder[0]).toBeLessThan(startOrder[1]);
    second();
    await flushMicrotasks();
    expect(native.stop).toHaveBeenCalledTimes(2);
  });
});
