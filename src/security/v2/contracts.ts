import type {SignedEnrolmentApprovalV2} from '../../convoy/enrolmentV3/contract';
import type {DeviceIdentity, EncryptedDirectMessage, SecurityProtocolContext} from '../types';

/** Additive Security v2; none of these objects are Security v1 GroupRecord metadata. */
export const SECURITY_V2_GROUP_VERSION = 2 as const;
/** Live activation remains gated by the separate formal review. */
export const SECURITY_V2_PRODUCTION_ACTIVATION = 'disabled-pending-formal-review' as const;

export type PrincipalV2 = {deviceId: string; fingerprint: string; keyEpoch: number};
export type RosterMemberV2 = PrincipalV2 & {
  state: 'active' | 'pending-install' | 'revoked';
  joinedAt: number;
  revokedAt?: number;
};
export type SignedOwnerGenesisV2 = {
  kind: 'bushmesh-v2-owner-genesis';
  version: 2;
  convoyId: string;
  groupId: string;
  owner: DeviceIdentity;
  protocolVersion: number;
  createdAt: number;
  signature: string;
};
/** Requires independently authenticated user/platform trust provisioning. Never inferred from a signed claim. */
export type PinnedOwnerAnchorV2 = {groupId: string; ownerFingerprint: string; genesisDigest: string};

export type SignedJoinRequestV2 = {
  kind: 'bushmesh-v2-join-request';
  version: 2;
  convoyId: string;
  groupId: string;
  requestId: string;
  requester: PrincipalV2;
  expectedEpoch: number;
  /** SHA-256 of the *exact* Protocol v1 canonical immutable AAD bytes. */
  aadDigest: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
};
export type RoleRevocationV2 = {
  kind: 'bushmesh-v2-revoke-role';
  version: 2;
  groupId: string;
  credentialId: string;
  issuer: PrincipalV2;
  expectedAuthoritySequence: number;
  nextAuthoritySequence: number;
  issuedAt: number;
  signature: string;
};
export type GroupSnapshotV2 = {
  version: 2;
  convoyId: string;
  groupId: string;
  genesis: SignedOwnerGenesisV2;
  genesisDigest: string;
  protocolVersion: number;
  epoch: number;
  /** Digest includes canonical sorted roster, states, group and epoch. */
  rosterDigest: string;
  roster: RosterMemberV2[];
  authoritySequence: number;
  revokedCredentials: string[];
  state: 'active' | 'invalidated';
};
export type PreparedAdditionV2 = {
  transactionId: string;
  requestId: string;
  proposalDigest: string;
  join: SignedJoinRequestV2;
  approval: SignedEnrolmentApprovalV2;
  expectedEpoch: number;
  nextEpoch: number;
  nextRoster: RosterMemberV2[];
  nextRosterDigest: string;
  status: 'prepared' | 'committed' | 'superseded';
  preparedAt: number;
  /** Verified recipient signatures, not radio-send acknowledgements. */
  verifiedReceipts: Record<string, string>;
};
export type BoundEpochDistributionV2 = {
  kind: 'bushmesh-v2-epoch-distribution';
  version: 2;
  transactionId: string;
  convoyId: string;
  groupId: string;
  committedEpoch: number;
  rosterDigest: string;
  genesisDigest: string;
  sender: PrincipalV2;
  recipient: PrincipalV2;
  /** Exact authenticated Protocol v1 header supplied by its runtime. */
  aadDigest: string;
  /** V2 payload encrypted using frozen Security v1 DirectSessionManager. */
  encryptedPayload: EncryptedDirectMessage;
  /** Full canonical committed state and authenticated authority evidence. */
  snapshot: GroupSnapshotV2;
  join: SignedJoinRequestV2;
  approval: SignedEnrolmentApprovalV2;
  signature: string;
};
export type InstalledAckV2 = {
  kind: 'bushmesh-v2-installed-ack';
  version: 2;
  transactionId: string;
  groupId: string;
  committedEpoch: number;
  rosterDigest: string;
  distributionDigest: string;
  recipient: PrincipalV2;
  issuedAt: number;
  signature: string;
};
export type VerifiedMembershipV2 = {
  authorized: boolean;
  epoch: number | null;
  reason: 'verified-local-epoch' | 'not-installed' | 'missing-ack' | 'revoked' |
    'pending' | 'untrusted-identity' | 'corrupt-or-rolled-back';
};

