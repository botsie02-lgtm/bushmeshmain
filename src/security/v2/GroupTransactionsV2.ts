import {Buffer} from 'buffer';
import type {
  EnrolmentProposalV2, SignedEnrolmentApprovalV2,
} from '../../convoy/enrolmentV3/contract';
import type {IdentityManager} from '../identity';
import type {PeerTrustManager} from '../trust';
import type {DirectSessionManager} from '../session';
import type {CryptoProvider, SecurityClock} from '../ports';
import {systemClock} from '../ports';
import type {DeviceIdentity, SecurityProtocolContext} from '../types';
import {fromBase64Url, toBase64Url, utf8, wipe} from '../bytes';
import {
  SECURITY_V2_GROUP_VERSION, SecurityV2Error,
} from './contracts';
import type {
  BoundEpochDistributionV2, GroupSnapshotV2, InstalledAckV2,
  PinnedOwnerAnchorV2, PreparedAdditionV2, PrincipalV2, RoleRevocationV2,
  RosterMemberV2, SecurityV2GroupTransactionsPort, SecurityV2TransactionalStore,
  SignedJoinRequestV2, SignedOwnerGenesisV2, VerifiedMembershipV2,
} from './contracts';
import {
  aadDigestV2, ackTranscript, approvalTranscriptV2, assertPrincipalV2,
  assertReferenceV2, assertSnapshotShape, canonicalDigestV2,
  canonicalValue, distributionTranscript, encodeSignature, genesisTranscript,
  joinTranscript, roleCredentialTranscriptV2, roleRevocationTranscript,
  rosterDigestV2, samePrincipal, signatureBytes, sortedRoster,
} from './canonical';

const MAX_CLOCK_SKEW_MS = 5000;
const JOIN_MAX_DURATION_MS = 600_000;
const EPOCH_MAX = 0xffffffff;
const KEY_PACKAGE_KIND = 'bushmesh-v2-protected-epoch-key';
const GENESIS_DOMAIN = 'bushmesh-security-v2-signed-genesis-digest-v1';
const APPROVAL_DOMAIN = 'bushmesh-security-v2-approved-transaction-digest-v1';
const DISTRIBUTION_DOMAIN = 'bushmesh-security-v2-bound-distribution-digest-v1';
const ACK_DOMAIN = 'bushmesh-security-v2-ack-digest-v1';

function principal(identity: DeviceIdentity): PrincipalV2 {
  return {deviceId: identity.deviceId, fingerprint: identity.fingerprint,
    keyEpoch: identity.keyEpoch};
}
function ensure(condition: unknown, code: ConstructorParameters<typeof SecurityV2Error>[0],
  message: string): asserts condition {
  if (!condition) {throw new SecurityV2Error(code, message);}
}
function timeValid(now: number, issuedAt: number, expiresAt: number): boolean {
  return Number.isSafeInteger(issuedAt) && Number.isSafeInteger(expiresAt) &&
    issuedAt > 0 && expiresAt > issuedAt &&
    expiresAt - issuedAt <= JOIN_MAX_DURATION_MS &&
    issuedAt <= now + MAX_CLOCK_SKEW_MS && expiresAt > now;
}
function decoded(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new SecurityV2Error('INVALID_INPUT', 'Invalid encrypted v2 key package');
  }
}
function plainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Security v2 draft core. No radio, no Protocol v1 encoder, no Security v1
 * GroupKeyManager metadata writes, and no production registration.
 * Only a reviewed transactional-store provider can meet the atomic contract.
 */
export class SecurityV2GroupTransactions implements SecurityV2GroupTransactionsPort {
  readonly contractVersion = SECURITY_V2_GROUP_VERSION;
  constructor(
    private readonly crypto: CryptoProvider,
    private readonly identity: Pick<IdentityManager, 'current' | 'sign' | 'verify'>,
    private readonly trust: Pick<PeerTrustManager, 'assertTrusted'>,
    private readonly sessions: Pick<DirectSessionManager, 'assertPeerSession' | 'encrypt' | 'decrypt'>,
    private readonly store: SecurityV2TransactionalStore,
    private readonly clock: SecurityClock = systemClock,
  ) {}

