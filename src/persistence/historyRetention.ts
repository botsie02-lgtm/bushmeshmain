import {Buffer} from 'buffer';
import {meshCoreSha256Hex} from '../meshcore/meshcoreInboundIdentity';
import {equalScope, type RadioConversationScope} from '../screens/radioMessenger/messengerModel';
import type {BushMeshChannelMessage} from '../state/BushMeshContext';

/** Encrypted with the history snapshot, never stored as plaintext. */
export type HistoryRetention = {version: 1; deletedIds: string[]; possibleReplayKeys: {bucket: string; digest: string}[]};

export function validateHistoryRetention(value: unknown): asserts value is HistoryRetention {
  const r = value as HistoryRetention | null;
  if (!r || r.version !== 1 || !Array.isArray(r.deletedIds) || !Array.isArray(r.possibleReplayKeys) ||
      r.deletedIds.some(id => typeof id !== 'string' || !id || id.length > 256) ||
      r.possibleReplayKeys.some(key => !key || typeof key.bucket !== 'string' || !key.bucket || key.bucket.length > 2048 || typeof key.digest !== 'string' || !/^[a-f0-9]{64}$/.test(key.digest))) throw new Error('Invalid encrypted history retention ledger.');
}

/** A possible replay is not proof of duplicate receipt. Preserve it separately
 * rather than deleting a legitimate equal message or silently restoring a cleared chat. */
function replayBucket(m: BushMeshChannelMessage): string | undefined {
  const c = m.conversation;
  if (m.direction !== 'received' || c?.provenance !== 'local-observation' || !m.observation) return undefined;
  return JSON.stringify(['cleared-chat-replay-v1', c.radioId, c.channelGeneration, c.channelIndex, c.channelName, m.observation.timestamp]);
}
function replayDigest(bucket: string, text: string): string {
  return meshCoreSha256Hex(Buffer.from(JSON.stringify([bucket, text]), 'utf8'));
}

export function applyHistoryRetention(messages: BushMeshChannelMessage[], retention?: HistoryRetention): BushMeshChannelMessage[] {
  if (!retention) return messages;
  validateHistoryRetention(retention);
  const deleted = new Set(retention.deletedIds);
  // Hash text only when the exact scope and firmware timestamp have a cleared
  // candidate. Avoid a full cryptographic hash of every ordinary history row.
  const possible = new Map<string, Set<string>>();
  for (const key of retention.possibleReplayKeys) {
    const digests = possible.get(key.bucket) ?? new Set<string>();
    digests.add(key.digest);
    possible.set(key.bucket, digests);
  }
  return messages.flatMap(m => {
    if (deleted.has(m.id)) return [];
    const bucket = possible.size ? replayBucket(m) : undefined;
    const digests = bucket ? possible.get(bucket) : undefined;
    if (!bucket || !digests?.has(replayDigest(bucket, m.text)) || !m.observation) return [m];
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
  const keys = new Map<string, {bucket: string; digest: string}>();
  for (const key of previous?.possibleReplayKeys ?? []) keys.set(JSON.stringify([key.bucket,key.digest]), key);
  for (const m of selected) {
    const bucket = replayBucket(m);
    if (!bucket) continue;
    const digest = replayDigest(bucket, m.text);
    keys.set(JSON.stringify([bucket,digest]), {bucket,digest});
  }
  const retention: HistoryRetention = {version: 1,
    deletedIds: [...new Set([...(previous?.deletedIds ?? []), ...deletedIds])],
    possibleReplayKeys: [...keys.values()],
  };
  validateHistoryRetention(retention);
  return {deletedIds, retention, remaining: applyHistoryRetention([...messages], retention)};
}
