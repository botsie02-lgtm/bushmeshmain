import {Buffer} from 'buffer';
import type {
  SecurityProtocolContext,
  WrappedGroupKeyDistribution,
} from '../../security/types';

/**
 * Design-only additive Security v2 contract proposal. No Security v1
 * implementation is modified, and these wire types are NOT trusted proof.
 */
export const ENROLMENT_V2_SCHEMA = 'bushmesh-convoy-enrolment-v2' as const;
export const ENROLMENT_V2_VERSION = 2 as const;
export const ENROLMENT_MAX_WIRE_BYTES = 8192;

export type EnrolmentIdentity = {
  deviceId: string;
  fingerprint: string;
  keyEpoch: number;
};

export type EnrolmentRole = 'owner' | 'admin';

export type RoleCredentialClaimsV2 = {
  schema: 'bushmesh-convoy-role-credential-v2';
  version: 2;
  credentialId: string;
  convoyId: string;
  groupId: string;
  /** Root from an independently anchored, signed convoy genesis record. */
  ownerAnchorFingerprint: string;
  subject: EnrolmentIdentity;
  role: EnrolmentRole;
  issuer: EnrolmentIdentity;
  authoritySequence: number;
  groupEpoch: number;
  issuedAt: number;
  expiresAt: number;
};

export type SignedRoleCredentialV2 = RoleCredentialClaimsV2 & {
  /** Base64url Ed25519 signature over canonical domain-separated claims. */
  signature: string;
};

export type EnrolmentProposalV2 = {
  schema: typeof ENROLMENT_V2_SCHEMA;
  version: typeof ENROLMENT_V2_VERSION;
  operation: 'add-member';
  transactionId: string;
  requestId: string;
  convoyId: string;
  groupId: string;
  requester: EnrolmentIdentity;
  approver: EnrolmentIdentity;
  expectedEpoch: number;
  nextEpoch: number;
  rosterDigestBefore: string;
  rosterDigestAfter: string;
  credentialId: string;
  issuedAt: number;
  expiresAt: number;
};

export type SignedEnrolmentApprovalV2 = {
  kind: 'approval';
  proposal: EnrolmentProposalV2;
  credential: SignedRoleCredentialV2;
  /** Ed25519 signature over the exact canonical approval claims. */
  signature: string;
};

export type EnrolmentInstallAckV2 = {
  kind: 'install-ack';
  schema: typeof ENROLMENT_V2_SCHEMA;
  version: typeof ENROLMENT_V2_VERSION;
  transactionId: string;
  convoyId: string;
  groupId: string;
  recipient: EnrolmentIdentity;
  committedEpoch: number;
  rosterDigest: string;
  issuedAt: number;
  /** Recipient signature; authority still must verify against installed group. */
  signature: string;
};

/**
 * Existing Security v1 cannot implement this contract correctly.
 * The implementation must own atomic group changes, protected secrets,
 * authoritative role policy, replay/rollback journals and identity lifecycle.
 */
export interface ProposedSecurityV2EnrolmentPort {
  readonly contractVersion: 2;

  /**
   * Authenticates the signed approval AND its anchored, unrevoked role chain.
   * Pins requester fingerprint and verified direct-session provenance. Checks
   * peer trust, nonce replay, expected current group epoch and canonical AAD.
   */
  prepareAddMember(input: {
    approval: SignedEnrolmentApprovalV2;
    sessionId: string;
    context: SecurityProtocolContext;
  }): Promise<{transactionRef: string; expectedEpoch: number; nextEpoch: number}>;

  /**
   * Atomic, CAS-protected roster+secret change: commits next epoch exactly
   * once, removes access to previous key locally and durably records high-water.
   * Never publishes an added member before commit. Repeated transaction IDs
   * are idempotent ONLY if the full authenticated digest matches.
   */
  commitPreparedAddition(transactionRef: string): Promise<{
    transactionRef: string;
    groupId: string;
    committedEpoch: number;
    rosterDigest: string;
  }>;

  /**
   * Wraps the committed epoch independently for each active recipient over a
   * trusted direct session; binds transaction ID, role/roster digest and epoch.
   * Existing members must be retained; failed deliveries remain pending.
   */
  wrapCommittedEpoch(input: {
    transactionRef: string;
    recipient: EnrolmentIdentity;
    sessionId: string;
    context: SecurityProtocolContext;
  }): Promise<WrappedGroupKeyDistribution>;