  /** Only the local signing identity may originate its own owner genesis. */
  async createOwnedGenesis(convoyId: string, groupId: string,
    protocolVersion: number): Promise<GroupSnapshotV2> {
    assertReferenceV2(convoyId);
    ensure(/^bmg1_[A-Za-z0-9_-]{8,128}$/.test(groupId), 'INVALID_INPUT', 'Invalid group ID');
    ensure(Number.isSafeInteger(protocolVersion) && protocolVersion >= 1 &&
      protocolVersion <= 3, 'INVALID_INPUT', 'Unsupported Protocol v1 version');
    const owner = await this.identity.current();
    const unsigned: SignedOwnerGenesisV2 = {
      kind: 'bushmesh-v2-owner-genesis', version: 2, convoyId, groupId,
      owner, protocolVersion, createdAt: this.clock.now(), signature: '',
    };
    const genesis: SignedOwnerGenesisV2 = {
      ...unsigned, signature: encodeSignature(await this.identity.sign(genesisTranscript(unsigned))),
    };
    const genesisDigest = await canonicalDigestV2(this.crypto, GENESIS_DOMAIN, genesis);
    const roster: RosterMemberV2[] = [{
      ...principal(owner), state: 'active', joinedAt: unsigned.createdAt,
    }];
    const snapshot: GroupSnapshotV2 = {
      version: 2, convoyId, groupId, genesis, genesisDigest,
      protocolVersion, epoch: 1, currentTransactionId: null,
      roster, rosterDigest: await rosterDigestV2(this.crypto, groupId, 1, roster),
      authoritySequence: 1, revokedCredentials: [], state: 'active',
    };
    const anchor: PinnedOwnerAnchorV2 = {
      groupId, ownerFingerprint: owner.fingerprint, genesisDigest,
    };
    const key = this.freshEpochKey();
    try {
      await this.store.initializeOwnedGroup(snapshot, anchor, key);
    } finally {
      wipe(key);
    }
    return snapshot;
  }

  /** Request signatures are signed with opaque Security v1 identity handles. */
  async signJoinRequest(input: {
    convoyId: string; groupId: string; requestId: string;
    expectedEpoch: number; context: SecurityProtocolContext; expiresAt: number;
  }): Promise<SignedJoinRequestV2> {
    const local = await this.identity.current();
    const request: SignedJoinRequestV2 = {
      kind: 'bushmesh-v2-join-request', version: 2, convoyId: input.convoyId,
      groupId: input.groupId, requestId: input.requestId,
      requester: principal(local), expectedEpoch: input.expectedEpoch,
      aadDigest: await aadDigestV2(this.crypto, input.context.authenticatedHeader),
      issuedAt: this.clock.now(), expiresAt: input.expiresAt, signature: '',
    };
    assertReferenceV2(request.requestId);
    ensure(timeValid(this.clock.now(), request.issuedAt, request.expiresAt),
      'EXPIRED', 'Join request expiration is invalid');
    return {...request, signature: encodeSignature(await this.identity.sign(joinTranscript(request)))};
  }

  private async pinnedIdentity(who: PrincipalV2): Promise<DeviceIdentity> {
    assertPrincipalV2(who);
    const local = await this.identity.current();
    if (samePrincipal(principal(local), who)) {return local;}
    let identity: DeviceIdentity;
    try {
      const trusted = await this.trust.assertTrusted(who.deviceId, who.fingerprint);
      identity = trusted.identity;
    } catch {
      throw new SecurityV2Error('UNTRUSTED', 'Peer trust or fingerprint pin unavailable');
    }
    ensure(samePrincipal(principal(identity), who), 'UNTRUSTED',
      'Peer key epoch changed or fingerprint rotated');
    return identity;
  }

  private async checkSignature(who: DeviceIdentity, transcript: Uint8Array,
    signature: string): Promise<void> {
    let valid = false;
    try {
      valid = await this.identity.verify(who, transcript, signatureBytes(signature));
    } catch {
      valid = false;
    }
    ensure(valid, 'FORGED_AUTHORITY', 'Invalid Security v2 authenticated signature');
  }

  private async validateGenesis(group: GroupSnapshotV2): Promise<void> {
    assertSnapshotShape(group);
    const genesis = group.genesis;
    ensure(genesis.kind === 'bushmesh-v2-owner-genesis' && genesis.version === 2 &&
      genesis.owner.fingerprint === group.genesis.owner.fingerprint &&
      genesis.owner.deviceId === group.genesis.owner.deviceId,
      'CORRUPT_STATE', 'Invalid signed owner genesis');
    const anchor = await this.store.getPinnedGenesis(group.groupId);
    ensure(!!anchor && anchor.genesisDigest === group.genesisDigest &&
      anchor.groupId === group.groupId &&
      anchor.ownerFingerprint === genesis.owner.fingerprint,
      'UNTRUSTED', 'Signed genesis has no independently pinned owner anchor');
    const digest = await canonicalDigestV2(this.crypto, GENESIS_DOMAIN, genesis);
    ensure(digest === group.genesisDigest, 'CORRUPT_STATE', 'Owner genesis digest mismatch');
    await this.checkSignature(genesis.owner, genesisTranscript(genesis), genesis.signature);
    // An old pinned signing identity cannot be silently upgraded on rotation.
    await this.pinnedIdentity(principal(genesis.owner));
  }

