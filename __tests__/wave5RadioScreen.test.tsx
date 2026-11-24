import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {StyleSheet} from 'react-native';
import {RadioScreen} from '../src/screens/RadioScreen';
import {useBushMesh} from '../src/state/BushMeshContext';
import {useRadioSession} from '../src/state/RadioSessionContext';

jest.mock('../src/state/BushMeshContext', () => ({
  useBushMesh: jest.fn(),
}));
jest.mock('../src/state/RadioSessionContext', () => ({
  useRadioSession: jest.fn(),
}));
jest.mock('../src/meshcore/nativeOutboundDiagnostics', () => ({
  nativeOutboundDiagnostics: {
    snapshot: () => ({events: [], counts: {}}),
    subscribe: () => () => undefined,
  },
}));
jest.mock('../src/meshcore/meshcoreInboundDiagnostics', () => ({
  meshCoreInboundDiagnostics: {
    snapshot: () => ({events: [], counts: {}}),
    subscribe: () => () => undefined,
  },
}));

const channels = [
  {channelIndex: '0', channelName: 'Public', secret: 'Empty / Public'},
  {channelIndex: '1', channelName: 'Private', secret: 'Configured (redacted)'},
];

const firstMessage = {
  id: 'first', channelIndex: '0', channelName: 'Public',
  direction: 'received' as const, text: 'PUBLIC ONLY',
  status: 'accepted' as const, createdAt: '2026-11-24T00:00:00.000Z',
};
const secondMessage = {
  id: 'second', channelIndex: '1', channelName: 'Private',
  direction: 'sent' as const, text: 'PRIVATE ONLY',
  status: 'accepted' as const, createdAt: '2026-11-24T00:01:00.000Z',
};

let selectedChannel = '0';
let connected = true;
let sendReady = true;
let restoring = false;
const send = jest.fn(async (_channel: number, _message: string) => undefined);
const addLocal = jest.fn();
const selectChannel = jest.fn();

function setSource() {
  (useBushMesh as jest.Mock).mockImplementation(() => ({
    connectionStatus: connected ? 'Connected' : 'Disconnected',
    connectedDeviceName: connected ? 'Field Node' : null,
    channels,
    activeChannelIndex: selectedChannel,
    activeChannel: channels.find(c => c.channelIndex === selectedChannel) ?? null,
    channelMessages: [firstMessage, secondMessage],
    canSendChannelMessage: sendReady,
    sendChannelMessage: send,
    addLocalChannelMessage: addLocal,
    setActiveChannelIndex: selectChannel,
    messagePersistenceStatus: restoring ? 'restoring' : 'ready',
    messagePersistenceError: null,
  }));
  (useRadioSession as jest.Mock).mockReturnValue({
    snapshot: {radioProfile: null, transportReady: false},
  });
}

function press(tree: TestRenderer.ReactTestRenderer, label: string) {
  const button = tree.root.findAll(node =>
    node.props.accessibilityLabel === label &&
    typeof node.props.onPress === 'function',
  )[0];
  if (!button) throw new Error('Missing ' + label);
  button.props.onPress();
}

function edit(tree: TestRenderer.ReactTestRenderer, text: string) {
  const input = tree.root.findAllByProps({accessibilityLabel: 'Carrier message draft'})
    .find(node => typeof node.props.onChangeText === 'function');
  if (!input) throw new Error('Missing carrier composer');
  input.props.onChangeText(text);
}

function labelText(tree: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

beforeEach(() => {
  selectedChannel = '0';
  connected = true;
  sendReady = true;
  restoring = false;
  send.mockClear(); addLocal.mockClear(); selectChannel.mockClear();
  setSource();
});

test('Radio connected companion does not claim network delivery', async () => {
  connected = false; sendReady = true;
  setSource();
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {tree = TestRenderer.create(<RadioScreen />);});
  expect(labelText(tree)).toContain('DISCONNECTED');
  expect(labelText(tree)).not.toContain('NODE ONLINE');
  await act(async () => {edit(tree, 'Not sent');});
  const submit = tree.root.findAllByProps({
    accessibilityLabel: 'Submit channel text to radio',
  }).find(n => typeof n.props.onPress === 'function');
  expect(submit?.props.disabled).toBe(true);
  expect(send).not.toHaveBeenCalled();
  await act(async () => {tree.unmount();});
});

test('radio history is scoped to selected channel and technical metrics are opt-in', async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {tree = TestRenderer.create(<RadioScreen />);});
  expect(labelText(tree)).toContain('PUBLIC ONLY');
  expect(labelText(tree)).not.toContain('PRIVATE ONLY');
  expect(labelText(tree)).not.toContain('NATIVE OUTBOUND · MESHCORE COMMANDS');
  await act(async () => {press(tree, 'Show radio technical diagnostics');});
  expect(labelText(tree)).toContain('NATIVE OUTBOUND · MESHCORE COMMANDS');
  await act(async () => {press(tree, 'Hide radio technical diagnostics');});
  expect(labelText(tree)).not.toContain('NATIVE OUTBOUND · MESHCORE COMMANDS');
  await act(async () => {tree.unmount();});
});

test('carrier draft stays with its original channel after a switch', async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {tree = TestRenderer.create(<RadioScreen />);});
  await act(async () => {edit(tree, 'For public only');});
  selectedChannel = '1'; setSource();
  await act(async () => {tree.update(<RadioScreen />);});
  const newInput = tree.root.findAllByProps({
    accessibilityLabel: 'Carrier message draft',
  }).find(n => typeof n.props.onChangeText === 'function');
  expect(newInput?.props.value).toBe('');
  await act(async () => {edit(tree, 'Private draft');});
  await act(async () => {press(tree, 'Submit channel text to radio');});
  expect(send).toHaveBeenCalledWith(1, 'Private draft');
  expect(addLocal).toHaveBeenCalledWith(expect.objectContaining({
    channelIndex: '1', status: 'accepted',
  }));
  expect(addLocal).not.toHaveBeenCalledWith(expect.objectContaining({
    status: 'confirmed',
  }));
  expect(labelText(tree)).toContain('Peer delivery is not confirmed');
  selectedChannel = '0'; setSource();
  await act(async () => {tree.update(<RadioScreen />);});
  const oldInput = tree.root.findAllByProps({
    accessibilityLabel: 'Carrier message draft',
  }).find(n => typeof n.props.onChangeText === 'function');
  expect(oldInput?.props.value).toBe('For public only');
  expect(labelText(tree)).not.toContain('PRIVATE ONLY');
  await act(async () => {tree.unmount();});
});

test('carrier buttons have large targets and the loading state is honest', async () => {
  restoring = true;
  setSource();
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {tree = TestRenderer.create(<RadioScreen />);});
  expect(labelText(tree)).toContain('Restoring saved carrier messages');
  const submit = tree.root.findAllByProps({
    accessibilityLabel: 'Submit channel text to radio',
  }).find(n => typeof n.props.onPress === 'function');
  const carrier = tree.root.findAllByProps({
    accessibilityLabel: 'Choose carrier Public',
  }).find(n => typeof n.props.onPress === 'function');
  expect(StyleSheet.flatten(submit?.props.style).minHeight).toBeGreaterThanOrEqual(56);
  expect(StyleSheet.flatten(carrier?.props.style).minHeight).toBeGreaterThanOrEqual(56);
  await act(async () => {tree.unmount();});
});
