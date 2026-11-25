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
      displayName: 'My convoy', unread: true, pinned: true, archived: true, localCreator: true,
    });
    await store.recordProvisioned(two, false);
    await store.forget(one);
    expect((await store.load())[one]).toBeUndefined();
    expect((await store.load())[two]).toEqual(defaultChatPreferences);
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

  it('rejects invalid IDs and malformed snapshots', () => {
    expect(() => decodeChatPreferences('{"version":1,"entries":{"__proto__":{}}}')).toThrow();
    expect(() => decodeChatPreferences(JSON.stringify({version: 1, entries: {[one]: {pinned: true}}}))).toThrow();
  });
});