  private async loadVerifiedGroup(groupId: string): Promise<GroupSnapshotV2> {
    const group = await this.store.loadGroup(groupId);
    ensure(group !== null, 'NOT_COMMITTED', 'Security v2 group not initialized');
    await this.validateGenesis(group);
    const high = await this.store.getEpochHighWater(groupId);
    ensure(Number.isSafeInteger(high) && high === group.epoch,
      'CORRUPT_STATE', 'Group epoch/high-water mismatch; fail closed');
    ensure(group.state === 'active', 'REVOKED', 'Current group epoch invalidated');
    ensure(group.rosterDigest === await rosterDigestV2(this.crypto,
      group.groupId, group.epoch, group.roster),
      'CORRUPT_STATE', 'Authenticated roster digest mismatch');
    return group;
  }

  private async requireContext(group: GroupSnapshotV2,
    context: SecurityProtocolContext): Promise<string> {
    ensure(context && context.protocolVersion === group.protocolVersion,
      'DOWNGRADE', 'Protocol v1 negotiated version mismatch');
    return aadDigestV2(this.crypto, context.authenticatedHeader);
  }

  private async validateJoin(join: SignedJoinRequestV2,
    expectedEpoch: number, aadDigest: string, convoyId: string, groupId: string): Promise<void> {
    ensure(join.kind === 'bushmesh-v2-join-request' && join.version === 2,
      'DOWNGRADE', 'Invalid Security v2 join object version');
    assertReferenceV2(join.requestId);
    ensure(join.groupId === groupId && join.convoyId === convoyId &&
      join.expectedEpoch === expectedEpoch && join.aadDigest === aadDigest,
      'CONFLICT', 'Join binding, AAD or expected epoch mismatch');
    ensure(timeValid(this.clock.now(), join.issuedAt, join.expiresAt),
      'EXPIRED', 'Join request is expired or invalid');
    const requester = await this.pinnedIdentity(join.requester);
    await this.checkSignature(requester, joinTranscript(join), join.signature);
  }

  /**
   * Verifies directly owner-signed (one-hop only) administrative authority.
   * Admin -> admin delegation, claimed leader role and inherited UI grants
   * cannot satisfy this check.
   */
  private async validateAuthority(snapshot: GroupSnapshotV2,
    approval: SignedEnrolmentApprovalV2, expectedEpoch: number,
    requireFreshTime = true): Promise<void> {
    ensure(approval.kind === 'approval', 'INVALID_INPUT', 'Missing signed approval');
    const {proposal, credential} = approval;
    ensure(proposal.schema === 'bushmesh-convoy-enrolment-v2' &&
      proposal.version === 2 && proposal.operation === 'add-member' &&
      credential.schema === 'bushmesh-convoy-role-credential-v2' &&
      credential.version === 2, 'DOWNGRADE', 'Unsupported authority schema');
    assertReferenceV2(proposal.transactionId);
    assertReferenceV2(proposal.requestId);
    assertReferenceV2(credential.credentialId);
    ensure(proposal.groupId === snapshot.groupId &&
      proposal.convoyId === snapshot.convoyId &&
      proposal.expectedEpoch === expectedEpoch &&
      proposal.nextEpoch === expectedEpoch + 1 && proposal.nextEpoch <= EPOCH_MAX &&
      credential.groupId === snapshot.groupId &&
      credential.convoyId === snapshot.convoyId &&
      credential.ownerAnchorFingerprint === snapshot.genesis.owner.fingerprint &&
      credential.credentialId === proposal.credentialId &&
      credential.groupEpoch === expectedEpoch &&
      credential.authoritySequence === snapshot.authoritySequence &&
      !snapshot.revokedCredentials.includes(credential.credentialId) &&
      samePrincipal(credential.subject, proposal.approver) &&
      samePrincipal(credential.issuer, principal(snapshot.genesis.owner)),
      'FORGED_AUTHORITY', 'Approval cannot be traced to current owner root');
    if (requireFreshTime) {
      ensure(timeValid(this.clock.now(), proposal.issuedAt, proposal.expiresAt) &&
        timeValid(this.clock.now(), credential.issuedAt, credential.expiresAt),
        'EXPIRED', 'Approval or role credential expired');
    }
    const isOwner = samePrincipal(proposal.approver, principal(snapshot.genesis.owner));
    ensure((credential.role === 'owner' && isOwner) ||
      (credential.role === 'admin' && !isOwner &&
        snapshot.roster.some(m => m.state === 'active' &&
          samePrincipal(m, proposal.approver))),
      'FORGED_AUTHORITY', 'Neither anchored owner nor current approved admin');
    await this.checkSignature(snapshot.genesis.owner,
      roleCredentialTranscriptV2(credential), credential.signature);
    const approver = await this.pinnedIdentity(proposal.approver);
    await this.checkSignature(approver, approvalTranscriptV2(proposal), approval.signature);
  }

