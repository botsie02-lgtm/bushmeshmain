import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Alert, BackHandler, TextInput} from 'react-native';
import {ChatManagementDialog, ChatSettingsPage} from '../src/radio/chatManagement/ChatManagementDialog';
import {ChatManagementController} from '../src/radio/chatManagement/useChatManagement';
import {ChatConfiguration, defaultChatPreferences} from '../src/radio/chatManagement/chatPreferences';
import {encodeChatInvite} from '../src/radio/chatManagement/chatInvitations';
import {protectedChannelKey} from '../src/native/SensitiveClipboard';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));

const chat: ChatConfiguration = {
  id: 'a'.repeat(64), radio: 'radio-a', slot: 1, name: 'Camp', privateChannel: true,
};

function controller() {
  const provision = jest.fn().mockResolvedValue(chat);
  const value: ChatManagementController = {
    radio: chat.radio, sessionEpoch: 1, busy: false, radioBusy: false, error: null, ready: true,
    capacity: {used: 1, total: 4}, chats: [chat],
    preferences: {[chat.id]: {...defaultChatPreferences, localCreator: true, origin: 'created'}},
    refresh: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    updateLocal: jest.fn().mockResolvedValue(undefined),
    provision, leave: jest.fn().mockResolvedValue(undefined),
    credential: jest.fn().mockResolvedValue('ab'.repeat(16)),
    isCurrentRadio: jest.fn(radio => radio === chat.radio),
    sort: 'name', changeSort: jest.fn().mockResolvedValue(undefined), invalidate: jest.fn(),
  };
  return {value, provision};
}

function press(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const action = renderer.root.findAllByProps({accessibilityLabel: label})
    .find(node => typeof node.props.onPress === 'function');
  if (!action) throw new Error('Missing action ' + label);
  action.props.onPress();
}

function visibleText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root.findAllByType('Text' as unknown as React.ElementType)
    .map(node => node.props.children).flat(Infinity).join(' ');
}

test('join invitation requires review and explicit confirmation and does not render the key in review', async () => {
  const {value, provision} = controller();
  const onProvisioned = jest.fn();
  const onClose = jest.fn();
  const secretHex = 'AB'.repeat(16);
  const invitation = encodeChatInvite({name: 'Trip', secretHex});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<ChatManagementDialog
      selection={{kind: 'join', radio: chat.radio}} controller={value}
      onClose={onClose} onProvisioned={onProvisioned}/>);
  });
  await ReactTestRenderer.act(() => {
    const input = renderer.root.findAllByType(TextInput)
      .find(node => node.props.accessibilityLabel === 'Private invitation');
    expect(input?.props.secureTextEntry).toBe(true);
    input?.props.onChangeText(invitation);
  });
  await ReactTestRenderer.act(() => press(renderer, 'Review chat'));
  expect(provision).not.toHaveBeenCalled();
  expect(visibleText(renderer)).toContain('Trip');
  expect(JSON.stringify(renderer.toJSON())).not.toContain(secretHex);
  expect(JSON.stringify(renderer.toJSON())).not.toContain(invitation);
  await ReactTestRenderer.act(async () => press(renderer, 'Confirm and join'));
  expect(provision).toHaveBeenCalledWith(chat.radio, {
    name: 'Trip', secretHex, personalisation: {description: '', avatarColor: 'lime', avatarIcon: 'initials'},
  });
  expect(onProvisioned).toHaveBeenCalledWith(chat);
  expect(onClose).toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('settings distinguish local creator from network authority and expose no automatic credential', async () => {
  const {value} = controller();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<ChatSettingsPage chat={chat} controller={value} onClose={jest.fn()}/>);
  });
  expect(visibleText(renderer)).toContain('Created on this phone');
  expect(visibleText(renderer)).toContain('does not grant authority');
  expect(visibleText(renderer)).toContain('Individual chat mute and auto-read are not available');
  expect(value.credential).not.toHaveBeenCalled();
  expect(value.leave).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('shared key reveal requires explicit action and clears protected display when radio changes', async () => {
  const {value} = controller();
  const reveal = jest.spyOn(protectedChannelKey, 'reveal').mockResolvedValue(undefined);
  const hide = jest.spyOn(protectedChannelKey, 'hide').mockImplementation(() => undefined);
  jest.spyOn(protectedChannelKey, 'supported').mockReturnValue(true);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  const close = jest.fn();
  try {
    await ReactTestRenderer.act(() => {renderer = ReactTestRenderer.create(<ChatSettingsPage chat={chat} controller={value} onClose={close}/>);});
    expect(value.credential).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => press(renderer, 'Reveal shared channel key'));
    expect(value.credential).toHaveBeenCalledWith(chat);
    expect(reveal).toHaveBeenCalledWith('ab'.repeat(16));
    expect(visibleText(renderer)).not.toContain('ab'.repeat(16));
    await ReactTestRenderer.act(() => {renderer.update(<ChatSettingsPage chat={chat} controller={{...value, radio: 'other', sessionEpoch: 2, ready: false}} onClose={close}/>);});
    expect(hide).toHaveBeenCalled();
  } finally {
    if (renderer) await ReactTestRenderer.act(() => renderer.unmount());
    jest.restoreAllMocks();
  }
});

test('busy management page always permits visible Back and Android Back', async () => {
  const {value} = controller();
  const close = jest.fn();
  const back = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({remove: jest.fn()});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  try {
    await ReactTestRenderer.act(() => {renderer = ReactTestRenderer.create(<ChatManagementDialog selection={{kind: 'settings', chat}} controller={{...value, busy: true}} onClose={close}/>);});
    const button = renderer.root.findAllByProps({accessibilityLabel: 'Back'}).find(n => typeof n.props.onPress === 'function');
    expect(button?.props.disabled).not.toBe(true);
    await ReactTestRenderer.act(() => press(renderer, 'Back'));
    expect(close).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(() => {expect(back.mock.calls[back.mock.calls.length - 1][1]()).toBe(true);});
    expect(close).toHaveBeenCalledTimes(2);
    expect(value.leave).not.toHaveBeenCalled();
  } finally {if (renderer) await ReactTestRenderer.act(() => renderer.unmount()); back.mockRestore();}
});

test('leave closes the exact settings target only on confirmed removal', async () => {
  const {value} = controller();
  const left = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {buttons?.find(b => b.text === 'Leave chat')?.onPress?.();});
  let confirmed: (() => void) | undefined;
  (value.leave as jest.Mock).mockImplementation(async (_chat, callback) => {confirmed = callback;});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  try {
    await ReactTestRenderer.act(() => {renderer = ReactTestRenderer.create(<ChatSettingsPage chat={chat} controller={value} onClose={jest.fn()} onLeft={left}/>);});
    await ReactTestRenderer.act(() => press(renderer, 'Leave and clear radio slot'));
    expect(left).not.toHaveBeenCalled();
    expect(confirmed).toBeDefined();
    await ReactTestRenderer.act(() => confirmed?.());
    expect(left).toHaveBeenCalledWith(chat);
  } finally {if (renderer) await ReactTestRenderer.act(() => renderer.unmount()); alert.mockRestore();}
});
