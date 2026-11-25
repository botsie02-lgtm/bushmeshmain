import {NativeModules, Platform} from 'react-native';

export type ChatConfiguration = {
  id: string;
  radio: string;
  slot: number;
  name: string;
  privateChannel: boolean;
};

export type ChatPreferences = {
  displayName: string;
  pinned: boolean;
  archived: boolean;
  unread: boolean;
  localCreator: boolean;
};

export const defaultChatPreferences: ChatPreferences = {
  displayName: '',
  pinned: false,
  archived: false,
  unread: false,
  localCreator: false,
};

type NativeStore = {
  loadChatPreferences(): Promise<string | null>;
  saveChatPreferences(value: string): Promise<boolean>;
  chatConfigurationId(value: string): Promise<string>;
};

function nativeStore(): NativeStore {
  const store = NativeModules.BushMeshPersistence as NativeStore | undefined;
  if (Platform.OS !== 'android' || !store ||
      typeof store.loadChatPreferences !== 'function' ||
      typeof store.saveChatPreferences !== 'function' ||
      typeof store.chatConfigurationId !== 'function') {
    throw new Error('Protected chat storage unavailable.');
  }
  return store;
}

export async function configurationId(
  radio: string, slot: number, name: string, secretHex: string,
): Promise<string> {
  const id = await nativeStore().chatConfigurationId(
    JSON.stringify(['meshcore-chat-v1', radio, slot, name, secretHex.toUpperCase()]),
  );
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid protected chat identity.');
  return id;
}

export type ChatPreferenceSnapshot = Record<string, ChatPreferences>;

export function decodeChatPreferences(serialized: string | null): ChatPreferenceSnapshot {
  if (serialized === null) return {};
  const parsed = JSON.parse(serialized);
  if (!parsed || parsed.version !== 1 || !parsed.entries ||
      typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
    throw new Error('Invalid chat preference snapshot.');
  }
  const entries: ChatPreferenceSnapshot = {};
  for (const [id, value] of Object.entries(parsed.entries)) {
    const p = value as ChatPreferences;
    if (!/^[a-f0-9]{64}$/.test(id) || !p ||
        typeof p.displayName !== 'string' || p.displayName.length > 80 ||
        [p.pinned, p.archived, p.unread, p.localCreator].some(v => typeof v !== 'boolean')) {
      throw new Error('Invalid chat preference entry.');
    }
    entries[id] = {
      displayName: p.displayName, pinned: p.pinned, archived: p.archived,
      unread: p.unread, localCreator: p.localCreator,
    };
  }
  return entries;
}

export type ChatPreferencePatch = Partial<Omit<ChatPreferences, 'localCreator'>>;

export class ChatPreferenceStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: () => NativeStore = nativeStore) {}

  async load(): Promise<ChatPreferenceSnapshot> {
    await this.queue;
    return decodeChatPreferences(await this.storage().loadChatPreferences());
  }

  private mutate(id: string, update: (current: ChatPreferences) => ChatPreferences | null) {
    const operation = this.queue.then(async () => {
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid chat identity.');
      const storage = this.storage();
      const entries = decodeChatPreferences(await storage.loadChatPreferences());
      const next = update(entries[id] ?? defaultChatPreferences);
      if (next === null) delete entries[id];
      else entries[id] = next;
      if (!await storage.saveChatPreferences(JSON.stringify({version: 1, entries}))) {
        throw new Error('Chat preferences were not saved.');
      }
      return entries;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  update(id: string, patch: ChatPreferencePatch) {
    return this.mutate(id, current => ({
      ...current,
      displayName: typeof patch.displayName === 'string'
        ? patch.displayName.trim().slice(0, 80) : current.displayName,
      pinned: typeof patch.pinned === 'boolean' ? patch.pinned : current.pinned,
      archived: typeof patch.archived === 'boolean' ? patch.archived : current.archived,
      unread: typeof patch.unread === 'boolean' ? patch.unread : current.unread,
    }));
  }

  /** Called only by the verified provisioning orchestration, not by settings. */
  recordProvisioned(id: string, created: boolean) {
    return this.mutate(id, () => ({...defaultChatPreferences, localCreator: created}));
  }

  forget(id: string) {
    return this.mutate(id, () => null);
  }
}

export const chatPreferenceStore = new ChatPreferenceStore();

export function selectChats(
  chats: readonly ChatConfiguration[], preferences: ChatPreferenceSnapshot,
  query = '', archived = false,
): ChatConfiguration[] {
  const needle = query.trim().toLowerCase();
  return chats.filter(chat => {
    const p = preferences[chat.id] ?? defaultChatPreferences;
    return p.archived === archived &&
      [chat.name, p.displayName].some(name => name.toLowerCase().includes(needle));
  }).sort((a, b) =>
    Number(!!preferences[b.id]?.pinned) - Number(!!preferences[a.id]?.pinned) ||
    a.name.localeCompare(b.name) || a.slot - b.slot);
}

export function chatRole(preferences: ChatPreferences): string {
  return preferences.localCreator ? 'Created on this phone (local only)' : 'No verified creator or administrator role';
}
