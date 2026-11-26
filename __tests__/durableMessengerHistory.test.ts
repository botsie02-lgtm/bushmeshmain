import {createMessageSnapshot, decodeMessageSnapshot, encodeMessageSnapshot} from '../src/persistence/messageSnapshot';
import {scopedMessages} from '../src/screens/radioMessenger/messengerModel';
import type {BushMeshChannelMessage} from '../src/state/BushMeshContext';

const scope = {radioId: 'radio-a', channelGeneration: 'config:1:' + 'a'.repeat(64), channelIndex: '1', channelName: 'Camp'};
const sent: BushMeshChannelMessage = {id: 'local-send', channelIndex: '1', channelName: 'Camp', direction: 'sent', status: 'pending',
  text: 'Ready', createdAt: new Date(0).toISOString(), conversation: {...scope, version: 1, provenance: 'local-submission'}};

test('journal and protected scope survive snapshot restart, while legacy same-slot records stay separate', () => {
  const legacy: BushMeshChannelMessage = {...sent, id: 'legacy', conversation: undefined, direction: 'received', status: 'confirmed'};
  const restored = decodeMessageSnapshot(encodeMessageSnapshot(createMessageSnapshot([sent, legacy])));
  const proof = Object.fromEntries(restored.messages.flatMap(m => m.conversation ? [[m.id, m.conversation]] : []));
  expect(scopedMessages(restored.messages, scope, proof).map(m => m.message.id)).toEqual(['local-send']);
  expect(scopedMessages(restored.messages, {...scope, channelGeneration: 'config:2:' + 'a'.repeat(64)}, proof)).toEqual([]);
  expect(scopedMessages(restored.messages, {...scope, channelGeneration: 'config:1:' + 'b'.repeat(64)}, proof)).toEqual([]);
  expect(restored.messages.find(m => m.id === sent.id)?.status).toBe('pending');
});

test('history snapshot retains more than the previous 500-message cap', () => {
  const messages = Array.from({length: 650}, (_, index) => ({...sent, id: String(index)}));
  expect(decodeMessageSnapshot(encodeMessageSnapshot(createMessageSnapshot(messages))).messages).toHaveLength(650);
});
