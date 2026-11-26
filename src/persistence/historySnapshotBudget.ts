import type {BushMeshMessageSnapshotV1} from './messageSnapshot';

// Mirror the absolute native ceiling; native also checks actual heap headroom.
// This is an admission guard, never a retention count or an eviction policy.
export const HISTORY_MAX_BRIDGE_BYTES = 16 * 1024 * 1024;
export const HISTORY_CAPACITY_MESSAGE = 'Encrypted history exceeds the safe snapshot memory budget. Existing history retained. Export or clear selected local history to free capacity; new messages are not confirmed saved.';

export function utf8SnapshotBytes(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length &&
        value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {bytes += 4; i++;}
    else bytes += 3;
  }
  return bytes;
}

/** Count serialized rows independently, stopping before creating an oversized
 * full JSON string or crossing the bridge. Includes the second retention
 * argument in the same budget. Snapshot rows are plain validated JSON data. */
export function assertHistoryBridgeBudget(snapshot: BushMeshMessageSnapshotV1, limit = HISTORY_MAX_BRIDGE_BYTES): number {
  const {messages, ...header} = snapshot;
  let bytes = utf8SnapshotBytes(JSON.stringify({...header, messages: []}));
  if (snapshot.retention) bytes += utf8SnapshotBytes(JSON.stringify(snapshot.retention));
  const check = () => {if (bytes > limit) throw new Error(HISTORY_CAPACITY_MESSAGE);};
  check();
  for (let i = 0; i < messages.length; i++) {
    bytes += utf8SnapshotBytes(JSON.stringify(messages[i])) + (i > 0 ? 1 : 0);
    check();
  }
  return bytes;
}