  private async validateApprovalRequest(group: GroupSnapshotV2,
    join: SignedJoinRequestV2, approval: SignedEnrolmentApprovalV2,
    aadDigest: string): Promise<RosterMemberV2[]> {
    await this.validateJoin(join, group.epoch, aadDigest, group.convoyId, group.groupId);
    await this.validateAuthority(group, approval, group.epoch);
    const p: EnrolmentProposalV2 = approval.proposal;
    ensure(p.requestId === join.requestId && samePrincipal(p.requester, join.requester) &&
      p.rosterDigestBefore === group.rosterDigest &&
      group.state === 'active', 'CONFLICT', 'Request and authenticated roster do not match');
    ensure(!group.roster.some(m=>m.deviceId === join.requester.deviceId),
      'REVOKED', 'Duplicate or previously revoked member cannot be re-added');
    const nextRoster: RosterMemberV2[] = sortedRoster([...group.roster, {
      ...join.requester, state: 'pending-install', joinedAt: join.issuedAt,
    }]);
    ensure(p.rosterDigestAfter === await rosterDigestV2(this.crypto,
      group.groupId, p.nextEpoch, nextRoster),
      'CONFLICT', 'Proposed new roster digest does not match the complete roster');
    return nextRoster;
  }

  async prepareAddMember(input: {join: SignedJoinRequestV2;
    approval: SignedEnrolmentApprovalV2; sessionId: string;
    context: SecurityProtocolContext}): Promise<{
    transactionRef: string; expectedEpoch: number; nextEpoch: number;
  }> {
    const group = await this.loadVerifiedGroup(input.approval.proposal.groupId);
    const aadDigest = await this.requireContext(group, input.context);
    await this.sessions.assertPeerSession(input.sessionId,
      input.join.requester.deviceId, input.join.requester.fingerprint);
    const local = await this.identity.current();
    ensure(samePrincipal(principal(local), input.approval.proposal.approver),
      'FORGED_AUTHORITY', 'Only current local approving authority may prepare');
    const nextRoster = await this.validateApprovalRequest(group,
      input.join, input.approval, aadDigest);
    const p = input.approval.proposal;
    const digest = await canonicalDigestV2(this.crypto, APPROVAL_DOMAIN,
      {join: input.join, approval: input.approval});
    const tx: PreparedAdditionV2 = {
      transactionId: p.transactionId, requestId: p.requestId, proposalDigest: digest,
      join: input.join, approval: input.approval,
      expectedEpoch: group.epoch, nextEpoch: p.nextEpoch,
      nextRoster, nextRosterDigest: p.rosterDigestAfter,
      status: 'prepared', preparedAt: this.clock.now(),
      verifiedReceipts: {}, issuedDistributions: {},
    };
    const record = await this.store.prepareAddition(group.epoch, group.rosterDigest, tx);
    return {transactionRef: record.transactionId,
      expectedEpoch: record.expectedEpoch, nextEpoch: record.nextEpoch};
  }

