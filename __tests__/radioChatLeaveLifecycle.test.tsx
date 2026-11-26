import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useChatManagement, type ChatManagementController} from '../src/radio/chatManagement/useChatManagement';
import {chatPreferenceStore, defaultChatPreferences} from '../src/radio/chatManagement/chatPreferences';
import {ChatOperationError} from '../src/radio/chatManagement/chatInvitations';
import {useRadioConnection} from '../src/state/RadioConnectionContext';

jest.mock('../src/state/RadioConnectionContext', () => ({useRadioConnection: jest.fn()}));

const chat = {id: 'a'.repeat(64), radio: 'fixture-radio', slot: 1, name: 'Camp', privateChannel: true};
const prefs = {[chat.id]: {...defaultChatPreferences, configuration: chat, incarnation: 1, retired: false}};

describe('leave lifecycle independently of settings visibility', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  let current: ChatManagementController;
  const list = jest.fn(async () => [chat]);
  const remove = jest.fn(async (_chat: typeof chat, phase?: (value: 'removing' | 'verifying' | 'removed') => void) => {
    phase?.('removing'); phase?.('verifying'); phase?.('removed');
  });
  function Probe() {current = useChatManagement(); return null;}
  beforeEach(async () => {
    list.mockReset(); list.mockResolvedValue([chat]);
    remove.mockReset(); remove.mockImplementation(async (_chat, phase) => {phase?.('removing'); phase?.('verifying'); phase?.('removed');});
    (useRadioConnection as jest.Mock).mockReturnValue({
      getChatRadio: () => chat.radio, getChatSessionEpoch: () => 1,
      snapshot: {channels: [chat], isWriting: false}, listChatConfigurations: list, leaveChat: remove,
    });
    jest.spyOn(chatPreferenceStore, 'loadState').mockResolvedValue({entries: prefs, sort: 'recent'});
    jest.spyOn(chatPreferenceStore, 'rememberConfigurations').mockResolvedValue(prefs);
    await act(async () => {renderer = TestRenderer.create(<Probe/>);});
    await act(async () => {await current.refresh();});
    expect(current.ready).toBe(true);
  });
  afterEach(async () => {await act(async () => renderer.unmount()); jest.restoreAllMocks();});

  test('verified removal notifies navigation even when subsequent full refresh fails', async () => {
    const confirmed = jest.fn();
    list.mockRejectedValueOnce(new Error('refresh timeout'));
    await act(async () => {await current.leave(chat, confirmed, 1);});
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(current.chats).toEqual([]);
    expect(current.preferences[chat.id].retired).toBe(true);
    expect(current.error).toContain('removed successfully, but refresh failed');
    expect(current.busy).toBe(false);
    expect(current.ready).toBe(false);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test('uncertain removal does not navigate or retry and releases busy state', async () => {
    const confirmed = jest.fn();
    remove.mockRejectedValueOnce(new ChatOperationError('partial', 'The radio slot may have been cleared.'));
    await act(async () => {await expect(current.leave(chat, confirmed, 1)).rejects.toMatchObject({code: 'partial'});});
    expect(confirmed).not.toHaveBeenCalled();
    expect(current.busy).toBe(false);
    expect(current.ready).toBe(false);
    expect(current.error).toContain('may have been cleared');
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
