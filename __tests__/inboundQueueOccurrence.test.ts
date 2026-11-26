import {MeshCoreInboundInbox, type MeshCoreInboundEnvelope, type MeshCoreInboundObservation} from '../src/meshcore/meshcoreInboundInbox';
import {meshCoreInboundMessageId} from '../src/meshcore/meshcoreInboundIdentity';
import type {ParsedChannelMessage} from '../src/meshcore/meshcoreParsers';

const message: ParsedChannelMessage = {packetType: 'channel', channelIndex: '2', text: 'same', timestamp: 123, textType: 0, snr: null, pathLength: null};
const observation: MeshCoreInboundObservation = {version: 1, source: 'native-session', origin: 'queued-generation-unknown',
  radio: 'radio-A', configurationId: 'a'.repeat(64), configurationName: 'Convoy', timestamp: 123, snr: null, pathLength: null};
const id = (e: MeshCoreInboundEnvelope) => meshCoreInboundMessageId(e.message, e.observation?.radio, e.observation?.queueOccurrenceId);
const flush = async () => {for (let i = 0; i < 12; i += 1) await Promise.resolve();};

test('distinct matched queue replies preserve identical messages; unmatched copies have scoped fingerprints', async () => {
  const inbox = new MeshCoreInboundInbox();
  const saved: MeshCoreInboundEnvelope[] = [];
  inbox.setConsumer(async e => {saved.push(e);});
  inbox.publish(message, observation, {matchedQueueReply: true});
  inbox.publish(message, observation, {matchedQueueReply: true});
  inbox.publish(message, observation);
  inbox.publish(message, observation);
  inbox.publish(message, {...observation, radio: 'radio-B'});
  await flush();
  expect(saved).toHaveLength(5);
  expect(id(saved[0])).not.toBe(id(saved[1]));
  expect(id(saved[2])).toBe(id(saved[3]));
  expect(id(saved[2])).not.toBe(id(saved[4]));
  expect(meshCoreInboundMessageId(message)).not.toBe(id(saved[2]));
});

test('association confirmation happens once and survives a storage retry', async () => {
  jest.useFakeTimers();
  try {
    const inbox = new MeshCoreInboundInbox();
    const seen: MeshCoreInboundEnvelope[] = [];
    const confirm = jest.fn(async () => ({version: 1 as const, evidence: 'post-empty-local-observation' as const, incarnation: 2}));
    inbox.setConsumer(async e => {seen.push({...e}); if (seen.length === 1) throw new Error('storage');});
    inbox.publish(message, observation, {matchedQueueReply: true, confirmAssociation: confirm});
    await flush();
    expect(inbox.pendingCount()).toBe(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2000);
    await flush();
    expect(inbox.pendingCount()).toBe(0);
    expect(id(seen[0])).toBe(id(seen[1]));
    expect(seen[1].observation?.association?.incarnation).toBe(2);
    expect(confirm).toHaveBeenCalledTimes(1);
  } finally {jest.useRealTimers();}
});

test('failed readback persists unassociated records rather than discarding them', async () => {
  const inbox = new MeshCoreInboundInbox();
  const save = jest.fn(async (_e: MeshCoreInboundEnvelope) => undefined);
  inbox.setConsumer(save);
  inbox.publish(message, observation, {matchedQueueReply: true, confirmAssociation: async () => {throw new Error('changed');}});
  await flush();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].observation?.association).toBeUndefined();
  expect(inbox.pendingCount()).toBe(0);
});
