import {
  buildMessengerConversations, conversationKey, deliveryText,
  equalScope, quarantineCount, scopedMessages, validateCarrierText,
  type MessageOwnershipProof, type RadioConversationScope,
} from '../src/screens/radioMessenger/messengerModel';
import type {BushMeshChannelMessage, BushMeshChannel} from '../src/state/BushMeshContext';

const scope: RadioConversationScope = {
  radioId: 'AA:BB:CC:DD', channelIndex: '1',
  channelName: 'Trail Group', channelGeneration: 'session-7',
};
const otherRadio: RadioConversationScope = {...scope, radioId: '11:22:33:44'};
const reconfigured: RadioConversationScope = {...scope, channelGeneration: 'session-8'};

function msg(id: string, index: string, channelName: string, text: string,
  createdAt = '2026-11-26T01:00:00Z'): BushMeshChannelMessage {
  return {
    id, channelIndex: index, channelName, text,
    direction: 'received', status: 'confirmed', createdAt,
  };
}

const channels: BushMeshChannel[] = [
  {channelIndex: '1', channelName: 'Trail Group', secret: 'Private (not for UI)'},
  {channelIndex: '2', channelName: 'Camp', secret: 'Empty / Public'},
];

test('unscoped slot-only encrypted history is quarantined even when names match', () => {
  const first = msg('before-reconfiguration', '1', 'Trail Group', 'Old message');
  expect(scopedMessages([first], scope)).toEqual([]);
  const rows = buildMessengerConversations({
    channels, scopes: [scope], messages: [first],
  });
  expect(rows[0].preview).toBe('No attributed messages yet');
  expect(quarantineCount([first], new Set())).toBe(1);
});

test('a message must have exact radio address, config generation, slot and name proof', () => {
  const first = msg('m', '1', 'Trail Group', 'Bound message');
  const proof: MessageOwnershipProof = {...scope};
  expect(scopedMessages([first], scope, {m: proof})).toHaveLength(1);
  expect(scopedMessages([first], otherRadio, {m: proof})).toHaveLength(0);
  expect(scopedMessages([first], reconfigured, {m: proof})).toHaveLength(0);
  expect(scopedMessages([first], {...scope, channelName: 'Other'}, {m: proof})).toHaveLength(0);
  expect(scopedMessages([first], {...scope, channelIndex: '0'}, {m: proof})).toHaveLength(0);
  expect(equalScope(scope, proof)).toBe(true);
  expect(equalScope(scope, reconfigured)).toBe(false);
});

test('observations from one mounted session do not imply persisted ownership', () => {
  const incoming = msg('new', '1', 'Trail Group', 'Live only');
  expect(scopedMessages([incoming], scope, {}, {new: scope})).toEqual([{
    message: incoming, provenance: 'session',
  }]);
  expect(scopedMessages([incoming], reconfigured, {}, {new: scope})).toEqual([]);
});

test('conversation ordering uses attributed activity and local pins, not historic slot reuse', () => {
  const camp = {...scope, channelIndex: '2', channelName: 'Camp'};
  const first = msg('1', '1', 'Trail Group', 'Hey', '2026-11-25T21:00:00Z');
  const last = msg('2', '2', 'Camp', 'See you soon', '2026-11-26T00:00:00Z');
  const current = buildMessengerConversations({
    channels, scopes: [scope, camp], messages: [first, last],
    verifiedOwnership: {'1': scope, '2': camp},
  });
  expect(current.map(x => x.channel.channelName)).toEqual(['Camp', 'Trail Group']);
  expect(current[0].preview).toBe('See you soon');
  const pinned = buildMessengerConversations({
    channels, scopes: [scope, camp], messages: [first, last],
    verifiedOwnership: {'1': scope, '2': camp},
    pinned: new Set([conversationKey(scope)]), search: 'trail',
  });
  expect(pinned).toHaveLength(1);
  expect(pinned[0].pinned).toBe(true);
});

test('unread count is unavailable without read authority and only shown when supplied', () => {
  const empty = buildMessengerConversations({
    channels, scopes: [scope], messages: [],
  });
  expect(empty[0].unreadCount).toBeNull();
  const known = buildMessengerConversations({
    channels, scopes: [scope], messages: [],
    unread: {[conversationKey(scope)]: 3},
  });
  expect(known[0].unreadCount).toBe(3);
});

test('validates actual 133 UTF-8 bytes, including emoji and multibyte characters', () => {
  expect(validateCarrierText('   ').valid).toBe(false);
  expect(validateCarrierText('a'.repeat(133)).valid).toBe(true);
  expect(validateCarrierText('a'.repeat(134)).valid).toBe(false);
  expect(validateCarrierText('🌲'.repeat(33)).bytes).toBe(132);
  expect(validateCarrierText('🌲'.repeat(33)).valid).toBe(true);
  expect(validateCarrierText('🌲'.repeat(34)).bytes).toBe(136);
  expect(validateCarrierText('🌲'.repeat(34)).valid).toBe(false);
  expect(validateCarrierText('🌲'.repeat(34)).issue).toContain('133 UTF-8');
});

test('status labels do not invent acknowledgements; uncertain acceptance blocks automatic retry', () => {
  const pending = msg('p', '1', 'Trail Group', 'x');
  expect(deliveryText({...pending, direction: 'sent', status: 'pending'}))
    .toBe('Pending radio response');
  expect(deliveryText({...pending, direction: 'sent', status: 'accepted'}))
    .toContain('delivery not confirmed');
  expect(deliveryText({...pending, direction: 'sent', status: 'confirmed'}))
    .toContain('matching ACK');
  expect(deliveryText({...pending, direction: 'sent', status: 'failed',
    submissionFailure: {reason: 'timeout'}})).toContain('do not auto-retry');
  expect(deliveryText({...pending, direction: 'sent', status: 'failed',
    submissionFailure: {reason: 'firmware-error', firmwareCode: 2}}))
    .toBe('Radio rejected');
});
