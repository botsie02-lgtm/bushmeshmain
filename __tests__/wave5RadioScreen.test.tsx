import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {AppState, FlatList, KeyboardAvoidingView, Modal, StyleSheet} from 'react-native';
import {RadioScreen} from '../src/screens/RadioScreen';
import {RadioInbox} from '../src/screens/radioMessenger/RadioInbox';
import {ViewedConversationProvider} from '../src/app/activeContext/ViewedConversationContext';
import {useBushMesh} from '../src/state/BushMeshContext';
import {useRadioConnection} from '../src/state/RadioConnectionContext';
import {useRadioSession} from '../src/state/RadioSessionContext';
import type {BushMeshChannelMessage} from '../src/state/BushMeshContext';
import {chatPreferenceStore, defaultChatPreferences} from '../src/radio/chatManagement/chatPreferences';
import {ChatOperationError} from '../src/radio/chatManagement/chatInvitations';
import {meshCoreInboundInbox} from '../src/meshcore/meshcoreInboundInbox';
import {meshCoreInboundMessageId} from '../src/meshcore/meshcoreInboundIdentity';
import type {ParsedChannelMessage} from '../src/meshcore/meshcoreParsers';

jest.mock('../src/state/BushMeshContext', () => ({useBushMesh: jest.fn()}));
jest.mock('../src/state/RadioConnectionContext', () => ({useRadioConnection: jest.fn()}));
jest.mock('../src/state/RadioSessionContext', () => ({useRadioSession: jest.fn()}));
jest.mock('../src/meshcore/nativeOutboundDiagnostics', () => ({
  nativeOutboundDiagnostics: {
    snapshot: () => ({events: [], counts: {}}),
    subscribe: () => () => undefined,
  },
}));
jest.mock('../src/meshcore/meshcoreInboundDiagnostics', () => ({
  meshCoreInboundDiagnostics: {
    record: jest.fn(),
    snapshot: () => ({events: [], counts: {}}),
    subscribe: () => () => undefined,
  },
}));

const channels = [
  {channelIndex: '0', channelName: 'Public', secret: 'Empty / Public'},
  {channelIndex: '1', channelName: 'Private', secret: 'Configured (redacted)'},
];
let connected = true;
let addr: string | null = 'AA:BB:CC:DD';
let activeChannelIndex = '0';
let ready = true;
let restore: 'ready' | 'restoring' | 'error' = 'ready';
let messages: BushMeshChannelMessage[] = [];
const send = jest.fn(async (_index: number, _text: string) => undefined);
const addLocal = jest.fn();
const carrierSwitch = jest.fn();
const chatRadio = 'verified-radio';
const chatConfigs = [
  {id: 'a'.repeat(64), radio: chatRadio, slot: 0, name: 'Public', privateChannel: false},
  {id: 'b'.repeat(64), radio: chatRadio, slot: 1, name: 'Private', privateChannel: true},
];
const listChats = jest.fn(async () => chatConfigs);
const verifiedSend = jest.fn(async (_chat: typeof chatConfigs[number], _text: string) => undefined);
const verifyChat = jest.fn(async () => undefined);

