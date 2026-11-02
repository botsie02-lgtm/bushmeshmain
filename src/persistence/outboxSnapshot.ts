import {Buffer} from 'buffer';

import {
  BushMeshOutboxEntry,
  BushMeshOutboxPriority,
  BushMeshOutboxState,
} from '../bushmesh/outbox';

export const BUSHMESH_OUTBOX_SNAPSHOT_VERSION = 1 as const;

export type PersistedOutboxEntryV1 = {
  id: string;
  channelIndex: number;
  dataType: number;
  payloadBase64: string;
  priority: BushMeshOutboxPriority;
  description: string;
  identityRef: string | null;
  expiresAtMs: number | null;
  createdAtMs: number;
  maxAttempts: number;
  attempts: number;
  state: BushMeshOutboxState;
  nextAttemptAtMs: number;
  lastError: string | null;
  acceptedAtMs: number | null;
};

export type BushMeshOutboxSnapshotV1 = {
  version: typeof BUSHMESH_OUTBOX_SNAPSHOT_VERSION;
  savedAtMs: number;
  entries: PersistedOutboxEntryV1[];
};

const PRIORITIES: BushMeshOutboxPriority[] = [
  'safety',
  'control',
  'message',
  'position',
  'bulk',
];

const STATES: BushMeshOutboxState[] = [
  'queued',
  'inflight',
  'accepted',
  'failed',
  'cancelled',
];

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function validNullableTimestamp(value: unknown): value is number | null {
  return value === null || finiteNonNegative(value);
}

function validCanonicalBase64(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  if (value === '') {
    return true;
  }

  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return false;
  }

  const firstPadding = value.indexOf('=');
  if (firstPadding >= 0 && firstPadding < value.length - 2) {
    return false;
  }

  try {
    return Buffer.from(value, 'base64').toString('base64') === value;
  } catch {
    return false;
  }
}

function validatePersistedEntry(entry: PersistedOutboxEntryV1): void {
  if (!entry.id || typeof entry.id !== 'string') {
    throw new Error('Persisted outbox entry id is invalid.');
  }
  if (
    !Number.isInteger(entry.channelIndex) ||
    entry.channelIndex < 0 ||
    entry.channelIndex > 7
  ) {
    throw new Error(`Persisted outbox entry ${entry.id} has an invalid channel.`);
  }
  if (!Number.isInteger(entry.dataType) || entry.dataType < 1 || entry.dataType > 0xffff) {
    throw new Error(`Persisted outbox entry ${entry.id} has an invalid data type.`);
  }
  if (!validCanonicalBase64(entry.payloadBase64)) {
    throw new Error(`Persisted outbox entry ${entry.id} has an invalid payload.`);
  }
  if (!PRIORITIES.includes(entry.priority)) {
    throw new Error(`Persisted outbox entry ${entry.id} has an invalid priority.`);
  }
  if (!STATES.includes(entry.state)) {
    throw new Error(`Persisted outbox entry ${entry.id} has an invalid state.`);
  }
  if (typeof entry.description !== 'string') {
    throw new Error(`Persisted outbox entry ${entry.id} has an invalid description.`);
  }
  if (!validNullableString(entry.identityRef)) {
    throw new Error(`Persisted outbox entry ${entry.id} has an invalid identity.`);
  }
  if (!validNullableTimestamp(entry.expiresAtMs)) {
    throw new Error(`Persisted outbox entry ${entry.id} has an invalid expiry.`);
  }
  if (
    !finiteNonNegative(entry.createdAtMs) ||
    !finiteNonNegative(entry.nextAttemptAtMs) ||
    !Number.isInteger(entry.maxAttempts) ||
    entry.maxAttempts < 1 ||
    !Number.isInteger(entry.attempts) ||
    entry.attempts < 0 ||
    entry.attempts > entry.maxAttempts
  ) {
    throw new Error(`Persisted outbox entry ${entry.id} has invalid retry metadata.`);
  }
  if (!validNullableString(entry.lastError)) {
    throw new Error(`Persisted outbox entry ${entry.id} has an invalid last error.`);
  }
  if (entry.acceptedAtMs !== null && !finiteNonNegative(entry.acceptedAtMs)) {
    throw new Error(`Persisted outbox entry ${entry.id} has an invalid accepted time.`);
  }
}

