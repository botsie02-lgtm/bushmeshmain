import {
  ChatPreferenceStore, decodeChatPreferences, defaultChatPreferences, selectChats, chatRole,
} from '../src/radio/chatManagement/chatPreferences';

const one = 'a'.repeat(64);
const two = 'b'.repeat(64);
const three = 'c'.repeat(64);

function fixture() {
  let value: string | null = null;
  const native = {
    loadChatPreferences: jest.fn(async () => value),
    saveChatPreferences: jest.fn(async (next: string) => {value = next; return true;}),
    chatConfigurationId: jest.fn(async () => one),
  };
  return {native, store: new ChatPreferenceStore(() => native)};
}

describe('protected chat preference model', () => {
  it('does not give imported channels creator provenance', async () => {
    const {store} = fixture();
    expect((await store.update(one, {pinned: true}))[one].localCreator).toBe(false);
    expect(chatRole(defaultChatPreferences)).not.toContain('Created on this phone');
  });

  it('records creation only on the verified creation path, not on join', async () => {
    const {store, native} = fixture();
    await store.recordProvisioned(one, true);
    await store.recordProvisioned(two, false);
    const restarted = new ChatPreferenceStore(() => native);
    const loaded = await restarted.load();
    expect(loaded[one].localCreator).toBe(true);
    expect(loaded[two].localCreator).toBe(false);
    expect(loaded[one].origin).toBe('created');
    expect(loaded[two].origin).toBe('joined');
    expect(loaded[three]).toBeUndefined();
  });

  it('serializes concurrent writes and preserves provenance during local changes', async () => {
    const {store} = fixture();
    await store.recordProvisioned(one, true);
    await Promise.all([
      store.update(one, {displayName: 'My convoy', unread: true}),
      store.update(one, {pinned: true, archived: true}),
    ]);
    expect((await store.load())[one]).toEqual({
      ...defaultChatPreferences,
      displayName: 'My convoy', unread: true, pinned: true, archived: true, localCreator: true, origin: 'created',
    });
    await store.recordProvisioned(two, false);
    await store.forget(one);
    expect((await store.load())[one]).toBeUndefined();
    expect((await store.load())[two]).toEqual({...defaultChatPreferences, origin: 'joined'});
  });

  it('does not silently replace unreadable or unsaved preferences', async () => {
    const {store, native} = fixture();
    native.loadChatPreferences.mockResolvedValueOnce('{"version":2}');
    await expect(store.update(one, {pinned: true})).rejects.toThrow();
    expect(native.saveChatPreferences).not.toHaveBeenCalled();
    native.saveChatPreferences.mockResolvedValueOnce(false);
    await expect(store.recordProvisioned(one, true)).rejects.toThrow();
    expect((await store.load())[one]).toBeUndefined();
  });

  it('does not serialize arbitrary fields supplied as a settings patch', async () => {
    const {store, native} = fixture();
    const patch = {pinned: true, localCreator: true, secretHex: 'secret'};
    await store.update(one, patch);
    expect((await store.load())[one].localCreator).toBe(false);
    expect(native.saveChatPreferences.mock.calls[0][0]).not.toContain('secret');
  });

  it('isolates different configurations that reuse the same slot, searches aliases and sorts pinned', () => {
    const chats = [
      {id: one, radio: 'radio A', slot: 1, name: 'Alpha', privateChannel: true},
      {id: two, radio: 'radio B', slot: 1, name: 'Beta', privateChannel: true},
      {id: three, radio: 'radio A', slot: 1, name: 'Alpha', privateChannel: true},
    ];
    const prefs = {
      [one]: {...defaultChatPreferences, archived: true},
      [two]: {...defaultChatPreferences, displayName: 'Tour', pinned: true},
    };
    expect(selectChats(chats, prefs).map(c => c.id)).toEqual([two, three]);
    expect(selectChats(chats, prefs, 'tour').map(c => c.id)).toEqual([two]);
    expect(selectChats(chats, prefs, '', true).map(c => c.id)).toEqual([one]);
  });

  it('migrates legacy preferences without guessing joined provenance', async () => {
    const {store, native} = fixture();
    const legacy = {displayName: 'Old', pinned: true, archived: false, unread: true, localCreator: false};
    const snapshot = JSON.stringify({version: 1, entries: {
      [one]: legacy, [two]: {...legacy, localCreator: true},
    }});
    native.loadChatPreferences.mockResolvedValueOnce(snapshot);
    const restored = await store.load();
    expect(restored[one]).toEqual({...defaultChatPreferences, ...legacy});
    expect(restored[two].origin).toBe('created');
    expect(native.saveChatPreferences).not.toHaveBeenCalled();
    native.loadChatPreferences.mockResolvedValueOnce(snapshot);
    await store.update(one, {description: 'Weekend trip', avatarColor: 'teal', avatarIcon: 'camp'});
    expect(JSON.parse(native.saveChatPreferences.mock.calls[0][0]).version).toBe(2);
    expect((await store.load())[one]).toEqual({...defaultChatPreferences, ...legacy,
      description: 'Weekend trip', avatarColor: 'teal', avatarIcon: 'camp'});
    expect((await store.load())[two].localCreator).toBe(true);
  });

  it('restores personalisation after restart and retains previous data after a failed save', async () => {
    const {store, native} = fixture();
    await store.recordProvisioned(one, true, {description: 'Camp', avatarColor: 'purple', avatarIcon: 'mountain'});
    native.saveChatPreferences.mockRejectedValueOnce(new Error('process terminated before commit'));
    await expect(store.update(one, {description: 'Lost write'})).rejects.toThrow();
    const restarted = new ChatPreferenceStore(() => native);
    expect((await restarted.load())[one]).toEqual({...defaultChatPreferences,
      origin: 'created', localCreator: true, description: 'Camp', avatarColor: 'purple', avatarIcon: 'mountain'});
    await restarted.update(two, {description: 'Different radio'});
    expect((await restarted.load())[one].description).toBe('Camp');
  });

  it('fails closed when protected storage cannot be authenticated', async () => {
    const {store, native} = fixture();
    await store.recordProvisioned(one, true);
    const count = native.saveChatPreferences.mock.calls.length;
    native.loadChatPreferences.mockRejectedValueOnce(new Error('Keystore unavailable'));
    await expect(store.update(two, {description: 'No write'})).rejects.toThrow();
    expect(native.saveChatPreferences).toHaveBeenCalledTimes(count);
    expect((await store.load())[one].localCreator).toBe(true);
  });

  it('rejects inconsistent provenance and invalid avatar values', () => {
    expect(() => decodeChatPreferences(JSON.stringify({version: 2, entries: {
      [one]: {...defaultChatPreferences, origin: 'created'},
    }}))).toThrow();
    expect(() => decodeChatPreferences(JSON.stringify({version: 2, entries: {
      [one]: {...defaultChatPreferences, avatarColor: 'invalid'},
    }}))).toThrow();
  });

  it('persists sorting across restart without overwriting chat entries', async () => {
    const {store, native} = fixture();
    await store.recordProvisioned(one, true);
    await Promise.all([store.saveSort('unread'), store.update(one, {pinned: true})]);
    const restarted = new ChatPreferenceStore(() => native);
    const state = await restarted.loadState();
    expect(state.sort).toBe('unread');
    expect(state.entries[one]).toEqual({...defaultChatPreferences, origin: 'created', localCreator: true, pinned: true});
    await restarted.saveSort('slot');
    expect(await restarted.loadSort()).toBe('slot');
    expect((await restarted.load())[one]).toEqual(state.entries[one]);
  });

  it('sorts pinned first, then unread or radio slot as selected', () => {
    const chats = [
      {id: one, radio: 'radio', slot: 2, name: 'Z', privateChannel: true},
      {id: two, radio: 'radio', slot: 1, name: 'A', privateChannel: true},
      {id: three, radio: 'radio', slot: 0, name: 'B', privateChannel: true},
    ];
    const prefs = {
      [one]: {...defaultChatPreferences, pinned: true},
      [three]: {...defaultChatPreferences, unread: true},
    };
    expect(selectChats(chats, prefs, '', false, 'name').map(c => c.id)).toEqual([one, two, three]);
    expect(selectChats(chats, prefs, '', false, 'unread').map(c => c.id)).toEqual([one, three, two]);
    expect(selectChats(chats, prefs, '', false, 'slot').map(c => c.id)).toEqual([one, three, two]);
  });

  it('rejects invalid IDs and malformed snapshots', () => {
    expect(() => decodeChatPreferences('{"version":1,"entries":{"__proto__":{}}}')).toThrow();
    expect(() => decodeChatPreferences(JSON.stringify({version: 1, entries: {[one]: {pinned: true}}}))).toThrow();
  });
});

 test('catalogue restores offline metadata, drafts and local incarnation after removal', async () => {
  const {store, native} = fixture();
  const c = {id: one, radio: 'radio-a', slot: 1, name: 'Camp', privateChannel: true};
  await store.rememberConfigurations(c.radio, [c]);
  await store.update(one, {draft: 'Ready', starredIds: ['m1'], readIds: ['m2'], quickMessages: ['Ready to go.']}, 1);
  const restarted = new ChatPreferenceStore(() => native);
  expect((await restarted.load())[one]).toMatchObject({configuration: c, incarnation: 1, draft: 'Ready', starredIds: ['m1'], quickMessages: ['Ready to go.']});
  await restarted.rememberConfigurations(c.radio, []);
  expect((await restarted.load())[one].retired).toBe(true);
  await restarted.rememberConfigurations(c.radio, [c]);
  expect((await restarted.load())[one]).toMatchObject({incarnation: 2, draft: '', starredIds: [], readIds: []});
  await expect(restarted.update(one, {draft: 'old'}, 1)).rejects.toThrow('changed');
});

test('quick templates validate UTF-8 payload length before saving', async () => {
  const {store, native} = fixture();
  await expect(store.update(one, {quickMessages: ['🚙'.repeat(34)]})).rejects.toThrow('payload');
  expect(native.saveChatPreferences).not.toHaveBeenCalled();
  await store.update(one, {quickMessages: ['🚙'.repeat(33)]});
  expect((await store.load())[one].quickMessages).toEqual(['🚙'.repeat(33)]);
});