function configure() {
  (useBushMesh as jest.Mock).mockImplementation(() => ({
    connectionStatus: connected ? 'Connected' : 'Disconnected',
    connectedDeviceName: connected ? 'Field Node' : null,
    channels, activeChannelIndex,
    activeChannel: channels.find(c => c.channelIndex === activeChannelIndex) ?? null,
    channelMessages: messages, canSendChannelMessage: ready,
    sendChannelMessage: send,
    addLocalChannelMessage: addLocal,
    setActiveChannelIndex: carrierSwitch,
    messagePersistenceStatus: restore, messagePersistenceError: null,
  }));
  (useRadioConnection as jest.Mock).mockImplementation(() => ({
    snapshot: {connectedDeviceAddress: addr, channels, isWriting: false},
    getChatRadio: () => connected ? chatRadio : null,
    getChatSessionEpoch: () => 1,
    isChatObservationCurrent: () => connected,
    listChatConfigurations: listChats,
    verifyChatConfiguration: verifyChat,
    sendVerifiedChat: verifiedSend,
  }));
  (useRadioSession as jest.Mock).mockReturnValue({
    snapshot: {radioProfile: null, transportReady: false},
  });
}
function Fixture(props: React.ComponentProps<typeof RadioScreen>) {
  return <ViewedConversationProvider><RadioScreen {...props} /></ViewedConversationProvider>;
}
let tree: TestRenderer.ReactTestRenderer;
async function mount(props: React.ComponentProps<typeof RadioScreen> = {}) {
  configure();
  await act(async () => {
    tree = TestRenderer.create(<Fixture {...props} />);
  });
}
async function rerender(props: React.ComponentProps<typeof RadioScreen> = {}) {
  configure();
  await act(async () => {tree.update(<Fixture {...props} />);});
}
function button(label: string) {
  const found = tree.root.findAll(node => node.props.accessibilityLabel === label &&
    typeof node.props.onPress === 'function')[0];
  if (!found) throw new Error('Button not found: ' + label);
  return found;
}
async function press(label: string) {
  await act(async () => {button(label).props.onPress();});
}
async function draft(value: string) {
  const input = tree.root.findAll(node =>
    node.props.accessibilityLabel === 'Carrier message draft' &&
    typeof node.props.onChangeText === 'function')[0];
  if (!input) throw new Error('No message draft');
  await act(async () => {input.props.onChangeText(value);});
}
function asText(value: unknown): string {
  if (Array.isArray(value)) return value.map(asText).join('');
  return typeof value === 'string' || typeof value === 'number'
    ? String(value) : '';
}
function viewText(): string {
  const visible = tree.root.findAllByType('Text' as unknown as React.ElementType)
    .map(node => asText(node.props.children));
  const accessible = tree.root.findAll(node =>
    typeof node.props.accessibilityLabel === 'string')
    .map(node => node.props.accessibilityLabel as string);
  return [...visible, ...accessible].join(' ');
}
async function room(label: string) {await press('Open chat ' + label);}
afterEach(async () => {
  if (tree) await act(async () => {tree.unmount();});
  jest.restoreAllMocks();
});
beforeEach(() => {
  AppState.currentState = 'active';
  connected = true; addr = 'AA:BB:CC:DD'; activeChannelIndex = '0';
  ready = true; restore = 'ready'; messages = [];
  send.mockReset(); send.mockResolvedValue(undefined);
  addLocal.mockClear(); carrierSwitch.mockClear();
  jest.spyOn(chatPreferenceStore, 'rememberConfigurations').mockImplementation(async () => (await chatPreferenceStore.loadState()).entries);
  jest.spyOn(chatPreferenceStore, 'update').mockResolvedValue({});
  listChats.mockReset(); listChats.mockResolvedValue(chatConfigs);
  verifiedSend.mockReset(); verifiedSend.mockResolvedValue(undefined);
  verifyChat.mockClear();
});

test('compact inbox has accessible search, real connection indicator and row menus', async () => {
  await mount();
  expect(viewText()).toContain('Chats');
  expect(viewText()).toContain('Companion connected');
  expect(viewText()).not.toContain('NATIVE OUTBOUND');
  expect(button('New chat')).toBeDefined();
  expect(button('Chat options Public')).toBeDefined();
  const search = tree.root.findAll(node =>
    node.props.accessibilityLabel === 'Search conversations' &&
    typeof node.props.onChangeText === 'function')[0];
  await act(async () => {search.props.onChangeText('priv');});
  expect(button('Open chat Private')).toBeDefined();
  expect(tree.root.findAll(node => node.props.accessibilityLabel ===
    'Open chat Public' && typeof node.props.onPress === 'function')).toHaveLength(0);
});

test('row menu supports local pin and exposes external settings callbacks', async () => {
  const settings = jest.fn(), menu = jest.fn();
  const props = {onOpenChatSettings: settings, onOpenConversationMenu: menu};
  await mount(props);
  await press('Chat options Public');
  expect(menu).toHaveBeenCalledTimes(1);
  await press('Pin chat');
  expect(viewText()).toContain('★');
  await press('Chat options Public');
  await press('Chat details');
  expect(settings).toHaveBeenCalledWith(expect.objectContaining({
    channelIndex: '0', channelName: 'Public',
  }));
});

