import {NativeModules, Platform} from 'react-native';

import {
  DEFAULT_DEVICE_PREFERENCES,
  DevicePreferences,
  decodeDevicePreferences,
  encodeDevicePreferences,
} from './devicePreferenceCodec';

type NativePreferencePort = {
  loadDevicePreferences: () => Promise<string | null>;
  saveDevicePreferences: (serialized: string) => Promise<boolean>;
  clearDevicePreferences: () => Promise<boolean>;
};

const nativePort = NativeModules.BushMeshPersistence as
  | Partial<NativePreferencePort> | undefined;
type Listener = () => void;

/** Shared non-sensitive preferences. No BLE manager, radio session or GPS owner. */
export class DevicePreferencesStore {
  private value: DevicePreferences = {...DEFAULT_DEVICE_PREFERENCES};
  private listeners = new Set<Listener>();
  private initialized = false;
  private loading: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private lastError: string | null = null;

  constructor(private readonly port: Partial<NativePreferencePort> | null) {}

  isSupported(): boolean {
    return Boolean(
      this.port?.loadDevicePreferences &&
      this.port?.saveDevicePreferences,
    );
  }

  getSnapshot(): DevicePreferences {
    return {
      ...this.value,
      previousVerified: this.value.previousVerified
        ? {...this.value.previousVerified,
          profile: {...this.value.previousVerified.profile}} : null,
    };
  }

  getError(): string | null {
    return this.lastError;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach(listener => listener());
  }

  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.loading) return this.loading;
    if (!this.isSupported()) {
      this.initialized = true;
      return Promise.resolve();
    }
    const loading = this.port!.loadDevicePreferences!().then(serialized => {
      if (serialized !== null) this.value = decodeDevicePreferences(serialized);
      this.initialized = true;
      this.lastError = null;
      this.emit();
    }).catch(error => {
      this.lastError = error instanceof Error ? error.message : 'Cannot load device preferences.';
      this.initialized = true;
      this.emit();
    }).finally(() => {
      if (this.loading === loading) this.loading = null;
    });
    this.loading = loading;
    return loading;
  }

  async update(patch: Partial<Omit<DevicePreferences, 'version'>>): Promise<void> {
    await this.initialize();
    // Encoder/decoder remove untrusted fields and enforce a stable versioned schema.
    this.value = decodeDevicePreferences(encodeDevicePreferences({
      ...this.value, ...patch,
    }));
    this.emit();
    if (!this.isSupported()) {
      this.lastError = 'Device preference persistence is unavailable on this platform.';
      this.emit();
      return;
    }
    const serialized = encodeDevicePreferences(this.value);
    const write = this.writes.catch(() => undefined).then(async () => {
      const saved = await this.port!.saveDevicePreferences!(serialized);
      if (!saved) throw new Error('Android did not commit device preferences.');
      this.lastError = null;
      this.emit();
    }).catch(error => {
      this.lastError = error instanceof Error ? error.message : 'Saving preferences failed.';
      this.emit();
      throw error;
    });
    this.writes = write;
    return write;
  }
}

export const devicePreferences = new DevicePreferencesStore(
  Platform.OS === 'android' ? nativePort ?? null : null,
);
