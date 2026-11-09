import type {GroupRecord} from '../../security/types';
import {
  EnrolmentIdentity, assertEpoch, assertIdentity, assertReference,
  assertTimestamp, hasKeys, isRecord,
} from './contract';

/**
 * This is an OBSERVATION/RECOVERY state machine, not a crypto engine.
 * No phase in this type authorises membership, even "ack-observed".
 */
export type JoinObservationPhase =
  | 'authenticated-request-observed'
  | 'approved-awaiting-security-v2'
  | 'prepared-unverified'
  | 'distributing-unverified'
  | 'partial-delivery-unverified'
  | 'ack-observed-unverified'
  | 'rejected'
  | 'expired'
  | 'needs-reconciliation'
  | 'blocked';

export type RecipientDeliveryObservation = {
  deviceId: string;
  status: 'pending' | 'sent' | 'failed' | 'ack-observed';
};

export type JoinObservationV3 = {
  schema: 'bushmesh-convoy-join-observation-v3';
  version: 3;
  requestId: string;
  convoyId: string;
  groupId: string;
  requester: EnrolmentIdentity;
  expectedEpoch: number;
  committedEpoch: number | null;
  rosterDigest: string | null;
  phase: JoinObservationPhase;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  recipients: RecipientDeliveryObservation[];
  /** Only bounded replay/concurrency diagnostics; not a Security v2 nonce journal. */
  eventIds: Array<{id: string; payload: string}>;
};

export type JoinObservationEvent =
  | {id: string; kind: 'approve'; atMs: number}
  | {id: string; kind: 'reject'; atMs: number}
  | {id: string; kind: 'prepare-observed'; atMs: number; expectedEpoch: number; nextEpoch: number}
  | {id: string; kind: 'commit-observed'; atMs: number; committedEpoch: number; rosterDigest: string; recipients: string[]}
  | {id: string; kind: 'delivery-observed'; atMs: number; deviceId: string; result: 'sent' | 'failed'}
  | {id: string; kind: 'ack-observed'; atMs: number; deviceId: string; committedEpoch: number; rosterDigest: string}
  | {id: string; kind: 'timeout'; atMs: number}
  | {id: string; kind: 'invalidate'; atMs: number; reason: 'identity-rotation' | 'revoke' | 'epoch-advanced' | 'storage-recovery'};

function fail(message: string): never {
  throw new Error('Join observation rejected: ' + message);
}

function canonicalEvent(value: JoinObservationEvent): string {
  switch (value.kind) {
    case 'approve':
    case 'reject':
    case 'timeout':
      return JSON.stringify([value.id, value.kind, value.atMs]);
    case 'prepare-observed':
      return JSON.stringify([value.id, value.kind, value.atMs, value.expectedEpoch, value.nextEpoch]);
    case 'commit-observed':
      return JSON.stringify([value.id, value.kind, value.atMs, value.committedEpoch, value.rosterDigest,
        [...value.recipients].sort()]);
    case 'delivery-observed':
      return JSON.stringify([value.id, value.kind, value.atMs, value.deviceId, value.result]);
    case 'ack-observed':
      return JSON.stringify([value.id, value.kind, value.atMs, value.deviceId, value.committedEpoch, value.rosterDigest]);
    case 'invalidate':
      return JSON.stringify([value.id, value.kind, value.atMs, value.reason]);
  }
}

export function newJoinObservation(input: {
  requestId: string;
  convoyId: string;
  groupId: string;
  requester: EnrolmentIdentity;
  expectedEpoch: number;
  createdAt: number;
  expiresAt: number;
}): JoinObservationV3 {
  assertReference(input.requestId, 'request ID');
  assertReference(input.convoyId, 'convoy ID');
  assertReference(input.groupId, 'group ID');
  if (!input.groupId.startsWith('bmg1_')) {
    fail('Invalid group ID');
  }
  assertIdentity(input.requester);
  assertEpoch(input.expectedEpoch, 'expected epoch');
  assertTimestamp(input.createdAt, 'creation time');
  assertTimestamp(input.expiresAt, 'expiration');
  if (input.expiresAt <= input.createdAt || input.expiresAt - input.createdAt > 600000) {
    fail('Invalid request window');
  }
  return {
    schema: 'bushmesh-convoy-join-observation-v3', version: 3,
    requestId: input.requestId, convoyId: input.convoyId,
    groupId: input.groupId, requester: {...input.requester},
    expectedEpoch: input.expectedEpoch, committedEpoch: null,
    rosterDigest: null, phase: 'authenticated-request-observed',
    createdAt: input.createdAt, expiresAt: input.expiresAt, updatedAt: input.createdAt,
    recipients: [], eventIds: [],
  };
}

const PHASES: JoinObservationPhase[] = [
  'authenticated-request-observed', 'approved-awaiting-security-v2',
  'prepared-unverified', 'distributing-unverified',
  'partial-delivery-unverified', 'ack-observed-unverified',
  'rejected', 'expired', 'needs-reconciliation', 'blocked',
];

