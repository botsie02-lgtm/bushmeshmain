import {
  deriveEnrolmentUi,
  type EnrolmentUiInput,
  type VerifiedRosterView,
} from '../enrolmentViewModel';
import {
  emptyConvoyMembershipSnapshot,
  type ConvoyInvitation,
  type ConvoyJoinRequest,
} from '../../membership/model';
import type {AuthorizedConvoyMembership} from '../../../app/activeContext/operationalConvoy';
import {SECURE_ENROLMENT_V3_ACTIVATION} from '../../enrolmentV3';

const NOW = 1800000000000;
const ID = 'bm1_local-device';
const FP = 'public-fingerprint-local';
const CONVOY = 'bmc1_abcdef1234567890';
const RECORD = 'security-v1:bmg1_abcdef1234567890:2';

const verified: AuthorizedConvoyMembership = {
  convoyId: CONVOY,
  displayName: 'Verified Field Convoy',
  localIdentityRef: ID,
  authorizationState: 'authorized',
  verifiedBy: 'security-v1',
  membershipRecordRef: RECORD,
};

function roster(): VerifiedRosterView {
  return {
    convoyId: CONVOY, localIdentityRef: ID, membershipRecordRef: RECORD,
    members: [
      {
        deviceId: ID, identityFingerprint: FP,
        role: 'owner', securityGroupRole: 'leader',
        state: 'active', presence: 'live',
      },
      {
        deviceId: 'bm1_peerA', identityFingerprint: 'public-fingerprint-peerA',
        role: 'member', securityGroupRole: 'member',
        state: 'active', presence: 'stale',
      },
      {
        deviceId: 'bm1_peerB', identityFingerprint: 'public-fingerprint-peerB',
        role: 'member', securityGroupRole: 'member',
        state: 'active', presence: 'disconnected',
      },
      {
        deviceId: 'bm1_old', identityFingerprint: 'public-fingerprint-old',
        role: 'member', securityGroupRole: 'member',
        state: 'revoked', presence: 'disconnected',
      },
    ],
  };
}

const request: ConvoyJoinRequest = {
  id: 'bmr1_request123', convoyId: CONVOY, deviceId: 'bm1_applicant',
  fingerprint: 'public-fingerprint-applicant', createdAt: NOW - 1000,
  state: 'pending',
};
const invitation: ConvoyInvitation = {
  id: 'bmi1_invite123', convoyId: CONVOY,
  recipientDeviceId: 'bm1_peerC',
  recipientFingerprint: 'public-fingerprint-peerC',
  createdAt: NOW - 5000, expiresAt: NOW + 50000, state: 'pending',
};

function input(overrides: Partial<EnrolmentUiInput> = {}): EnrolmentUiInput {
  return {
    nowMs: NOW,
    localIdentity: {deviceId: ID, fingerprint: FP, keyEpoch: 2},
    productionSecurityReady: true,
    transportReady: true,
    state: 'ready', error: null,
    selectableConvoys: [verified],
    selectedConvoy: verified,
    verifiedSelection: verified,
    roster: roster(),
    administration: {
      ...emptyConvoyMembershipSnapshot(),
      convoys: [{
        convoyId: CONVOY, groupId: 'bmg1_abcdef1234567890',
        displayName: 'Verified Field Convoy', ownerDeviceId: ID, createdAt: NOW - 100000,
      }],
      invitations: [invitation],
      requests: [request],
    },
    receivedInvitations: [],
    pendingJoinViews: [],
    ...overrides,
  };
}