test('opening a chat does not alter carrier selection or switch operational convoy', async () => {
  activeChannelIndex = '0';
  await mount();
  await room('Private');
  expect(viewText()).toContain('Private');
  expect(tree.root.findAllByType(KeyboardAvoidingView)).toHaveLength(1);
  expect(carrierSwitch).not.toHaveBeenCalled();
  await draft('Send to private only');
  await press('Submit channel text to radio');
  expect(send).toHaveBeenCalledWith(1, 'Send to private only');
  expect(addLocal).toHaveBeenCalledWith(expect.objectContaining({
    channelIndex: '1', direction: 'sent', status: 'accepted',
  }));
  expect(addLocal).not.toHaveBeenCalledWith(expect.objectContaining({
    status: 'confirmed',
  }));
  expect(viewText()).toContain('No peer delivery confirmation');
});

test('two chats retain independent drafts and use their own channel index', async () => {
  await mount();
  await room('Public');
  await draft('Only public');
  await press('Back to chats');
  await room('Private');
  const input = tree.root.findAll(node => node.props.accessibilityLabel ===
    'Carrier message draft' && typeof node.props.onChangeText === 'function')[0];
  expect(input.props.value).toBe('');
  await draft('Only private');
  await press('Back to chats');
  await room('Public');
  const again = tree.root.findAll(node => node.props.accessibilityLabel ===
    'Carrier message draft' && typeof node.props.onChangeText === 'function')[0];
  expect(again.props.value).toBe('Only public');
  expect(carrierSwitch).not.toHaveBeenCalled();
});

test('unscoped encrypted history is quarantined and separately reviewable, including offline', async () => {
  messages = [{
    id: 'legacy', channelIndex: '1', channelName: 'Private',
    direction: 'received', status: 'confirmed',
    text: 'PAST UNKNOWN RADIO', createdAt: '2026-11-24T00:00:00Z',
  }];
  connected = false; addr = null;
  await mount();
  expect(viewText()).toContain('Radio disconnected');
  expect(viewText()).toContain('1 historical message');
  expect(viewText()).not.toContain('PAST UNKNOWN RADIO');
  await press('Review unattributed Radio History');
  expect(viewText()).toContain('PAST UNKNOWN RADIO');
  expect(viewText()).toContain('OWNERSHIP UNPROVEN');
  await press('Back to chats');
  expect(viewText()).not.toContain('PAST UNKNOWN RADIO');
});

test('trusted provenance restores one exact channel without cross-slot history leaks', async () => {
  messages = [{
    id: 'verified-one', channelIndex: '1', channelName: 'Private',
    direction: 'received', status: 'confirmed',
    text: 'SCOPED MESSAGE', createdAt: '2026-11-26T00:00:00Z',
  }, {
    id: 'other', channelIndex: '0', channelName: 'Public',
    direction: 'received', status: 'confirmed',
    text: 'UNOWNED MESSAGE', createdAt: '2026-11-26T00:00:00Z',
  }];
  const scope = {
    radioId: 'AA:BB:CC:DD', channelGeneration: 'verified-gen',
    channelIndex: '1', channelName: 'Private',
  };
  await mount({
    trustedScopes: [scope],
    verifiedMessageOwnership: {'verified-one': scope},
  });
  // The verified scope is distinct from the ephemeral current-session scope.
  // The inbox should show only safely scoped previews, not the other slot.
  expect(viewText()).toContain('1 historical message');
  expect(viewText()).toContain('SCOPED MESSAGE');
  expect(viewText()).not.toContain('UNOWNED MESSAGE');
});

test('oversized UTF-8 payload is blocked even when character count is small', async () => {
  await mount();
  await room('Public');
  await draft('🌲'.repeat(34));
  expect(viewText()).toContain('136/133 UTF-8 bytes');
  expect(button('Submit channel text to radio').props.disabled).toBe(true);
  expect(send).not.toHaveBeenCalled();
});

test('disconnected and reconfigured channel cannot send from a stale room', async () => {
  await mount();
  await room('Public');
  await draft('Do not send');
  connected = false; addr = null;
  await rerender();
  expect(button('Submit channel text to radio').props.disabled).toBe(true);
  expect(viewText()).toContain('Offline');
  expect(send).not.toHaveBeenCalled();
  connected = true; addr = '55:66:77:88';
  await rerender();
  expect(button('Submit channel text to radio').props.disabled).toBe(true);
  expect(viewText()).toContain('Channel configuration or radio identity changed');
});