export function parseJoinObservation(value: unknown): JoinObservationV3 {
  if (!isRecord(value) || !hasKeys(value, [
    'schema', 'version', 'requestId', 'convoyId', 'groupId', 'requester',
    'expectedEpoch', 'committedEpoch', 'rosterDigest', 'phase', 'createdAt',
    'expiresAt', 'updatedAt', 'recipients', 'eventIds',
  ]) || value.schema !== 'bushmesh-convoy-join-observation-v3' || value.version !== 3) {
    return fail('Malformed join observation snapshot');
  }
  assertReference(value.requestId, 'request ID');
  assertReference(value.convoyId, 'convoy ID');
  assertReference(value.groupId, 'group ID');
  if (!(value.groupId as string).startsWith('bmg1_')) {
    return fail('Invalid group ID');
  }
  assertIdentity(value.requester);
  assertEpoch(value.expectedEpoch, 'expected epoch');
  if (value.committedEpoch !== null) {
    assertEpoch(value.committedEpoch, 'committed epoch');
    if (value.committedEpoch !== (value.expectedEpoch as number) + 1) {
      return fail('Committed epoch does not advance exactly once');
    }
  }
  if (value.rosterDigest !== null) {
    assertReference(value.rosterDigest, 'roster digest');
  }
  if ((value.committedEpoch === null) !== (value.rosterDigest === null)) {
    return fail('Epoch/digest inconsistency');
  }
  if (!PHASES.includes(value.phase as JoinObservationPhase)) {
    return fail('Invalid phase');
  }
  assertTimestamp(value.createdAt, 'createdAt');
  assertTimestamp(value.expiresAt, 'expiresAt');
  assertTimestamp(value.updatedAt, 'updatedAt');
  if (value.createdAt > value.updatedAt || value.expiresAt <= value.createdAt ||
      value.expiresAt - value.createdAt > 600000) {
    return fail('Invalid observation clock');
  }
  if (!Array.isArray(value.recipients) || value.recipients.length > 128 ||
      !Array.isArray(value.eventIds) || value.eventIds.length > 128) {
    return fail('Oversized history');
  }
  for (const item of value.recipients) {
    if (!isRecord(item) || !hasKeys(item, ['deviceId', 'status']) ||
        !['pending', 'sent', 'failed', 'ack-observed'].includes(item.status as string)) {
      return fail('Invalid recipient observation');
    }
    assertReference(item.deviceId, 'recipient ID');
  }
  for (const event of value.eventIds) {
    if (!isRecord(event) || !hasKeys(event, ['id', 'payload']) ||
        typeof event.payload !== 'string' || event.payload.length > 700) {
      return fail('Invalid event history');
    }
    assertReference(event.id, 'event ID');
  }
  if (new Set(value.recipients.map(item => item.deviceId)).size !== value.recipients.length ||
      new Set(value.eventIds.map(item => item.id)).size !== value.eventIds.length ||
      (value.committedEpoch === null && value.recipients.length > 0)) {
    return fail('Duplicate recipients/events or premature distribution');
  }
  return JSON.parse(JSON.stringify(value)) as JoinObservationV3;
}

