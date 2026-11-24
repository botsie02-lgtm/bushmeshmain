import {
  carrierMessageSummary,
  deriveRadioPresentation,
  scopedCarrierHistory,
} from '../src/screens/radioPresentation';
import type {BushMeshChannelMessage} from '../src/state/BushMeshContext';

const messages: BushMeshChannelMessage[] = [
  {
    id: 'incoming-a', channelIndex: '0', channelName: 'Public',
    text: 'heard', direction: 'received', status: 'accepted',
    createdAt: '2026-11-24T00:00:00.000Z',
  },
  {
    id: 'accepted-a', channelIndex: '0', channelName: 'Public',
    text: 'locally submitted', direction: 'sent', status: 'accepted',
    createdAt: '2026-11-24T00:01:00.000Z',
  },
  {
    id: 'pending-b', channelIndex: '1', channelName: 'Private',
    text: 'waiting', direction: 'sent', status: 'pending',
    createdAt: '2026-11-24T00:02:00.000Z',
  },
  {
    id: 'confirmed-b', channelIndex: '1', channelName: 'Private',
    text: 'acknowledged', direction: 'sent', status: 'confirmed',
    createdAt: '2026-11-24T00:03:00.000Z',
  },
];

function link(override: Partial<Parameters<typeof deriveRadioPresentation>[0]> = {}) {
  return deriveRadioPresentation({
    connected: false, canSendChannelMessage: false,
    channelIndex: null, channelName: null, protocolTransportReady: false,
    ...override,
  });
}

test('disconnected companion never grants text submission', () => {
  const disconnected = link({
    connected: false, canSendChannelMessage: true, channelIndex: '1',
    channelName: 'Carrier', protocolTransportReady: true,
  });
  expect(disconnected.phase).toBe('disconnected');
  expect(disconnected.maySubmitCarrierText).toBe(false);
  expect(disconnected.badge).toBe('DISCONNECTED');
});

test('connected companion without active carrier or handler is link-only', () => {
  expect(link({connected: true}).phase).toBe('link-only');
  const noHandler = link({connected: true, channelIndex: '0', channelName: 'Public'});
  expect(noHandler.maySubmitCarrierText).toBe(false);
  const badIndex = link({
    connected: true, canSendChannelMessage: true,
    channelIndex: '999', channelName: 'Public',
  });
  expect(badIndex.maySubmitCarrierText).toBe(false);
});

test('carrier send readiness is separate from canonical data runtime and peer delivery', () => {
  const partial = link({
    connected: true, canSendChannelMessage: true, channelIndex: '1',
    channelName: 'Carrier', protocolTransportReady: false,
  });
  expect(partial.phase).toBe('carrier-ready');
  expect(partial.maySubmitCarrierText).toBe(true);
  expect(partial.explanation).toContain('not ready');
  const ready = link({
    connected: true, canSendChannelMessage: true, channelIndex: '1',
    channelName: 'Carrier', protocolTransportReady: true,
  });
  expect(ready.phase).toBe('runtime-ready');
  expect(ready.explanation).toContain('acknowledgement');
});

test('missing selected channel must not reveal a mixed conversation', () => {
  expect(scopedCarrierHistory(null, messages)).toEqual([]);
  expect(scopedCarrierHistory('0', messages).map(item => item.id))
    .toEqual(['incoming-a', 'accepted-a']);
  expect(scopedCarrierHistory('1', messages).map(item => item.id))
    .toEqual(['pending-b', 'confirmed-b']);
});

test('radio acceptance is not peer confirmation', () => {
  const summary = carrierMessageSummary(messages);
  expect(summary).toEqual({
    received: 1, pending: 1, accepted: 1, confirmed: 1, failed: 0,
  });
  expect(carrierMessageSummary([messages[1]]).confirmed).toBe(0);
  expect(carrierMessageSummary([messages[0]]).confirmed).toBe(0);
});