test('uncertain acceptance never retries automatically; requires explicit acknowledgement', async () => {
  send.mockRejectedValueOnce(new Error('Timed out waiting for PACKET_OK'));
  await mount();
  await room('Public');
  await draft('Possibly delivered');
  await press('Submit channel text to radio');
  expect(send).toHaveBeenCalledTimes(1);
  expect(addLocal).toHaveBeenCalledWith(expect.objectContaining({
    status: 'failed', submissionFailure: {reason: 'timeout'},
  }));
  expect(button('Submit channel text to radio').props.disabled).toBe(true);
  expect(button('Acknowledge uncertain radio submission')).toBeDefined();
  await press('Acknowledge uncertain radio submission');
  expect(button('Submit channel text to radio').props.disabled).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
});

test('room is virtualized, composer is fixed, and touch controls are 48dp+', async () => {
  await mount();
  await room('Public');
  const lists = tree.root.findAllByType(FlatList);
  expect(lists).toHaveLength(1);
  expect(lists[0].props.inverted).toBe(true);
  expect(typeof lists[0].props.onScroll).toBe('function');
  const back = button('Back to chats');
  const submit = button('Submit channel text to radio');
  expect(StyleSheet.flatten(back.props.style).minHeight).toBeGreaterThanOrEqual(48);
  expect(StyleSheet.flatten(submit.props.style).height).toBeGreaterThanOrEqual(48);
});

test('new chat enters carrier tools through callbacks; no fake channel is created', async () => {
  const create = jest.fn(), join = jest.fn();
  await mount({onCreateChat: create, onJoinChat: join});
  await press('New chat');
  await press('Create channel');
  expect(create).toHaveBeenCalledTimes(1);
  await press('New chat');
  await press('Join channel');
  expect(join).toHaveBeenCalledTimes(1);
  expect(carrierSwitch).not.toHaveBeenCalled();
});

test('restoring history and absent durable storage do not fabricate unread counts', async () => {
  restore = 'restoring';
  await mount();
  expect(viewText()).toContain('Restoring encrypted Radio History');
  expect(viewText()).not.toContain('unread messages');
  restore = 'ready';
  await rerender();
  expect(viewText()).not.toContain('Restoring encrypted Radio History');
});


test('new inbound during a stable mounted radio session appears on the left without sender invention', async () => {
  await mount();
  await room('Private');
  messages = [{
    id: 'fresh-inbound', channelIndex: '1', channelName: 'Private',
    direction: 'received', status: 'confirmed',
    text: 'NEW MESSAGE FROM RADIO', createdAt: new Date().toISOString(),
  }];
  await rerender();
  expect(viewText()).toContain('NEW MESSAGE FROM RADIO');
  expect(viewText()).toContain('sender unavailable');
  await press('Back to chats');
  expect(viewText()).toContain('NEW MESSAGE FROM RADIO');
});

test('offline historical chat opens only with proven radio/channel-generation owner', async () => {
  connected = false; addr = null;
  messages = [{
    id: 'historic', channelIndex: '1', channelName: 'Private',
    direction: 'received', status: 'confirmed',
    text: 'PROVEN HISTORY', createdAt: '2026-11-25T02:00:00Z',
  }];
  const scope = {radioId: 'KNOWN-RADIO', channelGeneration: 'GEN-24',
    channelIndex: '1', channelName: 'Private'};
  await mount({trustedScopes: [scope], verifiedMessageOwnership: {historic: scope}});
  expect(viewText()).toContain('PROVEN HISTORY');
  await room('Private');
  expect(viewText()).toContain('Offline · read-only');
  expect(button('Submit channel text to radio').props.disabled).toBe(true);
  expect(viewText()).toContain('PROVEN HISTORY');
});

test('unread counts and read callback require explicit authoritative input', async () => {
  messages = [{
    id: 'read-evidence', channelIndex: '1', channelName: 'Private',
    direction: 'received', status: 'confirmed',
    text: 'READABLE', createdAt: '2026-11-25T02:00:00Z',
  }];
  const scope = {radioId: 'KNOWN-RADIO', channelGeneration: 'GEN-24',
    channelIndex: '1', channelName: 'Private'};
  const read = jest.fn();
  await mount({
    trustedScopes: [scope],
    verifiedMessageOwnership: {'read-evidence': scope},
    unreadCounts: {['["KNOWN-RADIO","GEN-24","1","Private"]']: 2},
    onConversationRead: read,
  });
  expect(viewText()).toContain('2 unread messages');
  await press('Open chat Private · GEN-24');
  expect(read).toHaveBeenCalledWith(scope, 'read-evidence');
});


