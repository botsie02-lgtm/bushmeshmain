import {NativeModules, Platform} from 'react-native';
import {Buffer} from 'buffer';

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
  /** Non-secret catalogue metadata, from successful full radio readback only. */
  configuration?: ChatConfiguration;
  incarnation?: number;
  retired?: boolean;
  draft?: string;
  readIds?: string[];
  starredIds?: string[];
  pinnedIds?: string[];
  quickMessages?: string[];
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

export const DEFAULT_QUICK_MESSAGES = ['Ready to go.', 'All clear.', 'Stopping shortly.', 'Need assistance.', 'Vehicle issue.', 'Radio check.', 'Regroup ahead.', 'Convoy accounted for.'] as const;
function validateTemplates(values: unknown): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 24 || values.some(v => typeof v !== 'string' || !v.trim() || Buffer.byteLength(v.trim(), 'utf8') > 133)) throw new Error('Use 1–24 templates of at most 133 UTF-8 bytes.');
  return values.map(v => v.trim());
}
function decodeGlobalTemplates(serialized: string | null): string[] | undefined {
  const value = serialized === null ? undefined : JSON.parse(serialized).globalQuickMessages;
  return value === undefined ? undefined : validateTemplates(value);
}
function encodePreferences(entries: ChatPreferenceSnapshot, sort: ChatSort, serialized: string | null, templates = decodeGlobalTemplates(serialized)): string {
  return JSON.stringify({version: 2, entries, sort, ...(templates ? {globalQuickMessages: templates} : {})});
}
export type ChatPreferenceSnapshot = Record<string, ChatPreferences>;
export const CHAT_SORT_OPTIONS = ['recent', 'name', 'unread', 'slot'] as const;
export type ChatSort = typeof CHAT_SORT_OPTIONS[number];
const sorts: readonly ChatSort[] = CHAT_SORT_OPTIONS;
export type ChatActivity = Readonly<Partial<Record<string, number | null>>>;

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
    const c = p.configuration;
    if (c !== undefined && (!c || c.id !== id || typeof c.radio !== 'string' || !c.radio ||
        !Number.isInteger(c.slot) || c.slot < 0 || c.slot > 7 || typeof c.name !== 'string' || !c.name ||
        typeof c.privateChannel !== 'boolean' || !Number.isSafeInteger(p.incarnation) || p.incarnation! < 1 ||
        typeof p.retired !== 'boolean')) throw new Error('Invalid cached chat configuration.');
    if (p.draft !== undefined && (typeof p.draft !== 'string' || p.draft.length > 512)) throw new Error('Invalid chat draft.');
    for (const ids of [p.readIds, p.starredIds, p.pinnedIds]) {
      if (ids !== undefined && (!Array.isArray(ids) || ids.some(value => typeof value !== 'string' || !value || value.length > 256))) throw new Error('Invalid chat message preferences.');
    }
    if (p.quickMessages !== undefined && (!Array.isArray(p.quickMessages) || p.quickMessages.length > 24 || p.quickMessages.some(value => typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 133))) throw new Error('Invalid quick messages.');
    entries[id] = {
      ...defaultChatPreferences,
      ...(parsed.version === 2 ? {
        description: p.description, avatarColor: p.avatarColor, avatarIcon: p.avatarIcon,
        origin: p.origin,
      } : {origin: p.localCreator ? 'created' : 'unknown'}),
      displayName: p.displayName, pinned: p.pinned, archived: p.archived,
      unread: p.unread, localCreator: p.localCreator,
      ...(c ? {configuration: {id, radio: c.radio, slot: c.slot, name: c.name, privateChannel: c.privateChannel}, incarnation: p.incarnation, retired: p.retired} : {}),
      ...(p.draft !== undefined ? {draft: p.draft} : {}),
      ...(p.readIds ? {readIds: [...new Set(p.readIds)]} : {}),
      ...(p.starredIds ? {starredIds: [...new Set(p.starredIds)]} : {}),
      ...(p.pinnedIds ? {pinnedIds: [...new Set(p.pinnedIds)]} : {}),
      ...(p.quickMessages ? {quickMessages: [...p.quickMessages]} : {}),
    };
  }
  return entries;
}