/**
 * A production implementation MUST commit each operation atomically across
 * roster, key custody, journal and epoch fence. Throwing after an ambiguous
 * commit is safe ONLY when a retry can read the same transaction digest.
 * A crash-safe DB alone is NOT hardware-backed rollback resistance.
 */
export interface SecurityV2TransactionalStore {
  getPinnedGenesis(groupId: string): Promise<PinnedOwnerAnchorV2 | null>;
  loadGroup(groupId: string): Promise<GroupSnapshotV2 | null>;
  getEpochHighWater(groupId: string): Promise<number>;
  getEpochKey(groupId: string, epoch: number): Promise<Uint8Array | null>;
  getTransaction(transactionId: string): Promise<PreparedAdditionV2 | null>;
  getInstalledDistribution(transactionId: string): Promise<string | null>;
  getVerifiedReceipt(transactionId: string, deviceId: string): Promise<string | null>;

  /** Only after independently verified owner/genesis provisioning. */
  initializeOwnedGroup(
    snapshot: GroupSnapshotV2, anchor: PinnedOwnerAnchorV2, freshKey: Uint8Array,
  ): Promise<void>;
  /** CAS + durable journal; never modifies the published roster. */
  prepareAddition(
    expectedEpoch: number, expectedRosterDigest: string, record: PreparedAdditionV2,
  ): Promise<PreparedAdditionV2>;
  /** Atomic CAS: next roster, new secret, epoch fence, journal. No split writes. */
  commitAddition(transactionId: string, next: GroupSnapshotV2, freshKey: Uint8Array):
    Promise<PreparedAdditionV2>;
  /** Atomic install + epoch fence + replay journal, including first install. */
  installEpoch(transactionId: string, distributionDigest: string,
    snapshot: GroupSnapshotV2, freshKey: Uint8Array): Promise<'installed' | 'duplicate'>;
  /** Atomic verified ack receipt; duplicate exact digest is idempotent. */
  recordVerifiedReceipt(transactionId: string, recipient: string, ackDigest: string):
    Promise<boolean>;
  /** Epoch fence remains monotonic; invalidated epochs never revive. */
  invalidateEpoch(groupId: string, expectedEpoch: number): Promise<void>;
  /** Owner-signed, monotonic and atomic role revocation. */
  revokeCredential(groupId: string, expectedSequence: number, credentialId: string):
    Promise<void>;
}

export interface SecurityV2GroupTransactionsPort {
  readonly contractVersion: 2;
  prepareAddMember(input: {
    join: SignedJoinRequestV2;
    approval: SignedEnrolmentApprovalV2;
    sessionId: string;
    context: SecurityProtocolContext;
  }): Promise<{transactionRef: string; expectedEpoch: number; nextEpoch: number}>;
  commitPreparedAddition(transactionRef: string): Promise<{
    transactionRef: string; groupId: string; committedEpoch: number; rosterDigest: string;
  }>;
  wrapCommittedEpoch(input: {
    transactionRef: string; recipient: PrincipalV2;
    sessionId: string; context: SecurityProtocolContext;
  }): Promise<BoundEpochDistributionV2>;
  installCommittedEpoch(input: {distribution: BoundEpochDistributionV2;
    context: SecurityProtocolContext}): Promise<InstalledAckV2>;
  verifyInstalledAck(ack: InstalledAckV2, transactionRef: string): Promise<boolean>;
  resolveCurrentMembership(groupId: string, member: PrincipalV2): Promise<VerifiedMembershipV2>;
}

export class SecurityV2Error extends Error {
  constructor(readonly code:
    'INVALID_INPUT' | 'UNTRUSTED' | 'FORGED_AUTHORITY' | 'STALE_EPOCH' |
    'CONFLICT' | 'REPLAY' | 'DOWNGRADE' | 'KEY_MISSING' |
    'STORE_UNAVAILABLE' | 'CORRUPT_STATE' | 'NOT_COMMITTED' |
    'REVOKED' | 'EXPIRED' | 'NOT_INSTALLED',
  message: string) {
    super(message);
    this.name = 'SecurityV2Error';
  }
}