  async commitPreparedAddition(transactionRef: string): Promise<{
    transactionRef: string; groupId: string; committedEpoch: number; rosterDigest: string;
  }> {
    const tx = await this.store.getTransaction(transactionRef);
    ensure(tx !== null, 'NOT_COMMITTED', 'Prepared transaction was not durably recorded');
    const p = tx.approval.proposal;
    const group = await this.loadVerifiedGroup(p.groupId);
    if (tx.status === 'committed') {
      ensure(group.epoch === tx.nextEpoch && group.currentTransactionId === tx.transactionId &&
        group.rosterDigest === tx.nextRosterDigest,
        'STALE_EPOCH', 'Committed transaction superseded by another epoch');
      return {transactionRef, groupId: group.groupId,
        committedEpoch: group.epoch, rosterDigest: group.rosterDigest};
    }
    ensure(tx.status === 'prepared' && group.epoch === tx.expectedEpoch &&
      group.rosterDigest === p.rosterDigestBefore,
      'STALE_EPOCH', 'Prepared transaction no longer matches current epoch');
    ensure(tx.proposalDigest === await canonicalDigestV2(this.crypto, APPROVAL_DOMAIN,
      {join: tx.join, approval: tx.approval}),
      'CORRUPT_STATE', 'Prepared journal digest mismatch');
    // Recheck all identities and owner/admin grants immediately before CAS.
    await this.validateAuthority(group, tx.approval, tx.expectedEpoch);
    await this.validateJoin(tx.join, tx.expectedEpoch, tx.join.aadDigest,
      group.convoyId, group.groupId);
    ensure(!group.roster.some(m=>m.deviceId === tx.join.requester.deviceId),
      'REVOKED', 'A revoked/duplicate member cannot revive via stale preparation');
    const local = await this.identity.current();
    ensure(samePrincipal(principal(local), p.approver),
      'FORGED_AUTHORITY', 'Approver identity rotated before commit');
    ensure(tx.nextRosterDigest === await rosterDigestV2(this.crypto,
      group.groupId, tx.nextEpoch, tx.nextRoster),
      'CORRUPT_STATE', 'Prepared roster digest has changed');
    const next: GroupSnapshotV2 = {
      ...group, epoch: tx.nextEpoch, currentTransactionId: transactionRef,
      roster: tx.nextRoster, rosterDigest: tx.nextRosterDigest,
    };
    const key = this.freshEpochKey();
    try {
      await this.store.commitAddition(transactionRef, next, key);
    } finally {
      wipe(key);
    }
    return {transactionRef, groupId: group.groupId,
      committedEpoch: next.epoch, rosterDigest: next.rosterDigest};
  }

  private freshEpochKey(): Uint8Array {
    const bytes = this.crypto.randomBytes(32);
    ensure(bytes.length === 32, 'KEY_MISSING', 'Secure random epoch key was unavailable');
    return bytes;
  }

  async wrapCommittedEpoch(input: {transactionRef: string; recipient: PrincipalV2;
    sessionId: string; context: SecurityProtocolContext}): Promise<BoundEpochDistributionV2> {
    const tx = await this.store.getTransaction(input.transactionRef);
    ensure(tx?.status === 'committed', 'NOT_COMMITTED', 'Key wrapping requires a committed epoch');
    const group = await this.loadVerifiedGroup(tx.approval.proposal.groupId);
    const aadDigest = await this.requireContext(group, input.context);
    ensure(group.currentTransactionId === tx.transactionId && group.epoch === tx.nextEpoch &&
      group.rosterDigest === tx.nextRosterDigest,
      'STALE_EPOCH', 'Cannot distribute superseded epoch');
    const local = await this.identity.current();
    ensure(samePrincipal(principal(local), tx.approval.proposal.approver),
      'FORGED_AUTHORITY', 'Only original anchored authority may sign distribution');
    const recipient = group.roster.find(m => samePrincipal(m, input.recipient));
    ensure(recipient && recipient.state !== 'revoked', 'REVOKED',
      'Recipient has no current authenticated roster entry');
    await this.pinnedIdentity(input.recipient);
    await this.sessions.assertPeerSession(input.sessionId,
      input.recipient.deviceId, input.recipient.fingerprint);
    // Role revocation after commit invalidates distribution rights.
    ensure(!group.revokedCredentials.includes(tx.approval.credential.credentialId) &&
      group.authoritySequence === tx.approval.credential.authoritySequence,
      'REVOKED', 'Approval authority has been revoked since commit');
    const key = await this.store.getEpochKey(group.groupId, group.epoch);
    ensure(key?.length === 32, 'KEY_MISSING', 'Protected committed epoch secret missing');
    let plaintext: Uint8Array | undefined;
    try {
      plaintext = utf8(canonicalValue({
        kind: KEY_PACKAGE_KIND, version: 2, groupId: group.groupId,
        transactionId: tx.transactionId, epoch: group.epoch,
        rosterDigest: group.rosterDigest, genesisDigest: group.genesisDigest,
        recipient: input.recipient, key: toBase64Url(key),
      }));
      const encryptedPayload = await this.sessions.encrypt(input.sessionId, plaintext, input.context);
      const draft: BoundEpochDistributionV2 = {
        kind: 'bushmesh-v2-epoch-distribution', version: 2,
        transactionId: tx.transactionId, convoyId: group.convoyId,
        groupId: group.groupId, committedEpoch: group.epoch,
        rosterDigest: group.rosterDigest, genesisDigest: group.genesisDigest,
        sender: principal(local), recipient: input.recipient, aadDigest,
        encryptedPayload, snapshot: group, join: tx.join,
        approval: tx.approval, signature: '',
      };
      const distribution: BoundEpochDistributionV2 = {
        ...draft, signature: encodeSignature(
          await this.identity.sign(distributionTranscript(draft))),
      };
      const digest = await canonicalDigestV2(this.crypto, DISTRIBUTION_DOMAIN, distribution);
      await this.store.recordIssuedDistribution(tx.transactionId, input.recipient.deviceId, digest);
      return distribution;
    } finally {
      wipe(key);
      wipe(plaintext);
    }
  }