export function createOutboxSnapshot(
  entries: BushMeshOutboxEntry[],
  savedAtMs = Date.now(),
): BushMeshOutboxSnapshotV1 {
  if (!finiteNonNegative(savedAtMs)) {
    throw new Error('Outbox snapshot savedAtMs must be a non-negative number.');
  }

  return {
    version: BUSHMESH_OUTBOX_SNAPSHOT_VERSION,
    savedAtMs,
    entries: entries.map(entry => ({
      id: entry.id,
      channelIndex: entry.channelIndex,
      dataType: entry.dataType,
      payloadBase64: Buffer.from(entry.payload).toString('base64'),
      priority: entry.priority,
      description: entry.description,
      identityRef: entry.identityRef,
      expiresAtMs: entry.expiresAtMs,
      createdAtMs: entry.createdAtMs,
      maxAttempts: entry.maxAttempts,
      attempts: entry.attempts,
      state: entry.state,
      nextAttemptAtMs: entry.nextAttemptAtMs,
      lastError: entry.lastError,
      acceptedAtMs: entry.acceptedAtMs,
    })),
  };
}

export function encodeOutboxSnapshot(snapshot: BushMeshOutboxSnapshotV1): string {
  validateOutboxSnapshot(snapshot);
  return JSON.stringify(snapshot);
}

export function decodeOutboxSnapshot(serialized: string): BushMeshOutboxSnapshotV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Outbox snapshot is not valid JSON.');
  }

  validateOutboxSnapshot(parsed);
  return parsed;
}

export function validateOutboxSnapshot(
  snapshot: unknown,
): asserts snapshot is BushMeshOutboxSnapshotV1 {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Outbox snapshot is not an object.');
  }

  const candidate = snapshot as Partial<BushMeshOutboxSnapshotV1>;
  if (candidate.version !== BUSHMESH_OUTBOX_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported outbox snapshot version ${String(candidate.version)}.`);
  }
  if (!finiteNonNegative(candidate.savedAtMs)) {
    throw new Error('Outbox snapshot has an invalid savedAtMs value.');
  }
  if (!Array.isArray(candidate.entries)) {
    throw new Error('Outbox snapshot entries are invalid.');
  }

  candidate.entries.forEach(entry => validatePersistedEntry(entry));
}

/**
 * Restores a JSON-safe persisted entry into the runtime shape.
 *
 * An entry that was in-flight when the process died is recovered as queued.
 * That intentionally gives Bushmesh at-least-once retry semantics after a crash;
 * application packet clocks/dedupe prevent a repeated position/control packet
 * from being treated as a newer event by a peer. Expiry is retained, so an old
 * control packet cannot be resurrected into a new transmission window.
 */
export function restoreOutboxEntry(
  persisted: PersistedOutboxEntryV1,
  recoveredAtMs = Date.now(),
): BushMeshOutboxEntry {
  validatePersistedEntry(persisted);
  if (!finiteNonNegative(recoveredAtMs)) {
    throw new Error('Outbox recovery time must be a non-negative number.');
  }

  const recoveredInflight = persisted.state === 'inflight';
  const state: BushMeshOutboxState = recoveredInflight
    ? 'queued'
    : persisted.state;
  const lastError = recoveredInflight
    ? 'Recovered after restart while radio acceptance was unknown.'
    : persisted.lastError;
  const nextAttemptAtMs = recoveredInflight
    ? recoveredAtMs
    : persisted.nextAttemptAtMs;

  return {
    id: persisted.id,
    channelIndex: persisted.channelIndex,
    dataType: persisted.dataType,
    payload: Uint8Array.from(Buffer.from(persisted.payloadBase64, 'base64')),
    priority: persisted.priority,
    description: persisted.description,
    identityRef: persisted.identityRef,
    expiresAtMs: persisted.expiresAtMs,
    createdAtMs: persisted.createdAtMs,
    maxAttempts: persisted.maxAttempts,
    attempts: persisted.attempts,
    state,
    nextAttemptAtMs,
    lastError,
    acceptedAtMs: persisted.acceptedAtMs,
  };
}

export function restoreOutboxSnapshot(
  snapshot: BushMeshOutboxSnapshotV1,
  recoveredAtMs = Date.now(),
): BushMeshOutboxEntry[] {
  validateOutboxSnapshot(snapshot);
  return snapshot.entries.map(entry => restoreOutboxEntry(entry, recoveredAtMs));
}