test('local history recording failure after PACKET_OK never becomes radio failure', async () => {
  addLocal.mockImplementationOnce(() => {
    throw new Error('Local encrypted persistence failure');
  });
  await mount();
  await room('Public');
  await draft('Radio still accepted');
  await press('Submit channel text to radio');
  expect(send).toHaveBeenCalledTimes(1);
  expect(addLocal).toHaveBeenCalledTimes(1);
  expect(viewText()).toContain('Radio accepted, but local history recording failed');
  expect(viewText()).toContain('Do not resend');
});


test('a proven archived chat survives another radio reusing the slot with a new name', async () => {
  messages = [{
    id: 'old-radio', channelIndex: '1', channelName: 'Old Expedition',
    direction: 'received', status: 'confirmed', text: 'DO NOT MERGE',
    createdAt: '2026-11-20T04:00:00Z',
  }];
  const archived = {
    radioId: 'DIFFERENT-RADIO', channelGeneration: 'old-incarnation',
    channelIndex: '1', channelName: 'Old Expedition',
  };
  await mount({
    trustedScopes: [archived],
    verifiedMessageOwnership: {'old-radio': archived},
  });
  expect(button('Open chat Old Expedition')).toBeDefined();
  expect(button('Open chat Private')).toBeDefined();
  await press('Open chat Old Expedition');
  expect(viewText()).toContain('DO NOT MERGE');
  expect(button('Submit channel text to radio').props.disabled).toBe(true);
  expect(carrierSwitch).not.toHaveBeenCalled();
});


test('managed messenger binds preference and send to verified configuration, not a slot callback', async () => {
  jest.spyOn(chatPreferenceStore, 'loadState').mockResolvedValue({
    entries: {[chatConfigs[1].id]: {...defaultChatPreferences, displayName: 'Private camp'}},
    sort: 'name',
  });
  await mount({enableChatManagement: true});
  expect(viewText()).toContain('Private camp');
  await room('Private');
  await draft('verified room message');
  await press('Submit channel text to radio');
  expect(verifiedSend).toHaveBeenCalledWith(chatConfigs[1], 'verified room message');
  expect(send).not.toHaveBeenCalled();
  expect(carrierSwitch).not.toHaveBeenCalled();
});

test('managed stale preflight preserves draft and does not claim a submission', async () => {
  jest.spyOn(chatPreferenceStore, 'loadState').mockResolvedValue({entries: {}, sort: 'name'});
  verifiedSend.mockRejectedValueOnce(new ChatOperationError('stale', 'No message was submitted. Refresh chats.'));
  await mount({enableChatManagement: true});
  await room('Private');
  await draft('keep this text');
  await press('Submit channel text to radio');
  expect(verifiedSend).toHaveBeenCalledTimes(1);
  expect(addLocal).not.toHaveBeenCalled();
  expect(viewText()).toContain('No message was submitted');
  const input = tree.root.findAll(node => node.props.accessibilityLabel === 'Carrier message draft' &&
    typeof node.props.onChangeText === 'function')[0];
  expect(input.props.value).toBe('keep this text');
});

