import {
  sanitizeConversationSelection,
} from '../src/app/activeContext/ViewedConversationContext';

test('conversation routing is a separate reference and strips sensitive extra properties', () => {
  const forgedCarrier = {
    kind: 'meshcore-channel' as const,
    channelIndex: '2',
    secretHex: '1111222233334444',
  };
  expect(sanitizeConversationSelection(forgedCarrier)).toEqual({
    kind: 'meshcore-channel',
    channelIndex: '2',
  });
  expect(JSON.stringify(sanitizeConversationSelection(forgedCarrier))).not.toContain('secretHex');
  expect(sanitizeConversationSelection({kind: 'direct-peer', peerIdentityRef: 'PEER01'})).toEqual({
    kind: 'direct-peer', peerIdentityRef: 'PEER01',
  });
  expect(sanitizeConversationSelection({kind: 'operational-convoy', convoyId: 'C0FFEE'})).toEqual({
    kind: 'operational-convoy', convoyId: 'C0FFEE',
  });
  expect(sanitizeConversationSelection(null)).toBeNull();
});

test('invalid conversation references are not accepted into navigation state', () => {
  expect(() => sanitizeConversationSelection({
    kind: 'meshcore-channel',
    channelIndex: '',
  })).toThrow('Invalid conversation reference');
  expect(() => sanitizeConversationSelection({
    kind: 'direct-peer',
    peerIdentityRef: 'has spaces',
  })).toThrow('Invalid conversation reference');
});
