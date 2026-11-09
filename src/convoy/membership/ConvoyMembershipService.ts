import {Buffer} from 'buffer';
import type {AuthorizedConvoyDirectory, AuthorizedConvoyMembership} from '../../app/activeContext/operationalConvoy';
import type {
  EncryptedDirectMessage,
  EncryptedGroupMessage,
  GroupRecord,
  SecurityProtocolContext,
  WrappedGroupKeyDistribution,
} from '../../security/types';
import {
  ConvoyAdminOperation,
  ConvoyInvitation,
  ConvoyJoinRequest,
  ConvoyMembershipError,
  ConvoyMembershipSnapshot,
  ConvoyRegistryEntry,
  ConvoyRole,
  ConvoyMemberPresence,
  assertGroupId,
  assertMemberId,
  assertName,
  canAdminister,
  presenceFromLastSeen,
} from './model';
import type {ConvoySecurityV1Port, VerifiedLocalGroup} from './securityV1';
import type {ConvoyMembershipStore} from './store';

type AuthenticatedJoinWireV1 = {
  kind: 'bushmesh-convoy-join-request-v1';
  id: string;
  convoyId: string;
  deviceId: string;
  fingerprint: string;
  createdAt: number;
};

export type ActiveConvoyMember = {
  deviceId: string;
  identityFingerprint: string;
  role: ConvoyRole;
  securityGroupRole: 'leader' | 'member';
  state: 'active' | 'revoked';
  presence: ConvoyMemberPresence;
};

export type DecryptedAuthorizedPosition = {
  convoyId: string;
  senderDeviceId: string;
  /** Already authenticated by GroupKeyManager.decrypt(). Must be parsed as a canonical Location frame. */
  plaintext: Uint8Array;
};

