import {
  BUSHMESH_POSITION_REQUEST_DEFAULT_TTL_SECONDS,
} from '../bushmesh/positionRequestProtocol';
import {BushMeshOutboxEntry} from '../bushmesh/outbox';
import {TransmissionAttemptResult} from '../radio/BushMeshTransmissionController';
import {bushMeshRadioSession} from '../radio/BushMeshRadioSession';

export type QueueRecoveryPositionRequestInput = {
  channelIndex: number;
  targetId: string;
  sequence: number;
  ttlSeconds?: number;
  nowMs?: number;
};

export type RecoveryPositionRequestState =
  | 'queued'
  | 'accepted'
  | 'retrying'
  | 'failed'
  | 'responded'
  | 'expired';

export type RecoveryPositionRequestRecord = {
  id: string;
  targetId: string;
  outboxEntryId: string;
  requestedAtMs: number;
  expiresAtMs: number;
  nextAllowedAtMs: number;
  radioOutcome: 'accepted' | 'retrying' | 'failed' | null;
  responseReceivedAtMs: number | null;
};

export type RecoveryPositionRequestSnapshot = RecoveryPositionRequestRecord & {
  state: RecoveryPositionRequestState;
};

export type QueuedRecoveryPositionRequest = {
  entry: BushMeshOutboxEntry;
  request: RecoveryPositionRequestRecord;
};

const REQUEST_COOLDOWN_MS = 30_000;
const RESPONSE_CORRELATION_GRACE_MS = 30_000;
const MAX_REQUEST_RECORDS = 24;
const lastRequestedAtByTarget = new Map<string, number>();
let requestRecords: RecoveryPositionRequestRecord[] = [];

function normalizeTarget(targetId: string): string {
  return targetId.replace(/[^0-9a-f]/gi, '').toUpperCase();
}

function stateAt(
  request: RecoveryPositionRequestRecord,
  nowMs: number,
): RecoveryPositionRequestState {
  if (request.responseReceivedAtMs !== null) {
    return 'responded';
  }
  if (request.radioOutcome === 'failed') {
    return 'failed';
  }
  if (nowMs >= request.expiresAtMs) {
    return 'expired';
  }
  if (request.radioOutcome === 'accepted') {
    return 'accepted';
  }
  if (request.radioOutcome === 'retrying') {
    return 'retrying';
  }
  return 'queued';
}

function updateRecord(
  id: string,
  update: (record: RecoveryPositionRequestRecord) => RecoveryPositionRequestRecord,
): void {
  requestRecords = requestRecords.map(record =>
    record.id === id ? update(record) : record,
  );
}

export function queueRecoveryPositionRequest(
  input: QueueRecoveryPositionRequestInput,
): QueuedRecoveryPositionRequest {
  const nowMs = input.nowMs ?? Date.now();
  const targetId = normalizeTarget(input.targetId);
  const previous = lastRequestedAtByTarget.get(targetId);

  if (previous !== undefined && nowMs - previous < REQUEST_COOLDOWN_MS) {
    const remainingSeconds = Math.ceil(
      (REQUEST_COOLDOWN_MS - (nowMs - previous)) / 1000,
    );
    throw new Error(
      `Wait ${remainingSeconds}s before requesting another fix from this vehicle.`,
    );
  }

  const ttlSeconds =
    input.ttlSeconds ?? BUSHMESH_POSITION_REQUEST_DEFAULT_TTL_SECONDS;
  const entry = bushMeshRadioSession.queuePositionRequest({
    channelIndex: input.channelIndex,
    targetId,
    sequence: input.sequence,
    timestampSeconds: Math.floor(nowMs / 1000),
    ttlSeconds,
  });

  const request: RecoveryPositionRequestRecord = {
    id: `${targetId}:${nowMs}:${input.sequence}`,
    targetId,
    outboxEntryId: entry.id,
    requestedAtMs: nowMs,
    expiresAtMs: nowMs + ttlSeconds * 1000,
    nextAllowedAtMs: nowMs + REQUEST_COOLDOWN_MS,
    radioOutcome: null,
    responseReceivedAtMs: null,
  };

  lastRequestedAtByTarget.set(targetId, nowMs);
  requestRecords = [request, ...requestRecords].slice(0, MAX_REQUEST_RECORDS);
  return {entry, request};
}

export function recordRecoveryPositionRequestDrainResult(
  requestId: string,
  result: TransmissionAttemptResult,
): void {
  const request = requestRecords.find(record => record.id === requestId);
  if (!request || result.entry?.id !== request.outboxEntryId) {
    return;
  }

  const radioOutcome =
    result.outcome === 'accepted'
      ? 'accepted'
      : result.outcome === 'failed'
        ? 'failed'
        : result.outcome === 'retrying'
          ? 'retrying'
          : null;
  if (radioOutcome === null) {
    return;
  }

  updateRecord(requestId, record => ({...record, radioOutcome}));
}

/**
 * Marks the newest still-correlatable request for this vehicle as responded.
 * POSITION responses intentionally do not carry a request ID; the fresh fix is
 * useful recovery evidence regardless of which convoy member originated the
 * request, so correlation is target/time based and labelled accordingly.
 */
export function recordRecoveryPositionResponse(
  senderId: string,
  receivedAtMs = Date.now(),
): RecoveryPositionRequestRecord | null {
  const targetId = normalizeTarget(senderId);
  const request = requestRecords.find(
    record =>
      record.targetId === targetId &&
      record.responseReceivedAtMs === null &&
      receivedAtMs >= record.requestedAtMs &&
      receivedAtMs <= record.expiresAtMs + RESPONSE_CORRELATION_GRACE_MS,
  );
  if (!request) {
    return null;
  }

  updateRecord(request.id, record => ({
    ...record,
    responseReceivedAtMs: receivedAtMs,
  }));
  return request;
}

export function getLatestRecoveryPositionRequest(
  targetId: string,
  nowMs = Date.now(),
): RecoveryPositionRequestSnapshot | null {
  const normalized = normalizeTarget(targetId);
  const request = requestRecords.find(record => record.targetId === normalized);
  return request ? {...request, state: stateAt(request, nowMs)} : null;
}