export function observeJoinEvent(previous: JoinObservationV3, event: JoinObservationEvent): JoinObservationV3 {
  const state = parseJoinObservation(previous);
  assertReference(event.id, 'event ID');
  assertTimestamp(event.atMs, 'event timestamp');
  const payload = canonicalEvent(event);
  const prior = state.eventIds.find(item => item.id === event.id);
  if (prior) {
    if (prior.payload !== payload) {
      return fail('Conflicting event ID');
    }
    return state; // Exactly repeated observation is idempotent.
  }
  if (state.eventIds.length >= 128 || event.atMs < state.updatedAt) {
    return fail('Event history exhausted or out of order');
  }
  if (event.atMs > state.expiresAt &&
      event.kind !== 'timeout' && event.kind !== 'invalidate') {
    return fail('Late enrolment message');
  }
  if (['rejected', 'expired', 'blocked', 'needs-reconciliation'].includes(state.phase)) {
    return fail('Terminal observation cannot be revived');
  }
  const next = {...state, updatedAt: event.atMs,
    eventIds: [...state.eventIds, {id: event.id, payload}]};
  switch (event.kind) {
    case 'approve':
      if (state.phase !== 'authenticated-request-observed') {
        return fail('Approval out of order');
      }
      next.phase = 'approved-awaiting-security-v2';
      break;
    case 'reject':
      if (state.committedEpoch !== null) {
        return fail('Already committed; rejection cannot undo a key epoch');
      }
      next.phase = 'rejected';
      break;
    case 'prepare-observed':
      assertEpoch(event.expectedEpoch, 'observed expected epoch');
      assertEpoch(event.nextEpoch, 'observed proposed epoch');
      if (state.phase !== 'approved-awaiting-security-v2' ||
          event.expectedEpoch !== state.expectedEpoch ||
          event.nextEpoch !== state.expectedEpoch + 1) {
        return fail('Unverified preparation conflicts with group epoch');
      }
      next.phase = 'prepared-unverified';
      break;
    case 'commit-observed':
      assertEpoch(event.committedEpoch, 'observed commit epoch');
      assertReference(event.rosterDigest, 'observed digest');
      if (state.phase !== 'prepared-unverified' ||
          event.committedEpoch !== state.expectedEpoch + 1 ||
          !Array.isArray(event.recipients) || event.recipients.length < 1 ||
          event.recipients.length > 128 ||
          !event.recipients.includes(state.requester.deviceId) ||
          new Set(event.recipients).size !== event.recipients.length) {
        return fail('Conflicting or incomplete proposed commit');
      }
      for (const deviceId of event.recipients) {
        assertReference(deviceId, 'recipient ID');
      }
      next.committedEpoch = event.committedEpoch;
      next.rosterDigest = event.rosterDigest;
      next.recipients = event.recipients.map(deviceId =>
        ({deviceId, status: 'pending' as const}));
      next.phase = 'distributing-unverified';
      break;
    case 'delivery-observed': {
      assertReference(event.deviceId, 'recipient ID');
      if (state.committedEpoch === null || !state.recipients.some(r => r.deviceId === event.deviceId) ||
          state.phase === 'ack-observed-unverified') {
        return fail('No committed recipient delivery to observe');
      }
      next.recipients = state.recipients.map(r =>
        r.deviceId === event.deviceId && r.status !== 'ack-observed'
          ? {...r, status: event.result} : r);
      next.phase = next.recipients.some(r => r.status === 'failed')
        ? 'partial-delivery-unverified'
        : 'distributing-unverified';
      break;
    }
    case 'ack-observed': {
      assertReference(event.deviceId, 'ack recipient ID');
      assertEpoch(event.committedEpoch, 'ack epoch');
      if (state.committedEpoch === null || event.committedEpoch !== state.committedEpoch ||
          event.rosterDigest !== state.rosterDigest ||
          event.deviceId !== state.requester.deviceId ||
          !state.recipients.some(r => r.deviceId === event.deviceId && r.status === 'sent')) {
        return fail('Unbound, stale or unsolicited install acknowledgement');
      }
      next.recipients = state.recipients.map(r =>
        r.deviceId === event.deviceId ? {...r, status: 'ack-observed' as const} : r);
      next.phase = 'ack-observed-unverified';
      break;
    }
    case 'timeout':
      if (event.atMs < state.expiresAt) {
        return fail('Timeout before expiry');
      }
      next.phase = state.committedEpoch === null ? 'expired' : 'needs-reconciliation';
      break;
    case 'invalidate':
      next.phase = state.committedEpoch === null ? 'blocked' : 'needs-reconciliation';
      break;
  }
  return parseJoinObservation(next);
}

/**
 * Observes existing Security v1 group metadata, WITHOUT mutating it.
 * Even an apparently matching epoch is not Security v2 commit proof.
 */
export function reconcileJoinObservation(
  state: JoinObservationV3,
  current: GroupRecord | null,
  localIdentityRef: string,
): JoinObservationV3 {
  const previous = parseJoinObservation(state);
  if (!current || current.groupId !== state.groupId || !localIdentityRef) {
    return {...previous, phase: 'needs-reconciliation'};
  }
  const expected = state.committedEpoch ?? state.expectedEpoch;
  if (current.currentEpoch !== expected ||
      !current.members.some(m => m.deviceId === localIdentityRef && m.state === 'active')) {
    return {...previous, phase: 'needs-reconciliation'};
  }
  // No authorisation is inferred from matching metadata.
  return previous;
}

/** Strict snapshot validation for protected restart-recovery diagnostics. */
export type JoinObservationJournalV3 = {
  schema: 'bushmesh-enrolment-journal-v3';
  version: 3;
  localIdentityRef: string;
  records: JoinObservationV3[];
};

export function parseJoinObservationJournal(value: unknown): JoinObservationJournalV3 {
  if (!isRecord(value) || !hasKeys(value, ['schema', 'version', 'localIdentityRef', 'records']) ||
      value.schema !== 'bushmesh-enrolment-journal-v3' || value.version !== 3 ||
      !Array.isArray(value.records) || value.records.length > 64) {
    return fail('Invalid join recovery journal');
  }
  assertReference(value.localIdentityRef, 'journal identity');
  const records = value.records.map(parseJoinObservation);
  if (new Set(records.map(r => r.requestId)).size !== records.length) {
    return fail('Duplicate request IDs in recovery journal');
  }
  return {schema: 'bushmesh-enrolment-journal-v3', version: 3,
    localIdentityRef: value.localIdentityRef, records};
}
