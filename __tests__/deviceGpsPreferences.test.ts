import {
  DEFAULT_GPS_PREFERENCES,
  GpsPreferencesV1,
  decodeGpsPreferences,
  encodeGpsPreferences,
  gpsAcquisitionHint,
  validateGpsPreferences,
} from '../src/device/gps/gpsPreferenceCodec';
import {GpsPreferencesStore} from '../src/device/gps/gpsPreferences';

describe('Device GPS preferences', () => {
  it('preserves current GPS request hints by default; offers battery-saving policies', () => {
    expect(gpsAcquisitionHint(DEFAULT_GPS_PREFERENCES.acquisitionMode)).toMatchObject({
      minTimeMs: 1000, minDistanceMeters: 0,
    });
    expect(gpsAcquisitionHint('balanced')).toMatchObject({
      minTimeMs: 5000, minDistanceMeters: 5,
    });
    expect(gpsAcquisitionHint('battery-saver')).toMatchObject({
      minTimeMs: 15000, minDistanceMeters: 25,
    });
  });

  it('strictly validates values and excludes extra secrets/coordinates on disk', () => {
    const unsafe = {
      ...DEFAULT_GPS_PREFERENCES,
      acquisitionMode: 'battery-saver' as const,
      showCoordinates: true,
      longitude: 144.93,
      latitude: -37.82,
      privateKeyHex: 'HIDDEN_KEY',
      psk: 'HIDDEN_PSK',
    };
    const encoded = encodeGpsPreferences(unsafe);
    expect(encoded).not.toMatch(/longitude|latitude|HIDDEN_KEY|HIDDEN_PSK/);
    expect(decodeGpsPreferences(encoded)).toEqual({
      ...DEFAULT_GPS_PREFERENCES,
      acquisitionMode: 'battery-saver',
      showCoordinates: true,
    });
    for (const invalid of [
      {...DEFAULT_GPS_PREFERENCES, version: 2},
      {...DEFAULT_GPS_PREFERENCES, acquisitionMode: 'always-on'},
      {...DEFAULT_GPS_PREFERENCES, staleAfterSeconds: -1},
      {...DEFAULT_GPS_PREFERENCES, staleAfterSeconds: 999999},
      {...DEFAULT_GPS_PREFERENCES, accuracyWarningMeters: 6.2},
      {...DEFAULT_GPS_PREFERENCES, showCoordinates: 'true'},
    ]) {
      expect(() => validateGpsPreferences(invalid)).toThrow();
    }
    expect(() => decodeGpsPreferences('{')).toThrow();
    expect(() => decodeGpsPreferences('a'.repeat(4097))).toThrow(/large/i);
  });

  it('restores saved preferences after app restart without touching GPS or BLE', async () => {
    let stored: string | null = null;
    const port = {
      loadGpsPreferences: jest.fn(async () => stored),
      saveGpsPreferences: jest.fn(async (next: string) => {stored = next; return true;}),
    };
    const original = new GpsPreferencesStore(port);
    const seen = jest.fn();
    original.subscribe(seen);
    await Promise.all([original.initialize(), original.initialize()]);
    await original.update({acquisitionMode: 'battery-saver'});
    await original.update({staleAfterSeconds: 180, accuracyWarningMeters: 25});
    expect(seen).toHaveBeenCalled();
    expect(port.loadGpsPreferences).toHaveBeenCalledTimes(1);
    expect(port.saveGpsPreferences).toHaveBeenCalledTimes(2);

    const afterRestart = new GpsPreferencesStore(port);
    await afterRestart.initialize();
    expect(afterRestart.snapshot()).toMatchObject({
      acquisitionMode: 'battery-saver', staleAfterSeconds: 180,
      accuracyWarningMeters: 25,
    });
    expect(port.loadGpsPreferences).toHaveBeenCalledTimes(2);
    expect(afterRestart.getError()).toBeNull();
  });

  it('serializes simultaneous changes so later updates do not overwrite earlier ones', async () => {
    let saved: string | null = null;
    const port = {
      loadGpsPreferences: async () => saved,
      saveGpsPreferences: async (text: string) => {
        await Promise.resolve();
        saved = text;
        return true;
      },
    };
    const store = new GpsPreferencesStore(port);
    await Promise.all([
      store.update({showCoordinates: true}),
      store.update({staleAfterSeconds: 45}),
      store.update({acquisitionMode: 'balanced'}),
    ]);
    const persisted = decodeGpsPreferences(String(saved));
    expect(persisted).toMatchObject({
      showCoordinates: true, staleAfterSeconds: 45, acquisitionMode: 'balanced',
    });
  });

  it('recovers from invalid stored version, missing module and failed writes safely', async () => {
    const invalid = new GpsPreferencesStore({
      loadGpsPreferences: async () => '{"version":999}',
      saveGpsPreferences: async () => true,
    });
    await invalid.initialize();
    expect(invalid.snapshot()).toEqual(DEFAULT_GPS_PREFERENCES);
    expect(invalid.getError()).toMatch(/restore/i);

    const unsupported = new GpsPreferencesStore(null);
    await unsupported.update({acquisitionMode: 'balanced'});
    expect(unsupported.snapshot().acquisitionMode).toBe('balanced');
    expect(unsupported.getError()).toMatch(/temporary/i);

    const noCommit = new GpsPreferencesStore({
      loadGpsPreferences: async () => null,
      saveGpsPreferences: async () => false,
    });
    await expect(noCommit.update({acquisitionMode: 'battery-saver'}))
      .rejects.toThrow(/did not commit/i);
    expect(noCommit.snapshot()).toEqual(DEFAULT_GPS_PREFERENCES);
    expect(noCommit.getError()).toMatch(/commit/i);
  });

  it('rejects malformed updates and retains known-good preferences', async () => {
    const store = new GpsPreferencesStore({
      loadGpsPreferences: async () => null,
      saveGpsPreferences: async (_data: string) => true,
    });
    await store.initialize();
    await expect(store.update({
      staleAfterSeconds: -200 as unknown as GpsPreferencesV1['staleAfterSeconds'],
    })).rejects.toThrow(/stale-after/i);
    expect(store.snapshot()).toEqual(DEFAULT_GPS_PREFERENCES);
  });
});