function decodeSort(serialized: string | null): ChatSort {
  if (serialized === null) return 'recent';
  const parsed = JSON.parse(serialized);
  return parsed.version === 2 && sorts.includes(parsed.sort) ? parsed.sort : 'recent';
}

export type ChatPreferencePatch = Partial<Omit<ChatPreferences, 'localCreator' | 'origin' | 'configuration' | 'incarnation' | 'retired'>>;

export class ChatPreferenceStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: () => NativeStore = nativeStore) {}

  async load(): Promise<ChatPreferenceSnapshot> {
    await this.queue;
    return decodeChatPreferences(await this.storage().loadChatPreferences());
  }

  async loadState(): Promise<{entries: ChatPreferenceSnapshot; sort: ChatSort}> {
    await this.queue;
    const serialized = await this.storage().loadChatPreferences();
    return {entries: decodeChatPreferences(serialized), sort: decodeSort(serialized)};
  }

  async loadGlobalQuickMessages(): Promise<string[]> {
    await this.queue;
    const serialized = await this.storage().loadChatPreferences();
    decodeChatPreferences(serialized);
    return decodeGlobalTemplates(serialized) ?? [...DEFAULT_QUICK_MESSAGES];
  }

  saveGlobalQuickMessages(values: string[]): Promise<void> {
    const operation = this.queue.then(async () => {
      const templates = validateTemplates(values);
      const storage = this.storage();
      const serialized = await storage.loadChatPreferences();
      const entries = decodeChatPreferences(serialized);
      // Initialise the existing protected identity key only for a genuinely new store.
      if (serialized === null) await storage.chatConfigurationId('meshcore-chat-preference-initialisation-v1');
      if (!await storage.saveChatPreferences(encodePreferences(entries, decodeSort(serialized), serialized, templates))) throw new Error('Quick messages were not saved.');
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async loadSort(): Promise<ChatSort> {
    await this.queue;
    const serialized = await this.storage().loadChatPreferences();
    decodeChatPreferences(serialized);
    return decodeSort(serialized);
  }

  saveSort(sort: ChatSort): Promise<void> {
    const operation = this.queue.then(async () => {
      if (!sorts.includes(sort)) throw new Error('Invalid chat sorting preference.');
      const storage = this.storage();
      const serialized = await storage.loadChatPreferences();
      const entries = decodeChatPreferences(serialized);
      if (!await storage.saveChatPreferences(encodePreferences(entries, sort, serialized))) {
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
      const sort = decodeSort(serialized);
      const next = update(entries[id] ?? defaultChatPreferences);
      if (next === null) delete entries[id];
      else entries[id] = next;
      if (!await storage.saveChatPreferences(encodePreferences(entries, sort, serialized))) {
        throw new Error('Chat preferences were not saved.');
      }
      return entries;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  /** A complete verified enumeration is the only way to update catalogue membership. */
  rememberConfigurations(radio: string, configs: readonly ChatConfiguration[]): Promise<ChatPreferenceSnapshot> {
    const operation = this.queue.then(async () => {
      const storage = this.storage();
      const serialized = await storage.loadChatPreferences();
      const entries = decodeChatPreferences(serialized);
      const sort = decodeSort(serialized);
      const present = new Set(configs.map(c => c.id));
      for (const [id, p] of Object.entries(entries)) {
        if (p.configuration?.radio === radio && !present.has(id)) entries[id] = {...p, retired: true};
      }
      for (const c of configs) {
        if (c.radio !== radio || !/^[a-f0-9]{64}$/.test(c.id)) throw new Error('Invalid verified configuration.');
        const previous = entries[c.id] ?? defaultChatPreferences;
        const incarnation = (previous.incarnation ?? 1) + (previous.retired ? 1 : 0);
        entries[c.id] = {...previous, configuration: {id: c.id, radio, slot: c.slot, name: c.name, privateChannel: c.privateChannel}, incarnation, retired: false,
          ...(previous.retired ? {draft: '', readIds: [], starredIds: [], pinnedIds: [], unread: false} : {})};
      }
      const next = encodePreferences(entries, sort, serialized);
      decodeChatPreferences(next);
      if (next !== serialized && !await storage.saveChatPreferences(next)) throw new Error('Chat catalogue was not saved.');
      return entries;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  update(id: string, patch: ChatPreferencePatch, incarnation?: number) {
    return this.mutate(id, current => {
      if (incarnation !== undefined && (current.incarnation ?? 1) !== incarnation) throw new Error('Local conversation changed.');
      if (patch.quickMessages !== undefined && (!Array.isArray(patch.quickMessages) || !patch.quickMessages.length || patch.quickMessages.length > 24 || patch.quickMessages.some(value => typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 133))) throw new Error('Invalid quick message payload.');
      return ({
      ...current,
      displayName: typeof patch.displayName === 'string'
        ? patch.displayName.trim().slice(0, 80) : current.displayName,
      ...personalisationPatch(current, patch),
      pinned: typeof patch.pinned === 'boolean' ? patch.pinned : current.pinned,
      archived: typeof patch.archived === 'boolean' ? patch.archived : current.archived,
      unread: typeof patch.unread === 'boolean' ? patch.unread : current.unread,
      ...(typeof patch.draft === 'string' ? {draft: patch.draft.slice(0, 512)} : {}),
      ...(Array.isArray(patch.quickMessages) ? {quickMessages: [...new Set(patch.quickMessages.map(value => value.trim()))]} : {}),
      ...Object.fromEntries((['readIds', 'starredIds', 'pinnedIds'] as const).flatMap(key => Array.isArray(patch[key]) ? [[key, [...new Set([...(key === 'readIds' ? current.readIds ?? [] : []), ...patch[key]!.filter(v => typeof v === 'string' && v.length > 0 && v.length <= 256)])]]] : [])),
    });});
  }

  /** Called only by the verified provisioning orchestration, not by settings. */
  recordProvisioned(id: string, created: boolean, personalisation?: Partial<ChatPersonalisation>) {
    return this.mutate(id, previous => ({
      ...defaultChatPreferences,
      ...(previous.configuration ? {configuration: previous.configuration, incarnation: previous.incarnation, retired: true} : {}),
      ...personalisationPatch(defaultChatPreferences, personalisation ?? {}),
      localCreator: created, origin: created ? 'created' : 'joined',
    }));
  }

  forget(id: string) {
    return this.mutate(id, previous => previous.configuration ? {...previous, retired: true} : null);
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
  query = '', archived = false, sort: ChatSort = 'recent',
  activity: ChatActivity = {},
): ChatConfiguration[] {
  // Only callers with attributed history may supply activity. Unknown values
  // remain unknown and fall back to deterministic name/slot ordering.
  const activityMs = (id: string): number => {
    const value = activity[id];
    return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  };
  const compareRecent = (a: string, b: string): number => {
    const first = activityMs(a), second = activityMs(b);
    return first === second ? 0 : first > second ? -1 : 1;
  };
  const needle = query.trim().toLowerCase();
  return chats.filter(chat => {
    const p = preferences[chat.id] ?? defaultChatPreferences;
    return p.archived === archived &&
      [chat.name, p.displayName].some(name => name.toLowerCase().includes(needle));
  }).sort((a, b) =>
    Number(!!preferences[b.id]?.pinned) - Number(!!preferences[a.id]?.pinned) ||
    (sort === 'unread' ? Number(!!preferences[b.id]?.unread) - Number(!!preferences[a.id]?.unread) : 0) ||
    (sort === 'slot' ? a.slot - b.slot : 0) ||
    (sort === 'recent' ? compareRecent(a.id, b.id) : 0) ||
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
