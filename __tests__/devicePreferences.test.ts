import {
  DEFAULT_DEVICE_PREFERENCES,
  decodeDevicePreferences,
  encodeDevicePreferences,
} from '../src/device/devicePreferenceCodec';
import {DevicePreferencesStore} from '../src/device/devicePreferences';

describe('non-sensitive Device settings persistence', () => {
  const previousVerified = {
    nodeIdentityRef: 'AABBCCDDEEFF',
    profile: {
      frequencyMhz: 916.575, bandwidthKhz: 62.5,
      spreadingFactor: 7, codingRate: 7, txPowerDbm: 18,
    },
    verifiedAt: '2026-11-09T00:00:00.000Z',
  };

  it('round-trips only explicit versioned preferences and drops unknown secrets', () => {
    const value = {...DEFAULT_DEVICE_PREFERENCES,
      selectedPresetId: 'australia-narrow', distanceUnit: 'imperial' as const,
      previousVerified,
      secretHex: 'DEADBEEF', privateMeshCorePsk: 'not-allowed',
    };
    const encoded = encodeDevicePreferences(value);
    expect(encoded).not.toContain('DEADBEEF');
    expect(encoded).not.toContain('not-allowed');
    const decoded = decodeDevicePreferences(encoded);
    expect(decoded).toEqual({
      version: 1, selectedPresetId: 'australia-narrow',
      distanceUnit: 'imperial', previousVerified,
    });
    expect(() => decodeDevicePreferences('{"version":2}'))
      .toThrow(/Unsupported/i);
    expect(decodeDevicePreferences(JSON.stringify({
      version: 1, selectedPresetId: '../bad',
      distanceUnit: 'unknown',
      previousVerified: {nodeIdentityRef: 'bad', profile: previousVerified.profile},
    }))).toEqual(DEFAULT_DEVICE_PREFERENCES);
  });

  it('loads once, commits ordered updates, and notifies observers without touching BLE', async () => {
    const port = {
      loadDevicePreferences: jest.fn(async () => encodeDevicePreferences({
        ...DEFAULT_DEVICE_PREFERENCES, selectedPresetId: 'australia-narrow',
      })),
      saveDevicePreferences: jest.fn(async (_text: string) => true),
      clearDevicePreferences: jest.fn(async () => true),
    };
    const store = new DevicePreferencesStore(port);
    const observer = jest.fn();
    const unsubscribe = store.subscribe(observer);
    await Promise.all([store.initialize(), store.initialize()]);
    expect(port.loadDevicePreferences).toHaveBeenCalledTimes(1);
    await store.update({distanceUnit: 'imperial'});
    await store.update({previousVerified});
    expect(store.getSnapshot().previousVerified).toEqual(previousVerified);
    expect(port.saveDevicePreferences).toHaveBeenCalledTimes(2);
    expect(decodeDevicePreferences(port.saveDevicePreferences.mock.calls[1][0])
      .previousVerified).toEqual(previousVerified);
    expect(observer).toHaveBeenCalled();
    unsubscribe();
  });

  it('handles absent Android persistence and reports save errors without service churn', async () => {
    const unsupported = new DevicePreferencesStore(null);
    await unsupported.update({selectedPresetId: 'australia-narrow'});
    expect(unsupported.getSnapshot().selectedPresetId).toBe('australia-narrow');
    expect(unsupported.getError()).toMatch(/unavailable/i);

    const failing = new DevicePreferencesStore({
      loadDevicePreferences: async () => null,
      saveDevicePreferences: async () => false,
    });
    await expect(failing.update({distanceUnit: 'imperial'}))
      .rejects.toThrow(/did not commit/i);
    expect(failing.getError()).toMatch(/did not commit/i);
  });
});