test('managed inbox counts actual observed inbound, never a new history row alone', async () => {
  jest.spyOn(chatPreferenceStore, 'loadState').mockResolvedValue({entries: {}, sort: 'name'});
  await mount({enableChatManagement: true});
  messages = [{id: 'delayed-row', channelIndex: '1', channelName: 'Private',
    direction: 'received', status: 'confirmed', text: 'DELAYED UNOWNED', createdAt: new Date().toISOString()}];
  await rerender({enableChatManagement: true});
  expect(viewText()).not.toContain('DELAYED UNOWNED');
  const message: ParsedChannelMessage = {
    packetType: 'channel',
    channelIndex: '1',
    text: 'OBSERVED RADIO MESSAGE',
    timestamp: 100,
    textType: 0,
    snr: 0,
    pathLength: 0,
  };
  await act(async () => {meshCoreInboundInbox.publish(message);});
  messages = [...messages, {id: meshCoreInboundMessageId(message),
    channelIndex: '1', channelName: 'Private', direction: 'received', status: 'confirmed',
    text: message.text, createdAt: new Date().toISOString()}];
  await rerender({enableChatManagement: true});
  expect(viewText()).toContain('OBSERVED RADIO MESSAGE');
  expect(viewText()).toContain('1 unread messages');
  const ambiguous: ParsedChannelMessage = {...message, text: 'AMBIGUOUS QUEUE RECORD', timestamp: 101};
  await act(async () => {meshCoreInboundInbox.publish(ambiguous, {version: 1, source: 'native-session', origin: 'queued-generation-unknown', radio: null, configurationId: null, configurationName: null, timestamp: 101, snr: 0, pathLength: 0});});
  messages = [...messages, {id: meshCoreInboundMessageId(ambiguous), channelIndex: '1', channelName: 'Private', direction: 'received', status: 'confirmed', text: ambiguous.text, createdAt: new Date().toISOString()}];
  await rerender({enableChatManagement: true});
  expect(viewText()).not.toContain('AMBIGUOUS QUEUE RECORD');
  await room('Private');
  await press('Back to chats');
  expect(viewText()).not.toContain('1 unread messages');
});

test('managed inbox menu stays open across refresh and tab return retains the same draft', async () => {
  jest.spyOn(chatPreferenceStore, 'loadState').mockResolvedValue({entries: {}, sort: 'recent'});
  await mount({enableChatManagement: true});
  await press('Chat options Private');
  expect(button('Chat details')).toBeDefined();
  await rerender({enableChatManagement: true});
  expect(button('Chat details')).toBeDefined();
  await press('Close chat options');
  await press('Chat options Private');
  await press('Close chat options');
  await room('Private');
  await draft('Saved while navigating');
  await rerender({enableChatManagement: true, tabVisible: false, settingsVisible: true});
  await rerender({enableChatManagement: true, tabVisible: true, settingsVisible: false});
  const input = tree.root.findAll(node => node.props.accessibilityLabel === 'Carrier message draft' && typeof node.props.onChangeText === 'function')[0];
  expect(input.props.value).toBe('Saved while navigating');
  expect(listChats).toHaveBeenCalledTimes(1);
});

test('quick message fills composer without submitting', async () => {
  await mount();
  await room('Private');
  await press('Quick messages');
  await press('Ready to go.');
  const input = tree.root.findAll(node => node.props.accessibilityLabel === 'Carrier message draft' && typeof node.props.onChangeText === 'function')[0];
  expect(input.props.value).toBe('Ready to go.');
  expect(send).not.toHaveBeenCalled();
});

test('managed recent ordering uses attributed activity rather than channel name or ambiguous backlog', async () => {
  jest.spyOn(chatPreferenceStore, 'loadState').mockResolvedValue({entries: {}, sort: 'recent'});
  messages = [
    ...chatConfigs.map((chat, index): BushMeshChannelMessage => ({
      id: 'attributed-' + chat.id, channelIndex: String(chat.slot), channelName: chat.name,
      text: 'Local submission', direction: 'sent', status: 'accepted',
      createdAt: new Date(index === 0 ? 2000 : 1000).toISOString(),
      conversation: {version: 1, provenance: 'local-submission', radioId: chat.radio,
        channelGeneration: 'config:1:' + chat.id, channelIndex: String(chat.slot), channelName: chat.name},
    })),
    {id: 'unattributed-newer', channelIndex: '1', channelName: 'Private',
      text: 'Ambiguous backlog', direction: 'received', status: 'confirmed', createdAt: new Date(3000).toISOString()},
  ];
  await mount({enableChatManagement: true});
  expect(tree.root.findByType(RadioInbox).props.conversations).toMatchObject([
    {channel: {channelName: 'Public'}, activityMs: 2000},
    {channel: {channelName: 'Private'}, activityMs: 1000},
  ]);
});

test('conversation sheet dismisses by backdrop and Android Back and opens another identity', async () => {
  await mount();
  await press('Chat options Public');
  expect(tree.root.findByType(Modal).props.visible).toBe(true);
  await press('Dismiss conversation options');
  expect(tree.root.findAllByType(Modal)).toHaveLength(0);
  await press('Chat options Private');
  await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  expect(tree.root.findAllByType(Modal)).toHaveLength(0);
  await press('Chat options Public');
  await press('Close chat options');
  await press('Chat options Private');
  expect(button('Pin chat')).toBeDefined();
});

