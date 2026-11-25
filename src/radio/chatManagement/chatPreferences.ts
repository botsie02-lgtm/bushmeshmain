import {NativeModules, Platform} from 'react-native';

export type ChatConfiguration = {
  id: string;
  radio: string;
  slot: number;
  name: string;
  privateChannel: boolean;
};

export const chatAvatarColors = ['lime', 'blue', 'orange', 'purple', 'teal', 'grey'] as const;
export const chatAvatarIcons = ['initials', 'convoy', 'camp', 'mountain', 'radio', 'people'] as const;
export type ChatAvatarColor = typeof chatAvatarColors[number];
export type ChatAvatarIcon = typeof chatAvatarIcons[number];
export type ChatOrigin = 'created' | 'joined' | 'unknown';
export type ChatPersonalisation = {
  description: string;
  avatarColor: ChatAvatarColor;
  avatarIcon: ChatAvatarIcon;
};
export type ChatPreferences = ChatPersonalisation & {
  displayName: string;
  pinned: boolean;
  archived: boolean;
  unread: boolean;
  localCreator: boolean;
  origin: ChatOrigin;
};

export const defaultChatPreferences: ChatPreferences = {
  displayName: '',
  pinned: false,
  archived: false,
  unread: false,
  localCreator: false,
  origin: 'unknown',
  description: '',
  avatarColor: 'lime',
  avatarIcon: 'initials',
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
export type ChatSort = 'name' | 'unread' | 'slot';
const sorts: readonly ChatSort[] = ['name', 'unread', 'slot'];

export function decodeChatPreferences(serialized: string | null): ChatPreferenceSnapshot {
  if (serialized === null) return {};
  const parsed = JSON.parse(serialized);
  if (!parsed || ![1, 2].includes(parsed.version) || !parsed.entries ||
      typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
    throw new Error('Invalid chat preference snapshot.');
  }
  if (parsed.version === 2 && parsed.sort !== undefined && !sorts.includes(parsed.sort)) {
    throw new Error('Invalid chat sorting preference.');
  }
  const entries: ChatPreferenceSnapshot = {};
  for (const [id, value] of Object.entries(parsed.entries)) {
    const p = value as ChatPreferences;
    if (!/^[a-f0-9]{64}$/.test(id) || !p ||
        typeof p.displayName !== 'string' || p.displayName.length > 80 ||
        [p.pinned, p.archived, p.unread, p.localCreator].some(v => typeof v !== 'boolean')) {
      throw new Error('Invalid chat preference entry.');
    }
    if (parsed.version === 2 &&
        (typeof p.description !== 'string' || p.description.length > 240 ||
          !chatAvatarColors.includes(p.avatarColor) || !chatAvatarIcons.includes(p.avatarIcon) ||
          !['created', 'joined', 'unknown'].includes(p.origin) ||
          (p.origin === 'created') !== p.localCreator)) {
      throw new Error('Invalid chat personalisation.');
    }
    entries[id] = {
      ...defaultChatPreferences,
      ...(parsed.version === 2 ? {
        description: p.description, avatarColor: p.avatarColor, avatarIcon: p.avatarIcon,
        origin: p.origin,
      } : {origin: p.localCreator ? 'created' : 'unknown'}),
      displayName: p.displayName, pinned: p.pinned, archived: p.archived,
      unread: p.unread, localCreator: p.localCreator,
    };
  }
  return entries;
}

export type ChatPreferencePatch = Partial<Omit<ChatPreferences, 'localCreator' | 'origin'>>;

export class ChatPreferenceStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: () => NativeStore = nativeStore) {}

  async load(): Promise<ChatPreferenceSnapshot> {
    await this.queue;
    return decodeChatPreferences(await this.storage().loadChatPreferences());
  }

  async loadSort(): Promise<ChatSort> {
    await this.queue;
    const serialized = await this.storage().loadChatPreferences();
    decodeChatPreferences(serialized);
    return serialized === null ? 'name' : JSON.parse(serialized).sort ?? 'name';
  }

  saveSort(sort: ChatSort): Promise<void> {
    const operation = this.queue.then(async () => {
      if (!sorts.includes(sort)) throw new Error('Invalid chat sorting preference.');
      const storage = this.storage();
      const entries = decodeChatPreferences(await storage.loadChatPreferences());
      if (!await storage.saveChatPreferences(JSON.stringify({version: 2, entries, sort}))) {
        throw new Error('Chat preferences were not saved.');
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private mutate(id: string, update: (current: ChatPreferences) => ChatPreferences | null) {
    const operation = this.queue.then(async () => {
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid chat identity.');
      const storage = this.storage();
      const serialized = await storage.loadChatPreferences();
      const entries = decodeChatPreferences(serialized);
      const sort: ChatSort = serialized === null ? 'name' : JSON.parse(serialized).sort ?? 'name';
      const next = update(entries[id] ?? defaultChatPreferences);
      if (next === null) delete entries[id];
      else entries[id] = next;
      if (!await storage.saveChatPreferences(JSON.stringify({version: 2, entries, sort}))) {
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
      ...personalisationPatch(current, patch),
      pinned: typeof patch.pinned === 'boolean' ? patch.pinned : current.pinned,
      archived: typeof patch.archived === 'boolean' ? patch.archived : current.archived,
      unread: typeof patch.unread === 'boolean' ? patch.unread : current.unread,
    }));
  }

  /** Called only by the verified provisioning orchestration, not by settings. */
  recordProvisioned(id: string, created: boolean, personalisation?: Partial<ChatPersonalisation>) {
    return this.mutate(id, () => ({
      ...defaultChatPreferences,
      ...personalisationPatch(defaultChatPreferences, personalisation ?? {}),
      localCreator: created, origin: created ? 'created' : 'joined',
    }));
  }

  forget(id: string) {
    return this.mutate(id, () => null);
  }
}

function personalisationPatch(current: ChatPersonalisation, patch: Partial<ChatPersonalisation>): ChatPersonalisation {
  return {
    description: typeof patch.description === 'string' ? patch.description.trim().slice(0, 240) : current.description,
    avatarColor: patch.avatarColor && chatAvatarColors.includes(patch.avatarColor) ? patch.avatarColor : current.avatarColor,
    avatarIcon: patch.avatarIcon && chatAvatarIcons.includes(patch.avatarIcon) ? patch.avatarIcon : current.avatarIcon,
  };
}

export const chatPreferenceStore = new ChatPreferenceStore();

export function selectChats(
  chats: readonly ChatConfiguration[], preferences: ChatPreferenceSnapshot,
  query = '', archived = false, sort: ChatSort = 'name',
): ChatConfiguration[] {
  const needle = query.trim().toLowerCase();
  return chats.filter(chat => {
    const p = preferences[chat.id] ?? defaultChatPreferences;
    return p.archived === archived &&
      [chat.name, p.displayName].some(name => name.toLowerCase().includes(needle));
  }).sort((a, b) =>
    Number(!!preferences[b.id]?.pinned) - Number(!!preferences[a.id]?.pinned) ||
    (sort === 'unread' ? Number(!!preferences[b.id]?.unread) - Number(!!preferences[a.id]?.unread) : 0) ||
    (sort === 'slot' ? a.slot - b.slot : 0) ||
    (preferences[a.id]?.displayName || a.name).localeCompare(preferences[b.id]?.displayName || b.name) ||
    a.slot - b.slot);
}

export function chatRole(preferences: ChatPreferences): string {
  return preferences.localCreator ? 'Created on this phone (local only)'
    : preferences.origin === 'joined' ? 'Joined on this phone' : 'Existing channel · origin unknown';
}

/** Future authorization must come from a verified membership provider, never local origin. */
export type AuthenticatedChatRole = 'owner' | 'administrator' | 'participant';
export type ChatAdministrationCapability =
  | 'members' | 'assignAdmin' | 'removeMember' | 'invitePermission' | 'approveMembership'
  | 'transferOwnership' | 'securityPolicy' | 'rotateKey';
export type ChatAdministration = {status: 'unavailable'} | {
  status: 'verified'; role: AuthenticatedChatRole;
  capabilities: readonly ChatAdministrationCapability[];
};
export const meshCoreChatAdministration: ChatAdministration = {status: 'unavailable'};
