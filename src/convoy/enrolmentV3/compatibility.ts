import type {ConvoyMembershipService} from '../membership/ConvoyMembershipService';
import type {ConvoyMembershipSnapshot} from '../membership/model';
import type {ConvoySecurityV1Port, VerifiedLocalGroup} from '../membership/securityV1';
import type {AuthorizedConvoyDirectory} from '../../app/activeContext/operationalConvoy';
import type {
  EncryptedDirectMessage, GroupRecord, SecurityProtocolContext,
} from '../../security/types';
import {
  SECURE_ENROLMENT_V3_ACTIVATION, SecurityV2ContractUnavailable,
} from './contract';
import {
  JoinObservationV3, newJoinObservation, observeJoinEvent,
  reconcileJoinObservation,
} from './joinState';
import type {JoinObservationStore} from './joinStore';
import {planRemainingEpochRecipients} from './rosterPolicy';

export type ExistingConvoyMembershipV2Port = Pick<
  ConvoyMembershipService,
  'receiveJoinRequest' | 'approveJoinRequest' | 'rejectJoinRequest' |
  'listAdministration' | 'resolveAuthorized' |
  'subscribeInvalidations' | 'removeMember'
>;

export type ExistingConvoySecurityV1ReadPort = Pick<
  ConvoySecurityV1Port,
  'currentIdentity' | 'verifyLocalGroup' | 'assertTrustedPeer'
>;

export type SecureJoinReadinessV3 = {
  incrementalEnrolment: typeof SECURE_ENROLMENT_V3_ACTIVATION;
  readOnly: true;
  blockers: readonly string[];
};

export const secureJoinReadinessV3: SecureJoinReadinessV3 = {
  incrementalEnrolment: SECURE_ENROLMENT_V3_ACTIVATION,
  readOnly: true,
  blockers: [
    'No Security v2 atomic add-member/epoch-CAS/rollback-proof group API',
    'No anchored and revocable owner/admin role credential chain',
    'No verified, replay-safe Security v2 install acknowledgement',
    'No durable group-epoch monotonic high-water and distribution reconciliation',
    'No production authenticated control-wire activation or security review',
  ],
};

export type PendingJoinViewV3 = {
  requestId: string;
  convoyId: string;
  requesterDeviceId: string;
  requestedFingerprint: string;
  phase: JoinObservationV3['phase'] | 'unavailable';
  authenticatedBy: 'security-v1-direct-session' | 'unavailable';
  execution: typeof SECURE_ENROLMENT_V3_ACTIVATION;
  /** NEVER membership; only existing AuthorizedConvoyDirectory resolves it. */
  authorized: false;
};

/**
 * Narrow compatibility service, intentionally not an AuthorizedConvoyDirectory.
 *
 * Only the legacy v2 service is allowed to authenticate incoming direct
 * requests and to enforce owner/admin approval; journal observations cannot
 * replace Security v1 group-key proof or modify the v2 membership directory.
 */