  /**
   * Authenticates and installs committed roster/key on a recipient with atomic
   * anti-rollback persistence; emits a signed ack only AFTER installation.
   */
  installCommittedEpoch(input: {
    transactionId: string;
    convoyId: string;
    distribution: WrappedGroupKeyDistribution;
    context: SecurityProtocolContext;
  }): Promise<EnrolmentInstallAckV2>;

  /** Authenticates recipient signature, current key/roster epoch and transaction. */
  verifyInstalledAck(ack: EnrolmentInstallAckV2, transactionRef: string): Promise<boolean>;

  /**
   * Revalidates local key+membership+authority-chain+high-water after process
   * restart, and notifies on revocation / epoch / identity / trust changes.
   */
  subscribeInvalidations(listener: () => void): () => void;
}

/**
 * Explicit unavailable adapter: no cast from v1 GroupKeyManager to v2,
 * no direct SecurityMetadataStore.setGroup(), no fake crypto success.
 */
export class SecurityV2ContractUnavailable extends Error {
  readonly code = 'SECURITY_V2_CONTRACT_REQUIRED';
  constructor() {
    super('Incremental enrolment is disabled pending reviewed Security v2 support');
    this.name = 'SecurityV2ContractUnavailable';
  }
}

export const SECURE_ENROLMENT_V3_ACTIVATION = 'disabled-pending-security-v2-review' as const;

export function assertReference(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) {
    throw new TypeError('Invalid ' + label);
  }
}

export function assertEpoch(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 ||
      (value as number) > 0xffffffff) {
    throw new TypeError('Invalid ' + label);
  }
}

export function assertTimestamp(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError('Invalid ' + label);
  }
}

export function assertIdentity(value: unknown): asserts value is EnrolmentIdentity {
  if (!isRecord(value) || !hasKeys(value, ['deviceId', 'fingerprint', 'keyEpoch'])) {
    throw new TypeError('Invalid identity object');
  }
  assertReference(value.deviceId, 'device ID');
  if (!value.deviceId.startsWith('bm1_')) {
    throw new TypeError('Invalid BushMesh identity prefix');
  }
  assertReference(value.fingerprint, 'fingerprint');
  assertEpoch(value.keyEpoch, 'identity key epoch');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function hasKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('|') === [...expected].sort().join('|');
}

export function assertRoleCredentialClaims(value: unknown): asserts value is RoleCredentialClaimsV2 {
  if (!isRecord(value) || !hasKeys(value, [
    'schema', 'version', 'credentialId', 'convoyId', 'groupId', 'ownerAnchorFingerprint',
    'subject', 'role', 'issuer', 'authoritySequence', 'groupEpoch', 'issuedAt', 'expiresAt',
  ]) || value.schema !== 'bushmesh-convoy-role-credential-v2' || value.version !== 2) {
    throw new TypeError('Unsupported role credential claims');
  }
  for (const name of ['credentialId', 'convoyId', 'groupId', 'ownerAnchorFingerprint']) {
    assertReference(value[name], name);
  }
  if (!(value.groupId as string).startsWith('bmg1_')) {
    throw new TypeError('Invalid group identifier');
  }
  assertIdentity(value.subject);
  assertIdentity(value.issuer);
  if (value.role !== 'owner' && value.role !== 'admin') {
    throw new TypeError('Invalid credential role');
  }
  assertEpoch(value.authoritySequence, 'authority sequence');
  assertEpoch(value.groupEpoch, 'group epoch');
  assertTimestamp(value.issuedAt, 'issuedAt');
  assertTimestamp(value.expiresAt, 'expiresAt');
  if (value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > 7 * 86400000) {
    throw new TypeError('Invalid credential lifetime');
  }
}

export function assertSignedRoleCredential(value: unknown): asserts value is SignedRoleCredentialV2 {
  if (!isRecord(value) || !hasKeys(value, [
    'schema', 'version', 'credentialId', 'convoyId', 'groupId', 'ownerAnchorFingerprint',
    'subject', 'role', 'issuer', 'authoritySequence', 'groupEpoch', 'issuedAt', 'expiresAt',
    'signature',
  ])) {
    throw new TypeError('Malformed signed role credential');
  }
  const {signature, ...claims} = value;
  assertRoleCredentialClaims(claims);
  assertReference(signature, 'signature');
}