  async installCommittedEpoch(input: {distribution: BoundEpochDistributionV2;
    context: SecurityProtocolContext}): Promise<InstalledAckV2> {
    const v = input.distribution;
    ensure(v.kind === 'bushmesh-v2-epoch-distribution' && v.version === 2,
      'DOWNGRADE', 'Unsupported distribution version');
    const group = v.snapshot;
    await this.validateGenesis(group);
    const aadDigest = await this.requireContext(group, input.context);
    ensure(v.aadDigest === aadDigest && group.state === 'active' &&
      v.groupId === group.groupId && v.convoyId === group.convoyId &&
      v.genesisDigest === group.genesisDigest &&
      v.committedEpoch === group.epoch &&
      v.rosterDigest === group.rosterDigest &&
      group.currentTransactionId === v.transactionId &&
      group.rosterDigest === await rosterDigestV2(this.crypto, group.groupId, group.epoch, group.roster),
      'CONFLICT', 'Signed distribution state, roster or AAD mismatch');
    ensure(v.approval.proposal.transactionId === v.transactionId &&
      v.approval.proposal.nextEpoch === v.committedEpoch &&
      v.approval.proposal.rosterDigestAfter === v.rosterDigest &&
      v.join.requestId === v.approval.proposal.requestId,
      'CONFLICT', 'Distribution references a different approval');
    const local = await this.identity.current();
    ensure(samePrincipal(principal(local), v.recipient), 'UNTRUSTED',
      'Encrypted distribution is not for current local identity');
    ensure(group.roster.some(m => samePrincipal(m, v.recipient) && m.state !== 'revoked'),
      'REVOKED', 'Recipient is not part of new roster');
    // Never revive an old revoked identity from a remote roster snapshot.
    const oldGroup = await this.store.loadGroup(v.groupId);
    if (oldGroup) {
      ensure(oldGroup.genesisDigest === group.genesisDigest, 'UNTRUSTED',
        'Group owner root changed');
      ensure(group.authoritySequence >= oldGroup.authoritySequence &&
        oldGroup.revokedCredentials.every(id => group.revokedCredentials.includes(id)),
        'REVOKED', 'Remote role revocation or authority sequence rolled back');
      for (const m of oldGroup.roster) {
        ensure(group.roster.some(n => n.deviceId === m.deviceId &&
          canonicalValue(n) === canonicalValue(m)),
          'REVOKED', 'Add-member distribution modified an existing member');
      }
    }
    ensure(v.committedEpoch > await this.store.getEpochHighWater(v.groupId),
      'REPLAY', 'Distribution is not newer than the protected epoch fence');
    // A missing local authority-sequence checkpoint cannot validate a remote
    // delegated-admin claim across a disconnection. Allow owner-signed only.
    ensure(samePrincipal(v.sender, principal(group.genesis.owner)) &&
      samePrincipal(v.approval.proposal.approver, v.sender) &&
      v.approval.credential.role === 'owner',
      'FORGED_AUTHORITY', 'Recipient requires anchored owner-signed distribution');
    await this.validateAuthority(group, v.approval, v.approval.proposal.expectedEpoch, false);
    ensure(group.authoritySequence === v.approval.credential.authoritySequence,
      'FORGED_AUTHORITY', 'Missing current owner authority sequence');
    await this.validateJoin(v.join, v.join.expectedEpoch, v.join.aadDigest,
      group.convoyId, group.groupId);
    const sender = await this.pinnedIdentity(v.sender);
    await this.checkSignature(sender, distributionTranscript(v), v.signature);
    await this.sessions.assertPeerSession(v.encryptedPayload.sessionId,
      v.sender.deviceId, v.sender.fingerprint);
    const digest = await canonicalDigestV2(this.crypto, DISTRIBUTION_DOMAIN, v);
    ensure((await this.store.getInstalledDistribution(v.transactionId)) === null,
      'REPLAY', 'Distribution transaction already installed');
    let decrypted: Uint8Array | undefined;
    let key: Uint8Array | undefined;
    try {
      decrypted = await this.sessions.decrypt(v.encryptedPayload, input.context);
      const payload = decoded(decrypted);
      ensure(plainRecord(payload) && Object.keys(payload).sort().join('|') ===
        ['epoch','genesisDigest','groupId','key','kind','recipient','rosterDigest','transactionId','version'].sort().join('|') &&
        payload.kind === KEY_PACKAGE_KIND && payload.version === 2 &&
        payload.groupId === v.groupId && payload.transactionId === v.transactionId &&
        payload.epoch === v.committedEpoch && payload.rosterDigest === v.rosterDigest &&
        payload.genesisDigest === v.genesisDigest &&
        canonicalValue(payload.recipient) === canonicalValue(v.recipient) &&
        typeof payload.key === 'string',
        'CONFLICT', 'Decrypted key package differs from signed binding');
      key = fromBase64Url(payload.key as string, 32);
      await this.store.installEpoch(v.transactionId, digest, group, key);
    } finally {
      wipe(decrypted);
      wipe(key);
    }
    // Signature proves completion of LOCAL atomic installation, never RF write.
    return this.signInstalledAck(v, digest);
  }

