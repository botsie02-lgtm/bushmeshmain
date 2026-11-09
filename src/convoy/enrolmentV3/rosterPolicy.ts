import type {GroupMembership, GroupRecord} from '../../security/types';
import {EnrolmentIdentity} from './contract';

/**
 * Security v2 pre-commit CHECKLIST logic. Structural checks never prove that
 * a GroupRecord was signed, durably committed, or protected against rollback.
 * The authoritative Security v2 provider must enforce these in its atomic CAS.
 */
export function inspectIncrementalRosterTransition(
  before: GroupRecord,
  after: GroupRecord,
  requester: EnrolmentIdentity,
): {ok: boolean; reason: string} {
  if (after.groupId !== before.groupId ||
      after.createdAt !== before.createdAt ||
      after.securityVersion !== before.securityVersion ||
      after.protocolVersion !== before.protocolVersion ||
      !Number.isSafeInteger(before.currentEpoch) ||
      after.currentEpoch !== before.currentEpoch + 1) {
    return {ok: false, reason: 'group binding or epoch changed'};
  }
  if (!Array.isArray(before.members) || !Array.isArray(after.members) ||
      after.members.length !== before.members.length + 1 ||
      new Set(after.members.map(m => m.deviceId)).size !== after.members.length ||
      new Set(before.members.map(m => m.deviceId)).size !== before.members.length) {
    return {ok: false, reason: 'roster count or duplicate member'};
  }
  if (before.members.some(member => member.deviceId === requester.deviceId)) {
    return {ok: false, reason: 'existing or previously revoked member requires a different contract'};
  }
  const currentById = new Map(after.members.map(member => [member.deviceId, member]));
  for (const old of before.members) {
    const next = currentById.get(old.deviceId);
    if (!next || !identicalMember(old, next)) {
      return {ok: false, reason: 'existing member removed or modified'};
    }
  }
  const joined = currentById.get(requester.deviceId);
  if (!joined || joined.identityFingerprint !== requester.fingerprint ||
      joined.role !== 'member' || joined.state !== 'active' ||
      !Number.isSafeInteger(joined.joinedAt) || joined.joinedAt < before.createdAt) {
    return {ok: false, reason: 'new member is not correctly pinned'};
  }
  const oldEpoch = before.keyEpochs.find(key =>
    key.epoch === before.currentEpoch && key.state === 'active');
  const retired = after.keyEpochs.find(key => key.epoch === before.currentEpoch);
  const active = after.keyEpochs.find(key =>
    key.epoch === after.currentEpoch && key.state === 'active');
  if (!oldEpoch || !retired || retired.state !== 'rotated' ||
      !active || active.keyRef === oldEpoch.keyRef ||
      after.keyEpochs.filter(key => key.state === 'active').length !== 1) {
    return {ok: false, reason: 'fresh epoch or old-key retirement not demonstrated'};
  }
  return {ok: true, reason: 'structural-only-not-cryptographic-proof'};
}

function identicalMember(a: GroupMembership, b: GroupMembership): boolean {
  return a.deviceId === b.deviceId &&
    a.identityFingerprint === b.identityFingerprint &&
    a.role === b.role && a.state === b.state &&
    a.joinedAt === b.joinedAt &&
    a.revokedAt === b.revokedAt;
}

/** Reports recipients requiring rekey delivery after a LOCAL removal commit. */
export function planRemainingEpochRecipients(
  committed: GroupRecord,
  localDeviceId: string,
): string[] {
  const local = committed.members.find(m =>
    m.deviceId === localDeviceId && m.state === 'active' && m.role === 'leader');
  if (!local || !committed.keyEpochs.some(e =>
    e.epoch === committed.currentEpoch && e.state === 'active')) {
    throw new Error('Local Security v1 leader and current key epoch required');
  }
  return committed.members.filter(m => m.state === 'active' &&
    m.deviceId !== localDeviceId).map(m => m.deviceId).sort();
}