export class SecureJoinCompatibilityV3 {
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly existing: ExistingConvoyMembershipV2Port,
    private readonly security: ExistingConvoySecurityV1ReadPort,
    private readonly journal: JoinObservationStore,
    private readonly now: () => number = Date.now,
  ) {}

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation);
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  subscribeInvalidations(listener: () => void): () => void {
    this.listeners.add(listener);
    const unsubscribe = this.existing.subscribeInvalidations(listener);
    return () => {
      unsubscribe();
      this.listeners.delete(listener);
    };
  }

  /** Staging must invoke after actual Security v1 trust, key or identity change. */
  notifySecurityInvalidation(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Observers cannot authorise or roll back Security v1 state.
      }
    }
  }

  async receiveAuthenticatedRequest(input: {
    envelope: EncryptedDirectMessage;
    context: SecurityProtocolContext;
    senderDeviceId: string;
    senderFingerprint: string;
  }): Promise<PendingJoinViewV3> {
    return this.exclusive(async () => {
      // Frozen direct-session AEAD verification and replay protection first.
      const result = await this.existing.receiveJoinRequest(input);
      return this.viewVerifiedRequest(result.id);
    });
  }

  async approvePendingRequest(requestId: string): Promise<PendingJoinViewV3> {
    return this.exclusive(async () => {
      // Frozen v2 service rechecks current local owner/admin authority and
      // trusted requested fingerprint. It cannot add the member.
      const approved = await this.existing.approveJoinRequest(requestId);
      return this.viewVerifiedRequest(approved.id);
    });
  }

  async rejectPendingRequest(requestId: string): Promise<PendingJoinViewV3> {
    return this.exclusive(async () => {
      const rejected = await this.existing.rejectJoinRequest(requestId);
      return this.viewVerifiedRequest(rejected.id);
    });
  }

  async restorePendingRequest(requestId: string): Promise<PendingJoinViewV3> {
    return this.exclusive(() => this.viewVerifiedRequest(requestId));
  }

  private async viewVerifiedRequest(requestId: string): Promise<PendingJoinViewV3> {
    const identity = await this.security.currentIdentity();
    const state: ConvoyMembershipSnapshot = await this.existing.listAdministration();
    const request = state.requests.find(value => value.id === requestId);
    if (!request) {
      return this.blockedView(requestId);
    }
    const entry = state.convoys.find(value => value.convoyId === request.convoyId);
    const verified: VerifiedLocalGroup | null = entry
      ? await this.security.verifyLocalGroup(entry.groupId) : null;
    const leader = verified?.group.members.find(m =>
      m.deviceId === identity.deviceId && m.identityFingerprint === identity.fingerprint &&
      m.role === 'leader' && m.state === 'active');
    if (!entry || !verified || !leader) {
      return this.blockedView(requestId);
    }
    const trustedRecord = await this.security.assertTrustedPeer(
      request.deviceId, request.fingerprint,
    ).catch(() => null);
    const trusted = trustedRecord !== null;
    const journal = await this.journal.load(identity.deviceId);
    let observation = journal.records.find(item => item.requestId === requestId);
    const expiry = request.createdAt + 600000;
    const clock = this.now();
    if (!observation && !trustedRecord) {
      return this.blockedView(requestId);
    }
    if (!observation && trustedRecord) {
      observation = newJoinObservation({
        requestId, convoyId: entry.convoyId, groupId: entry.groupId,
        requester: {deviceId: request.deviceId, fingerprint: request.fingerprint,
          keyEpoch: trustedRecord.identity.keyEpoch},
        expectedEpoch: verified.group.currentEpoch,
        createdAt: request.createdAt,
        expiresAt: expiry,
      });
    }
    // Request ID reuse, trust revocation or key epoch rotation never revives a
    // stored plan. No identity epoch is invented for diagnostics.
    if (!observation) {
      return this.blockedView(requestId);
    }
    if (observation.groupId !== entry.groupId ||
        observation.requester.deviceId !== request.deviceId ||
        observation.requester.fingerprint !== request.fingerprint ||
        observation.convoyId !== request.convoyId) {
      return this.blockedView(requestId);
    }
    if (trustedRecord && trustedRecord.identity.keyEpoch !== observation.requester.keyEpoch &&
        !['rejected', 'expired', 'blocked', 'needs-reconciliation'].includes(observation.phase)) {
      observation = observeJoinEvent(observation, {
        id: 'identity-rotated:' + requestId,
        kind: 'invalidate', atMs: Math.max(clock, observation.updatedAt),
        reason: 'identity-rotation',
      });
    }
    if (!trusted && !['rejected', 'expired', 'blocked', 'needs-reconciliation'].includes(observation.phase)) {
      observation = observeJoinEvent(observation, {
        id: 'trust-invalidated:' + requestId, kind: 'invalidate',
        atMs: Math.max(clock, observation.updatedAt), reason: 'revoke',
      });
    }
    if (trusted && observation.phase === 'authenticated-request-observed' &&
        request.state === 'approved-awaiting-security') {
      if (clock <= expiry) {
        observation = observeJoinEvent(observation, {
          id: 'v2-approved:' + requestId, kind: 'approve',
          atMs: Math.max(request.createdAt, clock),
        });
      }
    }
    if (observation.phase === 'authenticated-request-observed' &&
        request.state === 'rejected' && clock <= expiry) {
      observation = observeJoinEvent(observation, {
        id: 'v2-rejected:' + requestId, kind: 'reject',
        atMs: Math.max(request.createdAt, clock),
      });
    }
    if (clock >= expiry &&
        !['rejected', 'expired', 'blocked', 'needs-reconciliation'].includes(observation.phase)) {
      observation = observeJoinEvent(observation, {
        id: 'v2-expired:' + requestId, kind: 'timeout',
        atMs: Math.max(expiry, clock),
      });
    }
    observation = reconcileJoinObservation(observation, verified.group, identity.deviceId);
    const other = journal.records.filter(item => item.requestId !== requestId);
    await this.journal.save({...journal, records: [...other, observation]});
    return {
      requestId, convoyId: request.convoyId,
      requesterDeviceId: request.deviceId, requestedFingerprint: request.fingerprint,
      phase: observation.phase,
      authenticatedBy: trusted ? 'security-v1-direct-session' : 'unavailable',
      execution: SECURE_ENROLMENT_V3_ACTIVATION, authorized: false,
    };
  }

  private blockedView(requestId: string): PendingJoinViewV3 {
    return {
      requestId, convoyId: '', requesterDeviceId: '', requestedFingerprint: '',
      phase: 'unavailable', authenticatedBy: 'unavailable',
      execution: SECURE_ENROLMENT_V3_ACTIVATION, authorized: false,
    };
  }

  /**
   * The proposed Security v2 API MUST be independently implemented, audited,
   * reviewed and enabled in a future feature. Even passing a fake port cannot
   * override this compile-time-disabled boundary.
   */
  async executeIncrementalEnrolment(): Promise<never> {
    throw new SecurityV2ContractUnavailable();
  }

  async getKnownMemberAuthorization(
    convoyId: string,
    localIdentityRef: string,
  ): ReturnType<AuthorizedConvoyDirectory['resolveAuthorized']> {
    // Only existing live Security v1 checks may return authorised.
    return this.existing.resolveAuthorized(convoyId, localIdentityRef);
  }

  /**
   * Real v2 group revocation and rotation remain usable; returned recipients
   * are DISTRIBUTION OBLIGATIONS, not confirmations.
   */
  async revokeAndPlanRekey(
    convoyId: string,
    targetDeviceId: string,
  ): Promise<{localRekeyEpoch: number; pendingRecipientDeviceIds: string[]; globallyRevoked: false}> {
    return this.exclusive(async () => {
      const updated: GroupRecord = await this.existing.removeMember(convoyId, targetDeviceId);
      const local = await this.security.currentIdentity();
      const recipients = planRemainingEpochRecipients(updated, local.deviceId);
      this.notifySecurityInvalidation();
      return {
        localRekeyEpoch: updated.currentEpoch,
        pendingRecipientDeviceIds: recipients,
        globallyRevoked: false,
      };
    });
  }
}