describe('secure convoy enrolment view projection', () => {
  test('no authenticated identity is fail-closed', () => {
    const result = deriveEnrolmentUi(input({
      localIdentity: null,
      selectedConvoy: null, verifiedSelection: null,
      selectableConvoys: [],
    }));
    expect(result.headerState).toBe('no-identity');
    expect(result.identity).toBeNull();
    expect(result.canCreate).toBe(false);
    expect(result.canInvite).toBe(false);
    expect(result.members).toEqual([]);
    expect(result.authorizedConvoys).toEqual([]);
    expect(result.blockers.join(' ')).toContain('No authenticated');
  });

  test('no production security provider disables operations and membership claims', () => {
    const result = deriveEnrolmentUi(input({productionSecurityReady: false}));
    expect(result.headerState).toBe('unavailable');
    expect(result.selected).toBeNull();
    expect(result.canCreate).toBe(false);
    expect(result.canReviewRequests).toBe(false);
    expect(result.verifiedMemberCount).toBeNull();
    expect(result.securityLabel).toContain('not ready');
  });

  test('verified selected membership is separate from public MeshCore carrier data', () => {
    const result = deriveEnrolmentUi(input());
    expect(result.headerState).toBe('verified-membership');
    expect(result.selected?.convoyId).toBe(CONVOY);
    expect(result.localRole).toBe('owner');
    expect(result.verifiedMemberCount).toBe(3); // includes authenticated self
    expect(result.members).toHaveLength(4);
    expect(result.members.find(m => m.deviceId === 'bm1_peerA')?.position).toBe('stale');
    expect(result.members.find(m => m.deviceId === 'bm1_peerB')?.positionLabel)
      .toContain('No current');
    expect(result.members.find(m => m.deviceId === 'bm1_old')?.status).toBe('revoked');
    expect(result.members.find(m => m.deviceId === 'bm1_old')?.mayRemove).toBe(false);
  });

  test('missing verified selection or roster never creates member count', () => {
    const unverified = deriveEnrolmentUi(input({
      verifiedSelection: null, roster: roster(),
    }));
    expect(unverified.headerState).toBe('revoked-or-rotated');
    expect(unverified.members).toEqual([]);
    expect(unverified.verifiedMemberCount).toBeNull();
    expect(unverified.canInvite).toBe(false);
    const missingRoster = deriveEnrolmentUi(input({roster: null}));
    expect(missingRoster.headerState).toBe('verified-membership');
    expect(missingRoster.verifiedMemberCount).toBeNull();
    expect(missingRoster.canReviewRequests).toBe(false);
  });

  test('invitation expiration overrides a stored pending state', () => {
    const result = deriveEnrolmentUi(input({nowMs: NOW + 60000}));
    expect(result.invitations[0].displayState).toBe('expired');
    expect(result.invitations[0].mayCancel).toBe(false);
    expect(result.invitations[0].grantsAccess).toBe(false);
  });

  test('authenticated request is pending, never verified access', () => {
    const result = deriveEnrolmentUi(input());
    expect(result.requests[0].displayState).toBe('pending-approval');
    expect(result.requests[0].mayApprove).toBe(true);
    expect(result.requests[0].grantsAccess).toBe(false);
  });

  test('admin approval and ACK observation never mean membership', () => {
    const state = input();
    state.administration!.requests[0] = {
      ...request, state: 'approved-awaiting-security',
    };
    const result = deriveEnrolmentUi(state);
    expect(result.requests[0].displayState).toBe('pending-security-enrolment');
    expect(result.requests[0].diagnostic).toContain('NOT available');
    expect(result.requests[0].grantsAccess).toBe(false);
    expect(result.requests[0].mayApprove).toBe(false);

    const ack = deriveEnrolmentUi(input({
      pendingJoinViews: [{
        requestId: request.id, convoyId: CONVOY,
        requesterDeviceId: request.deviceId,
        requestedFingerprint: request.fingerprint,
        phase: 'ack-observed-unverified',
        authenticatedBy: 'security-v1-direct-session',
        execution: SECURE_ENROLMENT_V3_ACTIVATION,
        authorized: false,
      }],
      administration: {
        ...state.administration!,
      },
    }));
    expect(ack.requests[0].grantsAccess).toBe(false);
    expect(ack.requests[0].displayState).toBe('pending-security-enrolment');
  });

  test('rejected/blocked/expired requests never expose approval', () => {
    const rejected = deriveEnrolmentUi(input({
      administration: {
        ...input().administration!,
        requests: [{...request, state: 'rejected'}],
      },
    }));
    expect(rejected.requests[0].displayState).toBe('rejected');
    expect(rejected.requests[0].mayApprove).toBe(false);

    const expired = deriveEnrolmentUi(input({nowMs: NOW + 601000}));
    expect(expired.requests[0].displayState).toBe('expired');
    expect(expired.requests[0].mayApprove).toBe(false);

    const blocked = deriveEnrolmentUi(input({
      pendingJoinViews: [{
        requestId: request.id, convoyId: CONVOY,
        requesterDeviceId: request.deviceId,
        requestedFingerprint: request.fingerprint,
        phase: 'needs-reconciliation',
        authenticatedBy: 'unavailable',
        execution: SECURE_ENROLMENT_V3_ACTIVATION,
        authorized: false,
      }],
    }));
    expect(blocked.requests[0].displayState).toBe('blocked');
    expect(blocked.requests[0].mayApprove).toBe(false);
  });

  test('revocation and identity rotation invalidate restored selection', () => {
    const revoked = deriveEnrolmentUi(input({
      verifiedSelection: null,
    }));
    expect(revoked.selected).toBeNull();
    expect(revoked.headerState).toBe('revoked-or-rotated');
    expect(revoked.invitations).toEqual([]);
    expect(revoked.requests).toEqual([]);

    const rotated = deriveEnrolmentUi(input({
      localIdentity: {deviceId: ID, fingerprint: 'rotated-fingerprint', keyEpoch: 3},
      roster: roster(),
    }));
    expect(rotated.localRole).toBeNull();
    expect(rotated.headerState).toBe('revoked-or-rotated');
    expect(rotated.selected).toBeNull();
    expect(rotated.members).toEqual([]);
    expect(rotated.canInvite).toBe(false);
    expect(rotated.canReviewRequests).toBe(false);
  });

  test('epoch mismatch on restart never restores a previously verified roster', () => {
    const oldRecord = {...verified, membershipRecordRef: 'security-v1:group:1'};
    const output = deriveEnrolmentUi(input({
      selectedConvoy: oldRecord,
      verifiedSelection: verified,
      roster: roster(),
    }));
    expect(output.headerState).toBe('revoked-or-rotated');
    expect(output.verifiedMemberCount).toBeNull();
    expect(output.members).toEqual([]);
  });

  test('owner/admin/member roles have distinct action permissions', () => {
    const owner = deriveEnrolmentUi(input());
    expect(owner.canInvite).toBe(true);
    expect(owner.canReviewRequests).toBe(true);
    expect(owner.members.find(m => m.deviceId === 'bm1_peerA')?.mayRemove).toBe(true);
    expect(owner.members.find(m => m.deviceId === ID)?.mayRemove).toBe(false);

    const adminRoster = roster();
    adminRoster.members = adminRoster.members.map(member => member.deviceId === ID
      ? {...member, role: 'admin'} : member);
    const admin = deriveEnrolmentUi(input({roster: adminRoster}));
    expect(admin.canInvite).toBe(true);
    expect(admin.members.find(m => m.deviceId === 'bm1_peerA')?.mayRemove).toBe(true);

    const memberRoster = roster();
    memberRoster.members = memberRoster.members.map(member => member.deviceId === ID
      ? {...member, role: 'member', securityGroupRole: 'member'} : member);
    const member = deriveEnrolmentUi(input({roster: memberRoster}));
    expect(member.canInvite).toBe(false);
    expect(member.canReviewRequests).toBe(false);
    expect(member.members.some(m => m.mayRemove)).toBe(false);
  });

  test('authenticated direct transport outage blocks a reviewable incoming join request', () => {
    const incoming: ConvoyInvitation = {
      ...invitation, recipientDeviceId: ID, recipientFingerprint: FP,
    };
    const missingTransport = deriveEnrolmentUi(input({
      receivedInvitations: [{
        authenticatedBy: 'security-v1-direct-session', invitation: incoming,
      }],
      transportReady: false,
    }));
    expect(missingTransport.receivedInvitations[0].displayState).toBe('review');
    expect(missingTransport.receivedInvitations[0].canRequestJoin).toBe(false);
    expect(missingTransport.transportLabel).toContain('unavailable');
    const available = deriveEnrolmentUi(input({
      receivedInvitations: [{
        authenticatedBy: 'security-v1-direct-session', invitation: incoming,
      }],
    }));
    expect(available.receivedInvitations[0].canRequestJoin).toBe(true);
    const wrongRecipient = deriveEnrolmentUi(input({
      receivedInvitations: [{
        authenticatedBy: 'security-v1-direct-session',
        invitation: {...incoming, recipientFingerprint: 'other-fingerprint'},
      }],
    }));
    expect(wrongRecipient.receivedInvitations[0].displayState).toBe('wrong-identity');
  });
});
