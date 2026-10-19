import type {BushMeshChannelMessage} from '../state/BushMeshContext';

export const BUSHMESH_MESSAGE_SNAPSHOT_VERSION = 1 as const;
export const BUSHMESH_MAX_PERSISTED_MESSAGES = 500;

export type BushMeshMessageSnapshotV1 = {
  version: typeof BUSHMESH_MESSAGE_SNAPSHOT_VERSION;
  savedAtMs: number;
  messages: BushMeshChannelMessage[];
};

const DIRECTIONS = new Set(['sent', 'received']);
const STATUSES = new Set(['sent', 'failed', 'pending']);

function validateMessage(
  message: unknown,
): asserts message is BushMeshChannelMessage {
  if (!message || typeof message !== 'object') {
    throw new Error('Persisted Bushmesh message is not an object.');
  }

  const candidate = message as Partial<BushMeshChannelMessage>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new Error('Persisted Bushmesh message has an invalid id.');
  }
  if (
    typeof candidate.channelIndex !== 'string' ||
    candidate.channelIndex.length === 0
  ) {
    throw new Error('Persisted Bushmesh message has an invalid channel index.');
  }
  if (typeof candidate.channelName !== 'string') {
    throw new Error('Persisted Bushmesh message has an invalid channel name.');
  }
  if (typeof candidate.text !== 'string') {
    throw new Error('Persisted Bushmesh message has invalid text.');
  }
  if (
    typeof candidate.direction !== 'string' ||
    !DIRECTIONS.has(candidate.direction)
  ) {
    throw new Error('Persisted Bushmesh message has an invalid direction.');
  }
  if (
    typeof candidate.status !== 'string' ||
    !STATUSES.has(candidate.status)
  ) {
    throw new Error('Persisted Bushmesh message has an invalid status.');
  }
  if (
    typeof candidate.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.createdAt))
  ) {
    throw new Error('Persisted Bushmesh message has an invalid timestamp.');
  }
}

export function createMessageSnapshot(
  messages: BushMeshChannelMessage[],
  savedAtMs = Date.now(),
): BushMeshMessageSnapshotV1 {
  if (!Number.isFinite(savedAtMs) || savedAtMs < 0) {
    throw new Error('Message snapshot savedAtMs is invalid.');
  }

  const deduped = new Map<string, BushMeshChannelMessage>();
  messages.forEach(message => {
    validateMessage(message);
    if (!deduped.has(message.id)) {
      deduped.set(message.id, {...message});
    }
  });

  const bounded = Array.from(deduped.values())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, BUSHMESH_MAX_PERSISTED_MESSAGES);

  return {
    version: BUSHMESH_MESSAGE_SNAPSHOT_VERSION,
    savedAtMs,
    messages: bounded,
  };
}

export function encodeMessageSnapshot(
  snapshot: BushMeshMessageSnapshotV1,
): string {
  validateMessageSnapshot(snapshot);
  return JSON.stringify(snapshot);
}

export function decodeMessageSnapshot(
  serialized: string,
): BushMeshMessageSnapshotV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Message snapshot is not valid JSON.');
  }

  validateMessageSnapshot(parsed);
  const snapshot = parsed as BushMeshMessageSnapshotV1;
  return createMessageSnapshot(snapshot.messages, snapshot.savedAtMs);
}

export function validateMessageSnapshot(
  snapshot: unknown,
): asserts snapshot is BushMeshMessageSnapshotV1 {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Message snapshot is not an object.');
  }

  const candidate = snapshot as Partial<BushMeshMessageSnapshotV1>;
  if (candidate.version !== BUSHMESH_MESSAGE_SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported message snapshot version ${String(candidate.version)}.`,
    );
  }
  if (
    typeof candidate.savedAtMs !== 'number' ||
    !Number.isFinite(candidate.savedAtMs) ||
    candidate.savedAtMs < 0
  ) {
    throw new Error('Message snapshot has an invalid savedAtMs value.');
  }
  if (!Array.isArray(candidate.messages)) {
    throw new Error('Message snapshot messages are invalid.');
  }

  candidate.messages.forEach(validateMessage);
}
