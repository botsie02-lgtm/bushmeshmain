/**
 * Membership administration metadata. This is NOT a cryptographic credential.
 * Only Security v1's group-key state may authorise an operational member.
 */
export type ConvoyRole = 'owner' | 'admin' | 'member';
export type InvitationState = 'pending' | 'cancelled' | 'expired';
export type JoinRequestState = 'pending' | 'approved-awaiting-security' | 'rejected';

export type ConvoyRegistryEntry = {
  convoyId: string;
  groupId: string;
  displayName: string;
  /** Null for an imported convoy without an authenticated owner-role proof. */
  ownerDeviceId: string | null;
  createdAt: number;
};

export type ConvoyInvitation = {
  id: string;
  convoyId: string;
  recipientDeviceId: string;
  recipientFingerprint: string;
  createdAt: number;
  expiresAt: number;
  state: InvitationState;
};

export type ConvoyJoinRequest = {
  id: string;
  convoyId: string;
  deviceId: string;
  fingerprint: string;
  createdAt: number;
  state: JoinRequestState;
};

export type ConvoyAdminGrant = {
  convoyId: string;
  deviceId: string;
  /** Local policy only; also requires an active Security v1 group leader. */
  grantedByDeviceId: string;
};

export type ConvoyMembershipSnapshot = {
  schema: 'bushmesh-convoy-membership';
  version: 2;
  convoys: ConvoyRegistryEntry[];
  invitations: ConvoyInvitation[];
  requests: ConvoyJoinRequest[];
  adminGrants: ConvoyAdminGrant[];
};

export class ConvoyMembershipError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_INPUT'
      | 'UNAUTHORISED'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'SECURITY_UNAVAILABLE'
      | 'MISSING_SECURITY_CONTRACT',
    message: string,
  ) {
    super(message);
    this.name = 'ConvoyMembershipError';
  }
}

export function assertMemberId(value: unknown, field = 'identifier'): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) {
    throw new ConvoyMembershipError('INVALID_INPUT', 'Invalid ' + field);
  }
}

export function assertGroupId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^bmg1_[A-Za-z0-9_-]{8,128}$/.test(value)) {
    throw new ConvoyMembershipError('INVALID_INPUT', 'Invalid Security v1 group ID');
  }
}