test('connection strip opens existing setup navigation callback', async () => {
  connected = false;
  const open = jest.fn();
  await mount({onOpenRadioConnection: open});
  await press('Connect radio');
  expect(open).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});

test('global templates reload on settings return, not ordinary controller renders, and ignore stale reads', async () => {
  jest.spyOn(chatPreferenceStore, 'loadState').mockResolvedValue({entries: {}, sort: 'recent'});
  let resolveOld!: (values: string[]) => void;
  const oldRead = new Promise<string[]>(resolve => {resolveOld = resolve;});
  const load = jest.spyOn(chatPreferenceStore, 'loadGlobalQuickMessages')
    .mockReturnValueOnce(oldRead)
    .mockResolvedValue(['Updated global template']);
  await mount({enableChatManagement: true});
  expect(load).toHaveBeenCalledTimes(1);
  await room('Private');
  await draft('Draft retained');
  await rerender({enableChatManagement: true});
  expect(load).toHaveBeenCalledTimes(1);
  await rerender({enableChatManagement: true, settingsVisible: true});
  expect(load).toHaveBeenCalledTimes(1);
  await rerender({enableChatManagement: true, settingsVisible: false});
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => {resolveOld(['Stale template']);});
  await press('Quick messages');
  expect(button('Updated global template')).toBeDefined();
  expect(viewText()).not.toContain('Stale template');
  expect(load).toHaveBeenCalledTimes(2);
  const input = tree.root.findAll(node => node.props.accessibilityLabel === 'Carrier message draft' && typeof node.props.onChangeText === 'function')[0];
  expect(input.props.value).toBe('Draft retained');
  expect(verifiedSend).not.toHaveBeenCalled();
});

test('global template restoration pauses off-tab and leaves unmanaged messenger untouched', async () => {
  jest.spyOn(chatPreferenceStore, 'loadState').mockResolvedValue({entries: {}, sort: 'recent'});
  const load = jest.spyOn(chatPreferenceStore, 'loadGlobalQuickMessages').mockResolvedValue(['Global template']);
  await mount({enableChatManagement: true, tabVisible: false});
  expect(load).not.toHaveBeenCalled();
  await rerender({enableChatManagement: true, tabVisible: true});
  expect(load).toHaveBeenCalledTimes(1);
  await rerender({enableChatManagement: true, tabVisible: false});
  expect(load).toHaveBeenCalledTimes(1);
  await rerender({enableChatManagement: true, tabVisible: true});
  expect(load).toHaveBeenCalledTimes(2);
  await rerender({enableChatManagement: false, tabVisible: true});
  expect(load).toHaveBeenCalledTimes(2);
});


test('durable associated receive stays unread behind a hidden room until visible', async () => {
  jest.spyOn(chatPreferenceStore, 'loadState').mockResolvedValue({entries: {}, sort: 'recent'});
  await mount({enableChatManagement: true});
  await room('Private');
  await rerender({enableChatManagement: true, tabVisible: false});
  messages = [{id: 'offscreen-durable', channelIndex: '1', channelName: 'Private', direction: 'received', status: 'confirmed',
    text: 'OFFSCREEN DURABLE RECEIVE', createdAt: new Date().toISOString(),
    conversation: {radioId: chatRadio, channelGeneration: 'config:1:' + chatConfigs[1].id, channelIndex: '1', channelName: 'Private', provenance: 'local-observation'}}];
  await rerender({enableChatManagement: true, tabVisible: false});
  expect(chatPreferenceStore.update).not.toHaveBeenCalledWith(chatConfigs[1].id, expect.objectContaining({readIds: ['offscreen-durable']}), 1);
  await rerender({enableChatManagement: true, tabVisible: true});
  expect(chatPreferenceStore.update).toHaveBeenCalledWith(chatConfigs[1].id, {readIds: ['offscreen-durable'], unread: false}, 1);
  expect(viewText()).toContain('OFFSCREEN DURABLE RECEIVE');
  expect(viewText()).toContain('First unread message');
  expect(verifiedSend).not.toHaveBeenCalled();
});