export function assertEnrolmentProposal(value: unknown): asserts value is EnrolmentProposalV2 {
  if (!isRecord(value) || !hasKeys(value, [
    'schema', 'version', 'operation', 'transactionId', 'requestId',
    'convoyId', 'groupId', 'requester', 'approver', 'expectedEpoch', 'nextEpoch',
    'rosterDigestBefore', 'rosterDigestAfter', 'credentialId', 'issuedAt', 'expiresAt',
  ]) || value.schema !== ENROLMENT_V2_SCHEMA || value.version !== 2 ||
    value.operation !== 'add-member') {
    throw new TypeError('Unsupported Security v2 enrolment proposal');
  }
  for (const name of ['transactionId', 'requestId', 'convoyId', 'groupId', 'rosterDigestBefore', 'rosterDigestAfter', 'credentialId']) {
    assertReference(value[name], name);
  }
  if (!(value.groupId as string).startsWith('bmg1_')) {
    throw new TypeError('Invalid group identifier');
  }
  assertIdentity(value.requester);
  assertIdentity(value.approver);
  assertEpoch(value.expectedEpoch, 'expected epoch');
  assertEpoch(value.nextEpoch, 'new epoch');
  if (value.nextEpoch !== (value.expectedEpoch as number) + 1) {
    throw new TypeError('Enrolment must advance exactly one epoch');
  }
  if (value.rosterDigestBefore === value.rosterDigestAfter) {
    throw new TypeError('Enrolment must change the authenticated roster');
  }
  assertTimestamp(value.issuedAt, 'issuedAt');
  assertTimestamp(value.expiresAt, 'expiresAt');
  if (value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > 600000) {
    throw new TypeError('Invalid approval lifetime');
  }
}

export function assertSignedApproval(value: unknown): asserts value is SignedEnrolmentApprovalV2 {
  if (!isRecord(value) || !hasKeys(value, ['kind', 'proposal', 'credential', 'signature']) ||
    value.kind !== 'approval') {
    throw new TypeError('Malformed signed enrolment approval');
  }
  assertEnrolmentProposal(value.proposal);
  assertSignedRoleCredential(value.credential);
  assertReference(value.signature, 'signature');
  const proposal = value.proposal;
  const credential = value.credential;
  if (proposal.groupId !== credential.groupId ||
      proposal.convoyId !== credential.convoyId ||
      proposal.credentialId !== credential.credentialId ||
      proposal.approver.deviceId !== credential.subject.deviceId ||
      proposal.approver.fingerprint !== credential.subject.fingerprint ||
      proposal.approver.keyEpoch !== credential.subject.keyEpoch ||
      proposal.expectedEpoch !== credential.groupEpoch) {
    throw new TypeError('Role credential is not bound to this approval');
  }
}

export function assertInstallAck(value: unknown): asserts value is EnrolmentInstallAckV2 {
  if (!isRecord(value) || !hasKeys(value, [
    'kind', 'schema', 'version', 'transactionId', 'convoyId', 'groupId',
    'recipient', 'committedEpoch', 'rosterDigest', 'issuedAt', 'signature',
  ]) || value.kind !== 'install-ack' || value.schema !== ENROLMENT_V2_SCHEMA ||
    value.version !== 2) {
    throw new TypeError('Invalid installation acknowledgement');
  }
  for (const name of ['transactionId', 'convoyId', 'groupId', 'rosterDigest', 'signature']) {
    assertReference(value[name], name);
  }
  assertIdentity(value.recipient);
  assertEpoch(value.committedEpoch, 'committed epoch');
  assertTimestamp(value.issuedAt, 'issuedAt');
}

/** Strict wire parser for PROPOSED control messages; never grants rights. */
export function decodeProposedEnrolmentControl(raw: Uint8Array): SignedEnrolmentApprovalV2 | EnrolmentInstallAckV2 {
  if (raw.length === 0 || raw.length > ENROLMENT_MAX_WIRE_BYTES) {
    throw new TypeError('Invalid enrolment control length');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    throw new TypeError('Malformed enrolment control JSON');
  }
  if (!isRecord(parsed)) {
    throw new TypeError('Invalid enrolment control');
  }
  if (parsed.kind === 'approval') {
    assertSignedApproval(parsed);
    return parsed;
  }
  assertInstallAck(parsed);
  return parsed;
}

/** Deterministic field order for serialised proposals, not a signature check. */
export function encodeProposedEnrolmentControl(value: SignedEnrolmentApprovalV2 | EnrolmentInstallAckV2): Uint8Array {
  if (value.kind === 'approval') {
    assertSignedApproval(value);
  } else {
    assertInstallAck(value);
  }
  const encoded = Uint8Array.from(Buffer.from(JSON.stringify(value), 'utf8'));
  if (encoded.length > ENROLMENT_MAX_WIRE_BYTES) {
    throw new TypeError('Oversized enrolment control');
  }
  return encoded;
}
