import {Buffer} from 'buffer';
import {meshCoreSha256Hex} from '../meshcore/meshcoreInboundIdentity';
import {equalScope, type RadioConversationScope} from '../screens/radioMessenger/messengerModel';
import type {BushMeshChannelMessage} from '../state/BushMeshContext';

/** Encrypted with the history snapshot, never stored as plaintext. */
export type HistoryRetention = {version: 1; deletedIds: string[]; possibleReplayKeys: string[]};

export function validateHistoryRetention(value: unknown): asserts value is HistoryRetention {
  const r = value as HistoryRetention | null;
  if (!r || r.version !== 1 || !Array.isArray(r.deletedIds) || !Array.isArray(r.possibleReplayKeys) ||
      r.deletedIds.some(id => typeof id !== 'string' || !id || id.length > 256) ||
      r.possibleReplayKeys.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) throw new Error('Invalid encrypted history retention ledger.');
}

/** A possible replay is not proof of duplicate receipt. Preserve it separately
 * rather than deleting a legitimate equal message or silently restoring a cleared chat. */
function replayKey(m: BushMeshChannelMessage): string | undefined {
  const c = m.conversation;
  if (m.direction !== 'received' || c?.provenance !== 'local-observation' || !m.observation) return undefined;
  return meshCoreSha256Hex(Buffer.from(JSON.stringify(['cleared-chat-replay-v1', c.radioId, c.channelGeneration,
    c.channelIndex, c.channelName, m.observation.timestamp, m.text]), 'utf8'));
}

export function applyHistoryRetention(messages: BushMeshChannelMessage[], retention?: HistoryRetention): BushMeshChannelMessage[] {
  if (!retention) return messages;
  validateHistoryRetention(retention);
  const deleted = new Set(retention.deletedIds);
  const possible = new Set(retention.possibleReplayKeys);
  return messages.flatMap(m => {
    if (deleted.has(m.id)) return [];
    const key = possible.size ? replayKey(m) : undefined;
    if (!key || !possible.has(key) || !m.observation) return [m];
    const observation = {...m.observation, retentionReason: 'possible-cleared-record-replay' as const};
    delete observation.association;
    const record = {...m, observation};
    delete record.conversation;
    return [record];
  });
}

export function planConversationClear(messages: readonly BushMeshChannelMessage[], scope: RadioConversationScope, previous?: HistoryRetention) {
  if (!/^config:[1-9][0-9]*:[a-f0-9]{64}$/.test(scope.channelGeneration)) throw new Error('Exact persisted incarnation required.');
  const selected = messages.filter(m => equalScope(m.conversation, scope));
  if (selected.some(m => m.direction === 'sent' && m.status === 'pending')) throw new Error('Resolve pending submissions before clearing history.');
  const deletedIds = selected.map(m => m.id);
  const retention: HistoryRetention = {version: 1,
    deletedIds: [...new Set([...(previous?.deletedIds ?? []), ...deletedIds])],
    possibleReplayKeys: [...new Set([...(previous?.possibleReplayKeys ?? []), ...selected.flatMap(m => {const k = replayKey(m); return k ? [k] : [];})])],
  };
  validateHistoryRetention(retention);
  return {deletedIds, retention, remaining: applyHistoryRetention([...messages], retention)};
}
