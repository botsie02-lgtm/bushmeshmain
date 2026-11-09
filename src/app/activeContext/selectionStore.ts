import {NativeModules, Platform} from 'react-native';

import {
  ActiveConvoySelectionStore,
  ActiveConvoySelectionV1,
} from './operationalConvoy';

/**
 * Optional native persistence hook owned by the integration/platform worker.
 * Intentionally does not reuse the canonical runtime snapshot or a carrier
 * credential store. Only convoy ID + local public identity reference are saved.
 *
 * Required future native module: BushMeshActiveConvoyStore with three methods
 * below, using an atomic durable write. When absent, the app fails closed on
 * restart and selection remains session-only.
 */
type NativeActiveConvoyStore = {
  loadSelection(): Promise<string | null>;
  saveSelection(serializedMetadata: string): Promise<void>;
  clearSelection(): Promise<void>;
};

function nativeStore(): NativeActiveConvoyStore | null {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return null;
  }
  const native = NativeModules.BushMeshActiveConvoyStore as
    | Partial<NativeActiveConvoyStore>
    | undefined;
  return native &&
    typeof native.loadSelection === 'function' &&
    typeof native.saveSelection === 'function' &&
    typeof native.clearSelection === 'function'
    ? native as NativeActiveConvoyStore
    : null;
}

export const platformActiveConvoySelectionStore: ActiveConvoySelectionStore = {
  isDurable(): boolean {
    return nativeStore() !== null;
  },

  async load(): Promise<unknown> {
    const native = nativeStore();
    if (!native) {
      return null;
    }
    const raw = await native.loadSelection();
    return raw === null ? null : JSON.parse(raw);
  },

  async save(value: ActiveConvoySelectionV1): Promise<void> {
    const native = nativeStore();
    if (native) {
      await native.saveSelection(JSON.stringify(value));
    }
  },

  async clear(): Promise<void> {
    const native = nativeStore();
    if (native) {
      await native.clearSelection();
    }
  },
};