  /**
   * A crash can occur AFTER atomic installation but BEFORE the ack is
   * signed or delivered. Re-validate the original signed distribution
   * against durable installed state and re-sign; never replay V1 AEAD.
   */
  async recoverInstalledAck(input: {distribution: BoundEpochDistributionV2;
    context: SecurityProtocolContext}): Promise<InstalledAckV2> {
    const v = input.distribution;
    const group = await this.loadVerifiedGroup(v.groupId);
    const digest = await canonicalDigestV2(this.crypto, DISTRIBUTION_DOMAIN, v);
    const stored = await this.store.getInstalledDistribution(v.transactionId);
    ensure(stored === digest && group.currentTransactionId === v.transactionId &&
      group.epoch === v.committedEpoch && group.rosterDigest === v.rosterDigest &&
      group.genesisDigest === v.genesisDigest,
      'NOT_INSTALLED', 'No exact matching durable installed transaction');
    ensure(v.aadDigest === await this.requireContext(group, input.context),
      'CONFLICT', 'Recovery AAD differs from signed distribution');
    const local = await this.identity.current();
    ensure(samePrincipal(principal(local), v.recipient), 'UNTRUSTED',
      'Recovery identity no longer matches installing recipient');
    const signer = await this.pinnedIdentity(v.sender);
    await this.checkSignature(signer, distributionTranscript(v), v.signature);
    const key = await this.store.getEpochKey(v.groupId, v.committedEpoch);
    ensure(key?.length === 32, 'KEY_MISSING', 'Installed epoch key missing');
    wipe(key);
    return this.signInstalledAck(v, digest);
  }

  private async signInstalledAck(v: BoundEpochDistributionV2,
    digest: string): Promise<InstalledAckV2> {
    const ack: InstalledAckV2 = {
      kind: 'bushmesh-v2-installed-ack', version: 2, transactionId: v.transactionId,
      groupId: v.groupId, committedEpoch: v.committedEpoch,
      rosterDigest: v.rosterDigest, distributionDigest: digest,
      recipient: v.recipient, issuedAt: this.clock.now(), signature: '',
    };
    return {...ack, signature: encodeSignature(await this.identity.sign(ackTranscript(ack)))};
  }