export class ConvoyMembershipService implements AuthorizedConvoyDirectory {
  private readonly listeners = new Set<() => void>();
  private readonly positionSeenAt = new Map<string, number>();
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly security: ConvoySecurityV1Port,
    private readonly store: ConvoyMembershipStore,
    private readonly clock: () => number = Date.now,
  ) {}

  private mutate<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.pending.then(work);
    this.pending = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private notify(): void {
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch {
        // Observers cannot roll back completed Security v1 state transitions.
      }
    });
  }

  subscribeInvalidations(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Integration must call on security trust/rotation/group-key invalidations.
   * There is no Security v1 subscription callback in the frozen public API.
   */
  notifySecurityInvalidation(): void {
    this.positionSeenAt.clear();
    this.notify();
  }

  private requireConvoy(state: ConvoyMembershipSnapshot, convoyId: string): ConvoyRegistryEntry {
    const entry = state.convoys.find(value => value.convoyId === convoyId);
    if (!entry) {
      throw new ConvoyMembershipError('NOT_FOUND', 'Unknown convoy');
    }
    return entry;
  }

  private roleFor(
    entry: ConvoyRegistryEntry,
    group: GroupRecord,
    deviceId: string,
    state: ConvoyMembershipSnapshot,
  ): ConvoyRole {
    const member = group.members.find(value =>
      value.deviceId === deviceId && value.state === 'active',
    );
    if (!member) {
      return 'member';
    }
    // Group 'leader' alone is not proof of app ownership or a local admin grant.
    if (member.role === 'leader' && entry.ownerDeviceId === deviceId) {
      return 'owner';
    }
    if (member.role === 'leader' && state.adminGrants.some(value =>
      value.convoyId === entry.convoyId && value.deviceId === deviceId &&
      value.grantedByDeviceId === entry.ownerDeviceId,
    )) {
      return 'admin';
    }
    return 'member';
  }

  private async requireAdministrator(
    state: ConvoyMembershipSnapshot,
    convoyId: string,
    operation: ConvoyAdminOperation,
    target: ConvoyRole = 'member',
  ): Promise<{entry: ConvoyRegistryEntry; verified: VerifiedLocalGroup; role: ConvoyRole}> {
    const entry = this.requireConvoy(state, convoyId);
    const verified = await this.security.verifyLocalGroup(entry.groupId);
    if (!verified) {
      throw new ConvoyMembershipError('UNAUTHORISED', 'Security v1 has not verified local membership');
    }
    const local = verified.group.members.find(value =>
      value.deviceId === verified.identity.deviceId &&
      value.identityFingerprint === verified.identity.fingerprint &&
      value.state === 'active',
    );
    const role = this.roleFor(entry, verified.group, verified.identity.deviceId, state);
    if (!local || local.role !== 'leader' || !canAdminister(role, operation, target)) {
      throw new ConvoyMembershipError('UNAUTHORISED', 'Insufficient authenticated convoy administration role');
    }
    return {entry, verified, role};
  }

  /**
   * Creation invokes the real GroupKeyManager.createGroup() with the local
   * identity as initial leader. No MeshCore provisioning occurs here.
   */
  createConvoy(name: string, foundingMembers: readonly {deviceId: string; fingerprint: string}[] = []): Promise<ConvoyRegistryEntry> {
    return this.mutate(async () => {
      assertName(name);
      const state = await this.store.load();
      const identity = await this.security.currentIdentity();
      const convoyId = this.security.generateReference('bmc1_');
      const groupId = 'bmg1_' + convoyId.slice('bmc1_'.length);
      assertGroupId(groupId);
      if (state.convoys.some(value => value.convoyId === convoyId || value.groupId === groupId)) {
        throw new ConvoyMembershipError('CONFLICT', 'Convoy already exists');
      }
      if (foundingMembers.length > 32 ||
        new Set(foundingMembers.map(value => value.deviceId)).size !== foundingMembers.length) {
        throw new ConvoyMembershipError('INVALID_INPUT', 'Invalid or duplicate founding members');
      }
      for (const peer of foundingMembers) {
        assertMemberId(peer.deviceId, 'founding member ID');
        assertMemberId(peer.fingerprint, 'founding fingerprint');
        if (peer.deviceId === identity.deviceId) {
          throw new ConvoyMembershipError('INVALID_INPUT', 'Local owner cannot be a founding peer');
        }
        await this.security.assertTrustedPeer(peer.deviceId, peer.fingerprint);
      }
      await this.security.createOwnerGroup(groupId, foundingMembers.map(value => value.deviceId));
      const verified = await this.security.verifyLocalGroup(groupId);
      const leader = verified?.group.members.find(value =>
        value.deviceId === identity.deviceId &&
        value.identityFingerprint === identity.fingerprint &&
        value.role === 'leader' && value.state === 'active',
      );
      if (!verified || !leader || foundingMembers.some(peer => !verified.group.members.some(member =>
        member.deviceId === peer.deviceId &&
        member.identityFingerprint === peer.fingerprint &&
        member.role === 'member' && member.state === 'active',
      ))) {
        throw new ConvoyMembershipError('SECURITY_UNAVAILABLE', 'Security v1 group creation was not verified');
      }
      const entry: ConvoyRegistryEntry = {
        convoyId,
        groupId,
        displayName: name.trim(),
        ownerDeviceId: identity.deviceId,
        createdAt: this.clock(),
      };
      await this.store.save({...state, convoys: [...state.convoys, entry]});
      this.notify();
      return entry;
    });
  }

  /**
   * Real enrolment on a recipient uses Security v1's AEAD-protected group-key
   * distribution and trust checks. An invite or approval by itself never calls
   * this method and never becomes an authorised membership.
   */
  installEnrolment(input: {
    convoyId: string;
    displayName: string;
    distribution: WrappedGroupKeyDistribution;
    context: SecurityProtocolContext;
  }): Promise<ConvoyRegistryEntry> {
    return this.mutate(async () => {
      assertMemberId(input.convoyId, 'convoy ID');
      assertName(input.displayName);
      assertGroupId(input.distribution.groupId);
      const state = await this.store.load();
      const previous = state.convoys.find(value => value.convoyId === input.convoyId);
      if (previous && previous.groupId !== input.distribution.groupId) {
        throw new ConvoyMembershipError('CONFLICT', 'Convoy/group binding has changed');
      }
      if (state.convoys.some(value =>
        value.groupId === input.distribution.groupId && value.convoyId !== input.convoyId,
      )) {
        throw new ConvoyMembershipError('CONFLICT', 'Group is already assigned to a different convoy');
      }
      const installed = await this.security.installAuthenticatedDistribution(
        input.distribution, input.context,
      );
      if (installed.groupId !== input.distribution.groupId) {
        throw new ConvoyMembershipError('SECURITY_UNAVAILABLE', 'Authenticated group ID mismatch');
      }
      const verified = await this.security.verifyLocalGroup(installed.groupId);
      if (!verified) {
        throw new ConvoyMembershipError('SECURITY_UNAVAILABLE', 'Local group enrolment was not verified');
      }
      // Without an authenticated application owner-role proof the sender is
      // NOT automatically the owner. An imported peer remains an app member.
      const entry: ConvoyRegistryEntry = previous ?? {
        convoyId: input.convoyId,
        groupId: installed.groupId,
        displayName: input.displayName.trim(),
        ownerDeviceId: null,
        createdAt: installed.createdAt,
      };
      if (!previous) {
        await this.store.save({...state, convoys: [...state.convoys, entry]});
      }
      this.notify();
      return entry;
    });
  }

  /**
   * Actual Security v1 protected group-key distribution for a peer that was
   * ALREADY added to a Security v1 group (e.g. at initial group creation).
   * Does not itself add or approve a new member.
   */
  async wrapEnrolmentForMember(input: {
    convoyId: string;
    recipientDeviceId: string;
    sessionId: string;
    context: SecurityProtocolContext;
  }): Promise<WrappedGroupKeyDistribution> {
    assertMemberId(input.recipientDeviceId, 'recipient device ID');
    assertMemberId(input.sessionId, 'direct session ID');
    const state = await this.store.load();
    const {entry, verified} = await this.requireAdministrator(
      state, input.convoyId, 'invite',
    );
    const member = verified.group.members.find(value =>
      value.deviceId === input.recipientDeviceId && value.state === 'active',
    );
    if (!member) {
      throw new ConvoyMembershipError('MISSING_SECURITY_CONTRACT', 'No Security v1 member enrolment for this recipient');
    }
    await this.security.assertTrustedPeer(member.deviceId, member.identityFingerprint);
    return this.security.wrapKeyForPeer(
      entry.groupId, member.deviceId, input.sessionId, input.context,
    );
  }

  async resolveAuthorized(
    convoyId: string,
    localIdentityRef: string,
  ): Promise<AuthorizedConvoyMembership | null> {
    assertMemberId(convoyId, 'convoy ID');
    assertMemberId(localIdentityRef, 'local identity reference');
    const state = await this.store.load();
    const entry = state.convoys.find(value => value.convoyId === convoyId);
    if (!entry) {
      return null;
    }
    const verified = await this.security.verifyLocalGroup(entry.groupId);
    if (!verified || verified.identity.deviceId !== localIdentityRef) {
      return null;
    }
    const member = verified.group.members.find(value =>
      value.deviceId === localIdentityRef && value.identityFingerprint === verified.identity.fingerprint &&
      value.state === 'active',
    );
    if (!member) {
      return null;
    }
    return {
      convoyId: entry.convoyId,
      displayName: entry.displayName,
      localIdentityRef,
      authorizationState: 'authorized',
      verifiedBy: 'security-v1',
      membershipRecordRef: 'security-v1:' + entry.groupId + ':' + verified.group.currentEpoch,
    };
  }

  async listAuthorized(localIdentityRef: string): Promise<readonly AuthorizedConvoyMembership[]> {
    assertMemberId(localIdentityRef, 'local identity reference');
    const state = await this.store.load();
    const result: AuthorizedConvoyMembership[] = [];
    for (const entry of state.convoys) {
      const membership = await this.resolveAuthorized(entry.convoyId, localIdentityRef);
      if (membership) {
        result.push(membership);
      }
    }
    return result;
  }

  async listAdministration(): Promise<ConvoyMembershipSnapshot> {
    // Expiry is derived at read time; invitations never grant membership.
    const state = await this.store.load();
    const now = this.clock();
    return {...state, invitations: state.invitations.map(value =>
      value.state === 'pending' && value.expiresAt <= now
        ? {...value, state: 'expired' as const} : value,
    )};
  }

  invite(input: {
    convoyId: string;
    recipientDeviceId: string;
    recipientFingerprint: string;
    expiresAt: number;
  }): Promise<ConvoyInvitation> {
    return this.mutate(async () => {
      assertMemberId(input.recipientDeviceId, 'recipient device ID');
      assertMemberId(input.recipientFingerprint, 'recipient fingerprint');
      const state = await this.store.load();
      const {verified} = await this.requireAdministrator(state, input.convoyId, 'invite');
      const now = this.clock();
      if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now ||
        input.expiresAt - now > 7 * 24 * 60 * 60 * 1000) {
        throw new ConvoyMembershipError('INVALID_INPUT', 'Invite expiration must be within seven days');
      }
      if (input.recipientDeviceId === verified.identity.deviceId) {
        throw new ConvoyMembershipError('INVALID_INPUT', 'Cannot invite local identity');
      }
      await this.security.assertTrustedPeer(input.recipientDeviceId, input.recipientFingerprint);
      const existing = verified.group.members.find(value =>
        value.deviceId === input.recipientDeviceId && value.state === 'active',
      );
      if (existing) {
        throw new ConvoyMembershipError('CONFLICT', 'Peer is already a group member');
      }
      const previous = state.invitations.find(value =>
        value.convoyId === input.convoyId &&
        value.recipientDeviceId === input.recipientDeviceId &&
        value.recipientFingerprint === input.recipientFingerprint &&
        value.state === 'pending' && value.expiresAt > now,
      );
      if (previous) {
        return previous;
      }
      const invitation: ConvoyInvitation = {
        id: this.security.generateReference('bmi1_'),
        convoyId: input.convoyId,
        recipientDeviceId: input.recipientDeviceId,
        recipientFingerprint: input.recipientFingerprint,
        createdAt: now,
        expiresAt: input.expiresAt,
        state: 'pending',
      };
      await this.store.save({...state, invitations: [...state.invitations, invitation]});
      this.notify();
      // This is ONLY local invitation metadata. Delivery must use authenticated
      // direct-session traffic, not a public or MeshCore-carrier invite.
      return invitation;
    });
  }

  cancelInvitation(invitationId: string): Promise<void> {
    return this.mutate(async () => {
      assertMemberId(invitationId, 'invitation ID');
      const state = await this.store.load();
      const invitation = state.invitations.find(value => value.id === invitationId);
      if (!invitation) {
        throw new ConvoyMembershipError('NOT_FOUND', 'Unknown invitation');
      }
      await this.requireAdministrator(state, invitation.convoyId, 'invite');
      if (invitation.state === 'cancelled') {
        return;
      }
      await this.store.save({...state, invitations: state.invitations.map(value =>
        value.id === invitationId ? {...value, state: 'cancelled' as const} : value,
      )});
      this.notify();
    });
  }

  /**
   * Incoming request is accepted ONLY after Security v1 direct-session AEAD
   * decrypt, peer fingerprint binding, and replay checks. No claimed peer ID
   * from unprotected packet metadata is trusted.
   */
  receiveJoinRequest(input: {
    envelope: EncryptedDirectMessage;
    context: SecurityProtocolContext;
    senderDeviceId: string;
    senderFingerprint: string;
  }): Promise<ConvoyJoinRequest> {
    return this.mutate(async () => {
      assertMemberId(input.senderDeviceId, 'sender device ID');
      assertMemberId(input.senderFingerprint, 'sender fingerprint');
      const plaintext = await this.security.decryptAuthenticatedJoin(
        input.envelope, input.context, input.senderDeviceId, input.senderFingerprint,
      );
      let wire: unknown;
      try {
        if (plaintext.length > 2048) {
          throw new ConvoyMembershipError('INVALID_INPUT', 'Oversized join request');
        }
        wire = JSON.parse(Buffer.from(plaintext).toString('utf8'));
      } finally {
        plaintext.fill(0);
      }
      if (!wire || typeof wire !== 'object' || Array.isArray(wire)) {
        throw new ConvoyMembershipError('INVALID_INPUT', 'Malformed authenticated join request');
      }
      const request = wire as Partial<AuthenticatedJoinWireV1>;
      if (Object.keys(request).sort().join('|') !==
          ['kind', 'id', 'convoyId', 'deviceId', 'fingerprint', 'createdAt'].sort().join('|') ||
        request.kind !== 'bushmesh-convoy-join-request-v1' ||
        request.deviceId !== input.senderDeviceId ||
        request.fingerprint !== input.senderFingerprint) {
        throw new ConvoyMembershipError('UNAUTHORISED', 'Join request sender identity mismatch');
      }
      assertMemberId(request.id, 'request ID');
      assertMemberId(request.convoyId, 'convoy ID');
      const now = this.clock();
      if (!Number.isSafeInteger(request.createdAt) ||
        (request.createdAt as number) > now + 5000 ||
        now - (request.createdAt as number) > 10 * 60 * 1000) {
        throw new ConvoyMembershipError('INVALID_INPUT', 'Join request is outside its validity window');
      }
      const state = await this.store.load();
      await this.requireAdministrator(state, request.convoyId, 'review-request');
      const existing = state.requests.find(value => value.id === request.id);
      if (existing) {
        if (existing.convoyId !== request.convoyId ||
          existing.deviceId !== request.deviceId ||
          existing.fingerprint !== request.fingerprint ||
          existing.createdAt !== request.createdAt) {
          throw new ConvoyMembershipError('CONFLICT', 'Reused join request ID with different contents');
        }
        return existing;
      }
      const entry: ConvoyJoinRequest = {
        id: request.id, convoyId: request.convoyId,
        deviceId: request.deviceId, fingerprint: request.fingerprint,
        createdAt: request.createdAt as number, state: 'pending',
      };
      await this.store.save({...state, requests: [...state.requests, entry]});
      this.notify();
      return entry;
    });
  }

  approveJoinRequest(requestId: string): Promise<ConvoyJoinRequest> {
    return this.mutate(async () => {
      assertMemberId(requestId, 'request ID');
      const state = await this.store.load();
      const request = state.requests.find(value => value.id === requestId);
      if (!request) {
        throw new ConvoyMembershipError('NOT_FOUND', 'Unknown join request');
      }
      await this.requireAdministrator(state, request.convoyId, 'review-request');
      if (request.state === 'rejected') {
        throw new ConvoyMembershipError('CONFLICT', 'Rejected join request cannot be approved');
      }
      await this.security.assertTrustedPeer(request.deviceId, request.fingerprint);
      if (request.state === 'approved-awaiting-security') {
        return request;
      }
      const approved: ConvoyJoinRequest = {...request, state: 'approved-awaiting-security'};
      await this.store.save({...state, requests: state.requests.map(value =>
        value.id === requestId ? approved : value,
      )});
      this.notify();
      // Security v1 has no addMember()/authenticated admin-control contract.
      // Approved status explicitly DOES NOT add a member or grant a group key.
      return approved;
    });
  }

  rejectJoinRequest(requestId: string): Promise<ConvoyJoinRequest> {
    return this.mutate(async () => {
      assertMemberId(requestId, 'request ID');
      const state = await this.store.load();
      const request = state.requests.find(value => value.id === requestId);
      if (!request) {
        throw new ConvoyMembershipError('NOT_FOUND', 'Unknown join request');
      }
      await this.requireAdministrator(state, request.convoyId, 'review-request');
      if (request.state === 'approved-awaiting-security') {
        throw new ConvoyMembershipError('CONFLICT', 'Approved request requires explicit security cancellation');
      }
      if (request.state === 'rejected') {
        return request;
      }
      const rejected: ConvoyJoinRequest = {...request, state: 'rejected'};
      await this.store.save({...state, requests: state.requests.map(value =>
        value.id === requestId ? rejected : value,
      )});
      this.notify();
      return rejected;
    });
  }

  /**
   * Only a verified owner can grant a LOCAL admin designation to an existing
   * Security v1 group leader. It is NOT an authenticated remote admin grant;
   * no missing signed-role-distribution protocol is invented.
   */
  grantLocalAdmin(convoyId: string, targetDeviceId: string): Promise<void> {
    return this.mutate(async () => {
      assertMemberId(targetDeviceId, 'target device ID');
      const state = await this.store.load();
      const {entry, verified, role} = await this.requireAdministrator(
        state, convoyId, 'grant-admin',
      );
      if (role !== 'owner') {
        throw new ConvoyMembershipError('UNAUTHORISED', 'Only an owner may grant local admin');
      }
      const target = verified.group.members.find(value => value.deviceId === targetDeviceId);
      if (!target || target.state !== 'active' || target.role !== 'leader' ||
        targetDeviceId === entry.ownerDeviceId) {
        throw new ConvoyMembershipError('MISSING_SECURITY_CONTRACT', 'Admin requires an existing Security v1 group leader');
      }
      await this.security.assertTrustedPeer(targetDeviceId, target.identityFingerprint);
      if (state.adminGrants.some(value => value.convoyId === convoyId && value.deviceId === targetDeviceId)) {
        return;
      }
      await this.store.save({...state, adminGrants: [...state.adminGrants, {
        convoyId, deviceId: targetDeviceId, grantedByDeviceId: verified.identity.deviceId,
      }]});
      this.notify();
    });
  }

  /**
   * Security v1 revokeMember() retires the member AND rotates the group key.
   * Refuse removal of owner, self, or the last group leader. Other peers must
   * receive the new epoch via Security v1 protected key distribution.
   */
  removeMember(convoyId: string, targetDeviceId: string): Promise<GroupRecord> {
    return this.mutate(async () => {
      assertMemberId(targetDeviceId, 'target device ID');
      const state = await this.store.load();
      const entry = this.requireConvoy(state, convoyId);
      const verified = await this.security.verifyLocalGroup(entry.groupId);
      if (!verified) {
        throw new ConvoyMembershipError('UNAUTHORISED', 'No authenticated local convoy membership');
      }
      const target = verified.group.members.find(value => value.deviceId === targetDeviceId && value.state === 'active');
      if (!target || targetDeviceId === verified.identity.deviceId ||
        targetDeviceId === entry.ownerDeviceId) {
        throw new ConvoyMembershipError('UNAUTHORISED', 'Cannot remove unknown, local or owner member');
      }
      const targetRole = this.roleFor(entry, verified.group, targetDeviceId, state);
      await this.requireAdministrator(state, convoyId, 'remove-member', targetRole);
      if (target.role === 'leader' && !verified.group.members.some(value =>
        value.deviceId !== targetDeviceId && value.state === 'active' && value.role === 'leader',
      )) {
        throw new ConvoyMembershipError('UNAUTHORISED', 'Cannot remove the last group leader');
      }
      let updated: GroupRecord;
      try {
        updated = await this.security.revokeGroupMember(entry.groupId, targetDeviceId);
      } finally {
        // Security may have committed revocation before a storage/rotation
        // failure. Never keep a stale UI authorization cache.
        this.notifySecurityInvalidation();
      }
      if (updated.currentEpoch <= verified.group.currentEpoch ||
        updated.members.find(value => value.deviceId === targetDeviceId)?.state !== 'revoked') {
        throw new ConvoyMembershipError('SECURITY_UNAVAILABLE', 'Security v1 did not confirm revocation and rekey');
      }
      await this.store.save({
        ...state,
        adminGrants: state.adminGrants.filter(value =>
          value.convoyId !== convoyId || value.deviceId !== targetDeviceId,
        ),
        invitations: state.invitations.map(value =>
          value.convoyId === convoyId && value.recipientDeviceId === targetDeviceId
            ? {...value, state: 'cancelled' as const} : value,
        ),
      });
      this.notify();
      return updated;
    });
  }

  async listMembers(convoyId: string): Promise<readonly ActiveConvoyMember[]> {
    const state = await this.store.load();
    const entry = this.requireConvoy(state, convoyId);
    const verified = await this.security.verifyLocalGroup(entry.groupId);
    if (!verified) {
      return [];
    }
    const now = this.clock();
    const results: ActiveConvoyMember[] = [];
    for (const member of verified.group.members) {
      let trusted = member.deviceId === verified.identity.deviceId;
      if (!trusted && member.state === 'active') {
        trusted = await this.security.assertTrustedPeer(
          member.deviceId, member.identityFingerprint,
        ).then(() => true, () => false);
      }
      const active = member.state === 'active' && trusted;
      results.push({
        deviceId: member.deviceId,
        identityFingerprint: member.identityFingerprint,
        role: active ? this.roleFor(entry, verified.group, member.deviceId, state) : 'member',
        securityGroupRole: member.role,
        state: active ? 'active' : 'revoked',
        presence: active
          ? presenceFromLastSeen(this.positionSeenAt.get(convoyId + ':' + member.deviceId) ?? null, now)
          : 'disconnected',
      });
    }
    return results;
  }

  /**
   * ONLY expose decrypted location bytes after Security v1 group AEAD
   * authentication and a second live membership/epoch check (avoids a revoke
   * race). Integration must establish that canonical protocol AAD identifies a
   * Location frame and decode/validate the plaintext before using coordinates.
   */
  async decryptAuthorizedPosition(input: {
    convoyId: string;
    envelope: EncryptedGroupMessage;
    context: SecurityProtocolContext;
  }): Promise<DecryptedAuthorizedPosition | null> {
    assertMemberId(input.convoyId, 'convoy ID');
    const state = await this.store.load();
    const entry = state.convoys.find(value => value.convoyId === input.convoyId);
    if (!entry || entry.groupId !== input.envelope.groupId) {
      return null;
    }
    const before = await this.security.verifyLocalGroup(entry.groupId);
    const sender = before?.group.members.find(value =>
      value.deviceId === input.envelope.senderDeviceId && value.state === 'active',
    );
    if (!before || !sender || before.group.currentEpoch !== input.envelope.epoch ||
      !input.context.authenticatedHeader || !input.context.authenticatedHeader.length) {
      return null;
    }
    const plaintext = await this.security.decryptAuthenticatedPosition(
      input.envelope, input.context,
    );
    const after = await this.security.verifyLocalGroup(entry.groupId);
    const current = after?.group.members.find(value =>
      value.deviceId === sender.deviceId && value.identityFingerprint === sender.identityFingerprint &&
      value.state === 'active',
    );
    if (!after || !current || after.group.currentEpoch !== input.envelope.epoch ||
      after.identity.fingerprint !== before.identity.fingerprint) {
      plaintext.fill(0);
      return null;
    }
    if (sender.deviceId !== after.identity.deviceId) {
      const stillTrusted = await this.security.assertTrustedPeer(
        sender.deviceId, sender.identityFingerprint,
      ).then(() => true, () => false);
      if (!stillTrusted) {
        plaintext.fill(0);
        return null;
      }
    }
    this.positionSeenAt.set(input.convoyId + ':' + sender.deviceId, this.clock());
    return {convoyId: input.convoyId, senderDeviceId: sender.deviceId, plaintext};
  }
}

/** Wire payload serializer for an already-established authenticated direct
 * session. This function does NOT encrypt or transmit; the caller must use
 * Security v1 DirectSessionManager.encrypt with canonical protocol AAD.
 */
export function encodeJoinRequestPayload(request: {
  id: string;
  convoyId: string;
  deviceId: string;
  fingerprint: string;
  createdAt: number;
}): Uint8Array {
  assertMemberId(request.id, 'request ID');
  assertMemberId(request.convoyId, 'convoy ID');
  assertMemberId(request.deviceId, 'device ID');
  assertMemberId(request.fingerprint, 'fingerprint');
  if (!Number.isSafeInteger(request.createdAt) || request.createdAt <= 0) {
    throw new ConvoyMembershipError('INVALID_INPUT', 'Invalid request timestamp');
  }
  const value: AuthenticatedJoinWireV1 = {kind: 'bushmesh-convoy-join-request-v1', ...request};
  return new Uint8Array(Buffer.from(JSON.stringify(value), 'utf8'));
}
