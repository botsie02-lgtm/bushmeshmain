import type {BushMeshChannelMessage} from '../state/BushMeshContext';

export const BUSHMESH_MESSAGE_SNAPSHOT_VERSION = 1 as const;
export const BUSHMESH_MAX_PERSISTED_MESSAGES = 500;

export type BushMeshMessageSnapshotV1 = {
  version: typeof BUSHMESH_MESSAGE_SNAPSHOT_VERSION;
  savedAtMs: number;
  messages: BushMeshChannelMessage[];
};

type PersistedMessageV1 = Omit<BushMeshChannelMessage, 'status'> & {
  status: BushMeshChannelMessage['status'] | 'sent';
};

type PersistedMessageSnapshotV1 = Omit<BushMeshMessageSnapshotV1, 'messages'> & {
  messages: PersistedMessageV1[];
};

const DIRECTIONS = new Set(['sent', 'received']);
const STATUSES = new Set(['sent', 'pending', 'accepted', 'confirmed', 'failed']);

function validatePersistedMessage(
  message: unknown,
): asserts message is PersistedMessageV1 {
  if (!message || typeof message !== 'object') {
    throw new Error('Persisted Bushmesh message is not an object.');
  }

  const candidate = message as Partial<PersistedMessageV1>;
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

function normalizePersistedMessage(
  message: PersistedMessageV1,
): BushMeshChannelMessage {
  return {
    ...message,
    // Older builds used "sent" immediately after PACKET_MSG_SENT. MeshCore's
    // response only proves the companion accepted the packet, so migrate that
    // legacy state to the truthful name rather than preserving a false claim.
    status: message.status === 'sent' ? 'accepted' : message.status,
  };
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
    validatePersistedMessage(message);
    if (!deduped.has(message.id)) {
      deduped.set(message.id, normalizePersistedMessage(message));
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
  const snapshot = parsed as PersistedMessageSnapshotV1;
  return createMessageSnapshot(
    snapshot.messages.map(normalizePersistedMessage),
    snapshot.savedAtMs,
  );
}

export function validateMessageSnapshot(
  snapshot: unknown,
): asserts snapshot is PersistedMessageSnapshotV1 {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Message snapshot is not an object.');
  }

  const candidate = snapshot as Partial<PersistedMessageSnapshotV1>;
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

  candidate.messages.forEach(validatePersistedMessage);
}
