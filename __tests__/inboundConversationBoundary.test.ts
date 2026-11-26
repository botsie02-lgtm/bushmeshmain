import {InboundConversationBoundary} from '../src/radio/chatManagement/InboundConversationBoundary';
import {defaultChatPreferences} from '../src/radio/chatManagement/chatPreferences';
import {createMessageSnapshot, decodeMessageSnapshot, encodeMessageSnapshot} from '../src/persistence/messageSnapshot';
import type {BushMeshChannelMessage} from '../src/state/BushMeshContext';
import {scopedMessages} from '../src/screens/radioMessenger/messengerModel';

const radio = 'radio-A';
const config = {id: 'a'.repeat(64), radio, slot: 2, name: 'Convoy', privateChannel: true};
const entries = {[config.id]: {...defaultChatPreferences, configuration: config, incarnation: 3, retired: false}};

test('startup backlog and pre-verification reads cannot establish a local association', () => {
  const boundary = new InboundConversationBoundary();
  boundary.startRead(radio, 1);
  boundary.install(radio, 1, [config], entries);
  boundary.emptyReply(radio, 1);
  boundary.startRead(radio, 1);
  expect(boundary.observe(radio, 1, '2', true, true)?.incarnation).toBeUndefined();
  boundary.emptyReply(radio, 1);
  boundary.startRead(radio, 1);
  expect(boundary.observe(radio, 1, '2', true, true)?.incarnation).toBe(3);
  expect(boundary.observe(radio, 1, '2', false, true)?.incarnation).toBeUndefined();
});

test('radio changes, mutations, failures and catalogue replacement invalidate association', () => {
  const b = new InboundConversationBoundary();
  b.install(radio, 1, [config], entries);
  b.startRead(radio, 1); b.emptyReply(radio, 1); b.startRead(radio, 1);
  expect(b.observe('radio-B', 1, '2', true, true)).toBeUndefined();
  expect(b.observe(radio, 2, '2', true, true)).toBeUndefined();
  expect(b.observe(radio, 1, '2', true, false)).toBeUndefined();
  b.loseEvidence();
  expect(b.observe(radio, 1, '2', true, true)?.incarnation).toBeUndefined();
  b.install(radio, 1, [config], {[config.id]: {...entries[config.id], incarnation: 4}});
  b.startRead(radio, 1); b.emptyReply(radio, 1); b.startRead(radio, 1);
  expect(b.observe(radio, 1, '2', true, true)?.incarnation).toBe(4);
});

test('missing or retired catalogue entries never authorize association', () => {
  const b = new InboundConversationBoundary();
  b.install(radio, 1, [config], {[config.id]: {...entries[config.id], retired: true}});
  b.startRead(radio, 1); b.emptyReply(radio, 1); b.startRead(radio, 1);
  expect(b.observe(radio, 1, '2', true, true)?.incarnation).toBeUndefined();
});

const message: BushMeshChannelMessage = {
  id: 'receive-1', direction: 'received', status: 'confirmed', channelIndex: '2', channelName: 'Convoy',
  text: 'Hello', createdAt: '2026-11-26T00:00:00Z',
  conversation: {version: 1, provenance: 'local-observation', radioId: radio,
    channelGeneration: 'config:3:' + config.id, channelIndex: '2', channelName: 'Convoy'},
  observation: {version: 1, source: 'native-session', origin: 'queued-generation-unknown', radio,
    configurationId: config.id, configurationName: config.name, timestamp: 123, snr: null, pathLength: null,
    association: {version: 1, evidence: 'post-empty-local-observation', incarnation: 3}},
};
test('local receive associations survive snapshot restoration without claiming verified history', () => {
  const [restored] = decodeMessageSnapshot(encodeMessageSnapshot(createMessageSnapshot([message]))).messages;
  expect(restored).toEqual(message);
  expect(scopedMessages([restored], message.conversation!, {[message.id]: restored.conversation!})[0].provenance).toBe('local-observation');
  expect(scopedMessages([restored], {...message.conversation!, channelGeneration: 'config:4:' + config.id}, {[message.id]: restored.conversation!})).toEqual([]);
});
test('snapshot rejects mismatched or fabricated local receive scopes', () => {
  expect(() => createMessageSnapshot([{...message, conversation: {...message.conversation!, radioId: 'other'}}])).toThrow();
  expect(() => createMessageSnapshot([{...message, observation: undefined}])).toThrow();
  expect(() => createMessageSnapshot([{...message, conversation: undefined}])).toThrow();
});

test('readback revision is invalidated by errors and by refreshed catalogues', () => {
  const b = new InboundConversationBoundary();
  b.install(radio, 1, [config], entries);
  b.startRead(radio, 1); b.emptyReply(radio, 1); b.startRead(radio, 1);
  const observation = b.observe(radio, 1, '2', true, true)!;
  expect(b.isCurrent(radio, 1, config.id, 3, observation.revision)).toBe(true);
  b.loseEvidence();
  b.startRead(radio, 1); b.emptyReply(radio, 1);
  expect(b.isCurrent(radio, 1, config.id, 3, observation.revision)).toBe(false);
});
