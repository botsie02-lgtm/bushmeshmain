import {permitsAssociatedRadioSpeech} from '../src/radio/chatManagement/radioSpeechPolicy';
import {defaultChatPreferences} from '../src/radio/chatManagement/chatPreferences';
import type {BushMeshChannelMessage} from '../src/state/BushMeshContext';

const id = 'a'.repeat(64);
const message: BushMeshChannelMessage = {
  id: 'receive', direction: 'received', status: 'confirmed', text: 'Hi',
  channelIndex: '1', channelName: 'Private', createdAt: '2026-01-01T00:00:00Z',
  conversation: {version: 1, provenance: 'local-observation', radioId: 'radio-A', channelGeneration: 'config:2:' + id, channelIndex: '1', channelName: 'Private'},
};
const entries = {[id]: {...defaultChatPreferences, configuration: {id, radio: 'radio-A', slot: 1, name: 'Private', privateChannel: true}, incarnation: 2, retired: false, autoRead: false}};
test('only an exact local association is muted for ordinary auto-read', () => {
  expect(permitsAssociatedRadioSpeech(message, entries)).toBe(false);
  expect(permitsAssociatedRadioSpeech(message, {[id]: {...entries[id], autoRead: true}})).toBe(true);
  expect(permitsAssociatedRadioSpeech({...message, conversation: undefined}, entries)).toBe(true);
  expect(permitsAssociatedRadioSpeech({...message, conversation: {...message.conversation!, radioId: 'radio-B'}}, entries)).toBe(true);
  expect(permitsAssociatedRadioSpeech({...message, conversation: {...message.conversation!, channelGeneration: 'config:1:' + id}}, entries)).toBe(true);
  expect(permitsAssociatedRadioSpeech({...message, conversation: {...message.conversation!, provenance: 'local-submission'}}, entries)).toBe(true);
});

test('timed speech mute expires without changing other scopes', () => {
  const timed = {[id]: {...entries[id], autoRead: true, speechMutedUntilMs: 2000}};
  expect(permitsAssociatedRadioSpeech(message, timed, 1999)).toBe(false);
  expect(permitsAssociatedRadioSpeech(message, timed, 2000)).toBe(true);
  expect(permitsAssociatedRadioSpeech({...message, conversation: undefined}, timed, 1999)).toBe(true);
});