  async verifyInstalledAck(ack: InstalledAckV2, transactionRef: string): Promise<boolean> {
    ensure(ack.kind === 'bushmesh-v2-installed-ack' && ack.version === 2,
      'DOWNGRADE', 'Invalid installation acknowledgement version');
    const tx = await this.store.getTransaction(transactionRef);
    ensure(tx?.status === 'committed', 'NOT_COMMITTED', 'No committed transaction for ack');
    const group = await this.loadVerifiedGroup(tx.approval.proposal.groupId);
    ensure(group.currentTransactionId === transactionRef &&
      ack.transactionId === transactionRef && ack.groupId === group.groupId &&
      ack.committedEpoch === group.epoch &&
      ack.rosterDigest === group.rosterDigest,
      'STALE_EPOCH', 'Acknowledgement is for stale or different epoch');
    const member = group.roster.find(m => samePrincipal(m, ack.recipient) &&
      m.state !== 'revoked');
    ensure(!!member, 'UNTRUSTED', 'Acknowledging peer is no longer in the roster');
    const issued = tx.issuedDistributions[ack.recipient.deviceId] ?? [];
    ensure(issued.includes(ack.distributionDigest), 'REPLAY',
      'Acknowledgement is not bound to an issued signed distribution');
    ensure(Number.isSafeInteger(ack.issuedAt) &&
      ack.issuedAt <= this.clock.now() + MAX_CLOCK_SKEW_MS &&
      ack.issuedAt >= tx.preparedAt, 'INVALID_INPUT', 'Ack timestamp invalid');
    const signer = await this.pinnedIdentity(ack.recipient);
    await this.checkSignature(signer, ackTranscript(ack), ack.signature);
    const ackDigest = await canonicalDigestV2(this.crypto, ACK_DOMAIN, ack);
    return this.store.recordVerifiedReceipt(transactionRef, ack.recipient.deviceId, ackDigest);
  }

  /** Only exact epoch+receipt+current trust can authorize; draft roster alone cannot. */
  async resolveCurrentMembership(groupId: string, member: PrincipalV2):
    Promise<VerifiedMembershipV2> {
    let group: GroupSnapshotV2;
    try {
      group = await this.loadVerifiedGroup(groupId);
    } catch {
      return {authorized: false, epoch: null, reason: 'corrupt-or-rolled-back'};
    }
    const entry = group.roster.find(m => samePrincipal(m, member));
    if (!entry || entry.state === 'revoked') {
      return {authorized: false, epoch: group.epoch, reason: 'revoked'};
    }
    try {
      await this.pinnedIdentity(member);
    } catch {
      return {authorized: false, epoch: group.epoch, reason: 'untrusted-identity'};
    }
    const key = await this.store.getEpochKey(groupId, group.epoch);
    if (!key || key.length !== 32) {
      wipe(key ?? undefined);
      return {authorized: false, epoch: group.epoch, reason: 'not-installed'};
    }
    wipe(key);
    const owner = samePrincipal(member, principal(group.genesis.owner));
    if (owner && entry.state === 'active') {
      return {authorized: true, epoch: group.epoch, reason: 'verified-local-epoch'};
    }
    if (!group.currentTransactionId) {
      return {authorized: false, epoch: group.epoch, reason: 'pending'};
    }
    const receipt = await this.store.getVerifiedReceipt(group.currentTransactionId,
      member.deviceId);
    return receipt
      ? {authorized: true, epoch: group.epoch, reason: 'verified-local-epoch'}
      : {authorized: false, epoch: group.epoch, reason: 'missing-ack'};
  }

  /** Owner signature + authority-sequence CAS: stale role credentials cannot revive. */
  async applyRoleRevocation(proof: RoleRevocationV2): Promise<void> {
    ensure(proof.kind === 'bushmesh-v2-revoke-role' && proof.version === 2,
      'DOWNGRADE', 'Invalid role revocation version');
    const group = await this.loadVerifiedGroup(proof.groupId);
    const owner = principal(group.genesis.owner);
    ensure(samePrincipal(owner, proof.issuer) &&
      proof.nextAuthoritySequence === group.authoritySequence + 1 &&
      proof.expectedAuthoritySequence === group.authoritySequence &&
      Number.isSafeInteger(proof.issuedAt) &&
      proof.issuedAt <= this.clock.now() + MAX_CLOCK_SKEW_MS,
      'FORGED_AUTHORITY', 'Role revocation is not current and owner-authorized');
    await this.checkSignature(group.genesis.owner,
      roleRevocationTranscript(proof), proof.signature);
    await this.store.revokeCredential(proof.groupId, proof.expectedAuthoritySequence,
      proof.credentialId);
  }

  /** Owner-only local emergency invalidation: blocks all old epoch use. */
  async invalidateCurrentEpoch(groupId: string): Promise<void> {
    const group = await this.loadVerifiedGroup(groupId);
    const local = await this.identity.current();
    ensure(samePrincipal(principal(local), principal(group.genesis.owner)),
      'FORGED_AUTHORITY', 'Only local anchored owner may invalidate the epoch');
    await this.store.invalidateEpoch(groupId, group.epoch);
  }
}
