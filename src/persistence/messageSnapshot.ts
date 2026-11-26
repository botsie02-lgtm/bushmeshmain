import {CHANNEL_SUBMISSION_FAILURE_REASONS} from '../meshcore/channelSendDiagnostics';
import type {BushMeshChannelMessage} from '../state/BushMeshContext';
import {applyHistoryRetention, validateHistoryRetention, type HistoryRetention} from './historyRetention';

export const BUSHMESH_MESSAGE_SNAPSHOT_VERSION = 1 as const;
/** Legacy limit retained as a migration reference; new snapshots do not evict. */
export const BUSHMESH_MAX_PERSISTED_MESSAGES = 500;

export type BushMeshMessageSnapshotV1 = {
  version: typeof BUSHMESH_MESSAGE_SNAPSHOT_VERSION;
  savedAtMs: number;
  messages: BushMeshChannelMessage[];
  retention?: HistoryRetention;
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
  if (candidate.observation !== undefined) {
    const o = candidate.observation;
    if (!o || o.version !== 1 || !['native-session', 'js-gatt'].includes(o.source) || o.origin !== 'queued-generation-unknown' ||
        candidate.direction !== 'received' || (o.radio !== null && (typeof o.radio !== 'string' || !o.radio)) ||
        (o.configurationId !== null && (typeof o.configurationId !== 'string' || !/^[a-f0-9]{64}$/.test(o.configurationId))) ||
        (o.configurationName !== null && typeof o.configurationName !== 'string') ||
        (o.retentionReason !== undefined && (o.retentionReason !== 'possible-cleared-record-replay' || o.association !== undefined || candidate.conversation !== undefined)) ||
        (o.queueOccurrenceId !== undefined && (!o.radio || typeof o.queueOccurrenceId !== 'string' || !/^[a-z0-9-]{1,128}$/.test(o.queueOccurrenceId))) ||
        [o.timestamp, o.snr, o.pathLength].some(v => v !== null && !Number.isFinite(v))) throw new Error('Invalid persisted radio observation.');
  }
  if (candidate.observation?.association !== undefined && candidate.conversation?.provenance !== 'local-observation') throw new Error('Local observation association has no matching conversation.');
  if (candidate.submissionNotAttempted !== undefined && (candidate.submissionNotAttempted !== true || candidate.direction !== 'sent' || candidate.status !== 'failed')) throw new Error('Invalid submission outcome.');
  if (candidate.conversation !== undefined) {
    const c = candidate.conversation;
    const o = candidate.observation;
    const association = o?.association;
    const sent = c?.provenance === 'local-submission' && candidate.direction === 'sent';
    const observed = c?.provenance === 'local-observation' && candidate.direction === 'received' &&
      association?.version === 1 && association.evidence === 'post-empty-local-observation' &&
      Number.isSafeInteger(association.incarnation) && association.incarnation > 0 &&
      !!o?.radio && !!o.configurationId && c.radioId === o.radio &&
      c.channelName === o.configurationName &&
      c.channelGeneration === 'config:' + association.incarnation + ':' + o.configurationId;
    if (!c || c.version !== 1 || (!sent && !observed) ||
        typeof c.radioId !== 'string' || !c.radioId ||
        !/^config:(?:[1-9][0-9]*:)?[a-f0-9]{64}$/.test(c.channelGeneration) ||
        c.channelIndex !== candidate.channelIndex || c.channelName !== candidate.channelName) {
      throw new Error('Invalid persisted conversation attribution.');
    }
  }
  if (candidate.submissionFailure !== undefined) {
    const failure = candidate.submissionFailure;
    if (!failure || typeof failure !== 'object' ||
        !CHANNEL_SUBMISSION_FAILURE_REASONS.includes(failure.reason) ||
        (failure.firmwareCode !== undefined &&
          (!Number.isInteger(failure.firmwareCode) ||
            failure.firmwareCode < 0 || failure.firmwareCode > 255))) {
      throw new Error('Persisted Bushmesh message has invalid radio failure diagnostics.');
    }
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
  retention?: HistoryRetention,
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

  const bounded = applyHistoryRetention(Array.from(deduped.values()), retention)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return {
    version: BUSHMESH_MESSAGE_SNAPSHOT_VERSION,
    savedAtMs,
    ...(retention ? {retention} : {}),
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
    snapshot.retention,
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

  if (candidate.retention !== undefined) validateHistoryRetention(candidate.retention);
  candidate.messages.forEach(validatePersistedMessage);
}