export function assertName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) {
    throw new ConvoyMembershipError('INVALID_INPUT', 'Convoy name must contain 1-120 characters');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join('|') === expected.slice().sort().join('|');
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function id(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

function groupId(value: unknown): value is string {
  return typeof value === 'string' && /^bmg1_[A-Za-z0-9_-]{8,128}$/.test(value);
}

function convoy(value: unknown): value is ConvoyRegistryEntry {
  return record(value) &&
    keys(value, ['convoyId', 'groupId', 'displayName', 'ownerDeviceId', 'createdAt']) &&
    id(value.convoyId) && groupId(value.groupId) &&
    typeof value.displayName === 'string' && !!value.displayName.trim() &&
    value.displayName.length <= 120 &&
    (value.ownerDeviceId === null || id(value.ownerDeviceId)) &&
    timestamp(value.createdAt);
}

function invitation(value: unknown): value is ConvoyInvitation {
  return record(value) &&
    keys(value, ['id', 'convoyId', 'recipientDeviceId', 'recipientFingerprint', 'createdAt', 'expiresAt', 'state']) &&
    id(value.id) && id(value.convoyId) && id(value.recipientDeviceId) &&
    id(value.recipientFingerprint) && timestamp(value.createdAt) &&
    timestamp(value.expiresAt) && value.expiresAt > value.createdAt &&
    ['pending', 'cancelled', 'expired'].includes(value.state as string);
}

function joinRequest(value: unknown): value is ConvoyJoinRequest {
  return record(value) &&
    keys(value, ['id', 'convoyId', 'deviceId', 'fingerprint', 'createdAt', 'state']) &&
    id(value.id) && id(value.convoyId) && id(value.deviceId) &&
    id(value.fingerprint) && timestamp(value.createdAt) &&
    ['pending', 'approved-awaiting-security', 'rejected'].includes(value.state as string);
}

function adminGrant(value: unknown): value is ConvoyAdminGrant {
  return record(value) &&
    keys(value, ['convoyId', 'deviceId', 'grantedByDeviceId']) &&
    id(value.convoyId) && id(value.deviceId) && id(value.grantedByDeviceId);
}

export function emptyConvoyMembershipSnapshot(): ConvoyMembershipSnapshot {
  return {schema: 'bushmesh-convoy-membership', version: 2, convoys: [], invitations: [], requests: [], adminGrants: []};
}

/**
 * Strict parsing fails closed on extra fields (including carrier secrets),
 * invalid identities, duplicate records and unknown convoy references.
 */
export function parseConvoyMembershipSnapshot(value: unknown): ConvoyMembershipSnapshot {
  if (!record(value) ||
    !keys(value, ['schema', 'version', 'convoys', 'invitations', 'requests', 'adminGrants']) ||
    value.schema !== 'bushmesh-convoy-membership' || value.version !== 2 ||
    !Array.isArray(value.convoys) || value.convoys.length > 32 ||
    !Array.isArray(value.invitations) || value.invitations.length > 256 ||
    !Array.isArray(value.requests) || value.requests.length > 256 ||
    !Array.isArray(value.adminGrants) || value.adminGrants.length > 128 ||
    !value.convoys.every(convoy) || !value.invitations.every(invitation) ||
    !value.requests.every(joinRequest) || !value.adminGrants.every(adminGrant)) {
    throw new ConvoyMembershipError('INVALID_INPUT', 'Invalid convoy membership snapshot');
  }
  const state = value as ConvoyMembershipSnapshot;
  const convoyIds = new Set(state.convoys.map(item => item.convoyId));
  const groupIds = new Set(state.convoys.map(item => item.groupId));
  if (convoyIds.size !== state.convoys.length || groupIds.size !== state.convoys.length ||
    new Set(state.invitations.map(item => item.id)).size !== state.invitations.length ||
    new Set(state.requests.map(item => item.id)).size !== state.requests.length ||
    new Set(state.adminGrants.map(item => item.convoyId + ':' + item.deviceId)).size !== state.adminGrants.length ||
    state.invitations.some(item => !convoyIds.has(item.convoyId)) ||
    state.requests.some(item => !convoyIds.has(item.convoyId)) ||
    state.adminGrants.some(item => !convoyIds.has(item.convoyId))) {
    throw new ConvoyMembershipError('INVALID_INPUT', 'Inconsistent convoy membership snapshot');
  }
  return JSON.parse(JSON.stringify(state)) as ConvoyMembershipSnapshot;
}

export type ConvoyAdminOperation = 'invite' | 'review-request' | 'remove-member' | 'grant-admin';
export function canAdminister(
  actor: ConvoyRole,
  operation: ConvoyAdminOperation,
  target: ConvoyRole = 'member',
): boolean {
  if (actor === 'owner') {
    return operation !== 'remove-member' || target !== 'owner';
  }
  return actor === 'admin' && operation !== 'grant-admin' &&
    (operation !== 'remove-member' || target === 'member');
}

export type ConvoyMemberPresence = 'live' | 'recent' | 'stale' | 'disconnected';
export function presenceFromLastSeen(lastSeenMs: number | null, nowMs: number): ConvoyMemberPresence {
  if (lastSeenMs === null || !Number.isFinite(lastSeenMs) || lastSeenMs > nowMs) {
    return 'disconnected';
  }
  const age = nowMs - lastSeenMs;
  return age <= 30_000 ? 'live' : age <= 120_000 ? 'recent' : age <= 600_000 ? 'stale' : 'disconnected';
}
