import {NativeModules, Platform} from 'react-native';

import {
  DEFAULT_GPS_PREFERENCES,
  GpsPreferencesV1,
  decodeGpsPreferences,
  encodeGpsPreferences,
  validateGpsPreferences,
} from './gpsPreferenceCodec';

export type GpsPreferencesPort = {
  loadGpsPreferences: () => Promise<string | null>;
  saveGpsPreferences: (serialized: string) => Promise<boolean>;
};

type Listener = () => void;

/**
 * Shared preference cache only; never starts or stops GPS/radio.
 * Serial writes preserve order across rapid user selections. Invalid/corrupt
 * snapshots fail closed to defaults with a visible error, never raw coordinates.
 */
export class GpsPreferencesStore {
  private value: GpsPreferencesV1 = {...DEFAULT_GPS_PREFERENCES};
  private listeners = new Set<Listener>();
  private loaded = false;
  private restoring: Promise<void> | null = null;
  private writeTail: Promise<void> = Promise.resolve();
  private error: string | null = null;

  constructor(private readonly port: Partial<GpsPreferencesPort> | null) {}

  isPersistent(): boolean {
    return Boolean(this.port?.loadGpsPreferences && this.port?.saveGpsPreferences);
  }

  snapshot(): GpsPreferencesV1 {
    return {...this.value};
  }

  getError(): string | null {
    return this.error;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach(listener => listener());
  }

  initialize(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.restoring) return this.restoring;
    if (!this.isPersistent()) {
      this.loaded = true;
      this.error = 'Android GPS preference storage is unavailable; selections are temporary.';
      this.emit();
      return Promise.resolve();
    }
    const loading = this.port!.loadGpsPreferences!()
      .then(text => {
        this.value = text === null
          ? {...DEFAULT_GPS_PREFERENCES}
          : decodeGpsPreferences(text);
        this.error = null;
      })
      .catch(error => {
        this.value = {...DEFAULT_GPS_PREFERENCES};
        this.error = error instanceof Error
          ? 'Cannot restore GPS preferences: ' + error.message
          : 'Cannot restore GPS preferences.';
      })
      .finally(() => {
        this.loaded = true;
        this.restoring = null;
        this.emit();
      });
    this.restoring = loading;
    return loading;
  }

  async update(patch: Partial<Omit<GpsPreferencesV1, 'version'>>): Promise<void> {
    await this.initialize();
    const task = this.writeTail.catch(() => undefined).then(async () => {
      const next = validateGpsPreferences({...this.value, ...patch});
      if (!this.isPersistent()) {
        this.value = next;
        this.error = 'Android GPS preference storage is unavailable; selections are temporary.';
        this.emit();
        return;
      }
      const saved = await this.port!.saveGpsPreferences!(encodeGpsPreferences(next));
      if (!saved) throw new Error('Android did not commit GPS preferences.');
      this.value = next;
      this.error = null;
      this.emit();
    }).catch(error => {
      this.error = error instanceof Error ? error.message : 'Cannot save GPS preferences.';
      this.emit();
      throw error;
    });
    this.writeTail = task;
    return task;
  }
}

const nativePort = NativeModules.BushMeshPersistence as
  | Partial<GpsPreferencesPort> | undefined;

export const gpsPreferences = new GpsPreferencesStore(
  Platform.OS === 'android' ? nativePort ?? null : null,
);
