import {
  BushMeshPersistentKeyValueStore,
  getBushMeshPersistentStore,
} from './BushMeshPersistentStore';

const STORAGE_KEY = 'bushmesh.voice.preferences.v1';

export type BushMeshVoicePreferences = {
  autoSpeak: boolean;
};

type PersistedVoicePreferences = BushMeshVoicePreferences & {
  version: 1;
};

const DEFAULT_PREFERENCES: BushMeshVoicePreferences = {
  autoSpeak: false,
};

export class BushMeshVoicePreferenceStore {
  constructor(
    private readonly store: BushMeshPersistentKeyValueStore | null =
      getBushMeshPersistentStore(),
  ) {}

  isPersistent(): boolean {
    return this.store !== null;
  }

  async restore(): Promise<BushMeshVoicePreferences> {
    if (!this.store) {
      return {...DEFAULT_PREFERENCES};
    }

    const raw = await this.store.getItem(STORAGE_KEY);
    if (!raw) {
      return {...DEFAULT_PREFERENCES};
    }

    try {
      const parsed = JSON.parse(raw) as Partial<PersistedVoicePreferences>;
      if (parsed.version !== 1 || typeof parsed.autoSpeak !== 'boolean') {
        throw new Error('Invalid BushMesh voice preference shape.');
      }
      return {autoSpeak: parsed.autoSpeak};
    } catch {
      await this.store.removeItem(STORAGE_KEY);
      return {...DEFAULT_PREFERENCES};
    }
  }

  async persist(preferences: BushMeshVoicePreferences): Promise<void> {
    if (!this.store) {
      return;
    }

    const payload: PersistedVoicePreferences = {
      version: 1,
      autoSpeak: preferences.autoSpeak,
    };
    await this.store.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  async clear(): Promise<void> {
    await this.store?.removeItem(STORAGE_KEY);
  }
}

let sharedStore: BushMeshVoicePreferenceStore | null = null;

export function getBushMeshVoicePreferenceStore(): BushMeshVoicePreferenceStore {
  if (!sharedStore) {
    sharedStore = new BushMeshVoicePreferenceStore();
  }
  return sharedStore;
}
