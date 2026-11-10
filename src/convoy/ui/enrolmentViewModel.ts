import type {AuthorizedConvoyMembership} from '../../app/activeContext/operationalConvoy';
import {checkedMembership} from '../../app/activeContext/operationalConvoy';
import type {ActiveConvoyMember} from '../membership/ConvoyMembershipService';
import type {
  ConvoyInvitation,
  ConvoyJoinRequest,
  ConvoyMembershipSnapshot,
  ConvoyRole,
} from '../membership/model';
import {canAdminister} from '../membership/model';
import {
  secureJoinReadinessV3,
  type PendingJoinViewV3,
} from '../enrolmentV3';
import type {DeviceIdentity} from '../../security/types';

/** Public identity fields only; private handles and signing secrets never enter the UI. */
export type EnrolmentPublicIdentity = Pick<
  DeviceIdentity, 'deviceId' | 'fingerprint' | 'keyEpoch'
>;

export type VerifiedRosterView = {
  convoyId: string;
  localIdentityRef: string;
  membershipRecordRef: string;
  members: readonly ActiveConvoyMember[];
};

export type ReceivedInvitationReview = {
  /** Must be supplied only by a verified Security v1 direct-session receiver. */
  authenticatedBy: 'security-v1-direct-session';
  invitation: ConvoyInvitation;
};

export type EnrolmentUiInput = {
  nowMs: number;
  localIdentity: EnrolmentPublicIdentity | null;
  productionSecurityReady: boolean;
  transportReady: boolean;
  state: 'loading' | 'ready' | 'error';
  error: string | null;
  /** From the existing live authorisation directory, not a carrier channel. */
  selectableConvoys: readonly AuthorizedConvoyMembership[];
  selectedConvoy: AuthorizedConvoyMembership | null;
  /** Freshly resolved by ConvoyMembershipService.resolveAuthorized. */
  verifiedSelection: AuthorizedConvoyMembership | null;
  /** Returned by listMembers only after verifying current local membership. */
  roster: VerifiedRosterView | null;
  administration: ConvoyMembershipSnapshot | null;
  pendingJoinViews: readonly PendingJoinViewV3[];
  receivedInvitations: readonly ReceivedInvitationReview[];
};

export type EnrolmentUiMember = {
  deviceId: string;
  fingerprint: string;
  role: ConvoyRole;
  securityRole: 'leader' | 'member';
  status: 'verified-active' | 'revoked';
  position: 'live' | 'recent' | 'stale' | 'disconnected';
  positionLabel: string;
  isSelf: boolean;
  mayRemove: boolean;
};

export type EnrolmentUiInvitation = ConvoyInvitation & {
  displayState: 'pending' | 'expired' | 'cancelled';
  mayCancel: boolean;
  /** No invitation is a membership credential, even if delivered. */
  grantsAccess: false;
};

export type EnrolmentUiRequest = ConvoyJoinRequest & {
  displayState:
    | 'pending-approval'
    | 'pending-security-enrolment'
    | 'rejected'
    | 'expired'
    | 'blocked';
  mayApprove: boolean;
  mayReject: boolean;
  diagnostic: string;
  grantsAccess: false;
};

export type EnrolmentUiReceivedInvitation = ReceivedInvitationReview & {
  displayState: 'review' | 'expired' | 'wrong-identity';
  canRequestJoin: boolean;
};

export type EnrolmentUiView = {
  identity: EnrolmentPublicIdentity | null;
  headerState:
    | 'unavailable'
    | 'no-identity'
    | 'loading'
    | 'select-convoy'
    | 'verified-membership'
    | 'revoked-or-rotated';
  headerTitle: string;
  headerDescription: string;
  canCreate: boolean;
  canInvite: boolean;
  canReviewRequests: boolean;
  canPrepareJoinRequest: boolean;
  blockers: readonly string[];
  localRole: ConvoyRole | null;
  selected: AuthorizedConvoyMembership | null;
  authorizedConvoys: readonly AuthorizedConvoyMembership[];
  verifiedMemberCount: number | null;
  members: readonly EnrolmentUiMember[];
  invitations: readonly EnrolmentUiInvitation[];
  requests: readonly EnrolmentUiRequest[];
  receivedInvitations: readonly EnrolmentUiReceivedInvitation[];
  transportLabel: string;
  securityLabel: string;
  sourceState: 'loading' | 'ready' | 'error';
  diagnostic: string | null;
};

const REQUEST_WINDOW_MS = 600_000;

function ref(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

function currentTime(time: number): boolean {
  return Number.isSafeInteger(time) && time > 0;
}

/**
 * Pure view projection. Requests, invitations and V3 observations are NEVER
 * promoted into membership. The only success proof is a separately and freshly
 * resolved Security v1 directory record with a matching epoch reference.
 */
export function deriveEnrolmentUi(input: EnrolmentUiInput): EnrolmentUiView {
  const identity = input.localIdentity &&
    ref(input.localIdentity.deviceId) &&
    ref(input.localIdentity.fingerprint) &&
    Number.isSafeInteger(input.localIdentity.keyEpoch) &&
    input.localIdentity.keyEpoch > 0
    ? input.localIdentity : null;
  const ready = input.productionSecurityReady && !!identity;
  const authorized = identity
    ? input.selectableConvoys.map(item =>
        checkedMembership(item, null, identity.deviceId),
      ).filter((item): item is AuthorizedConvoyMembership => item !== null)
    : [];
  const selection = ready && identity && input.selectedConvoy
    ? checkedMembership(
        input.verifiedSelection, input.selectedConvoy.convoyId,
        identity.deviceId,
      )
    : null;
  const selected = selection &&
    input.selectedConvoy?.membershipRecordRef === selection.membershipRecordRef
    ? selection : null;
  const restoredInvalid = !!input.selectedConvoy && !selected &&
    input.state !== 'loading';
  const rosterReady = selected && !!input.roster &&
    input.roster.convoyId === selected.convoyId &&
    input.roster.localIdentityRef === selected.localIdentityRef &&
    input.roster.membershipRecordRef === selected.membershipRecordRef;
  const members = rosterReady && input.roster ? input.roster.members : [];
  const self = identity && members.find(member =>
    member.deviceId === identity.deviceId &&
    member.identityFingerprint === identity.fingerprint &&
    member.state === 'active'
  );
  const localRole: ConvoyRole | null = self?.role ?? null;
  const admin = !!ready && !!selected && !!self &&
    self.securityGroupRole === 'leader' &&
    (localRole === 'owner' || localRole === 'admin');
  const scopedAdmin = !!admin && input.administration !== null;
  const canReview = scopedAdmin &&
    canAdminister(localRole as ConvoyRole, 'review-request');
  const canInvite = scopedAdmin &&
    canAdminister(localRole as ConvoyRole, 'invite');

  const normalizedMembers: EnrolmentUiMember[] = members
    .filter(member => ref(member.deviceId) && ref(member.identityFingerprint))
    .map(member => {
      const validPosition = member.state === 'active' &&
        ['live', 'recent', 'stale'].includes(member.presence);
      const position = validPosition ? member.presence : 'disconnected';
      const isSelf = member.deviceId === identity?.deviceId;
      return {
        deviceId: member.deviceId,
        fingerprint: member.identityFingerprint,
        role: member.role,
        securityRole: member.securityGroupRole,
        status: member.state === 'active'
          ? 'verified-active' as const : 'revoked' as const,
        position,
        positionLabel: position === 'disconnected'
          ? 'No current authenticated position'
          : position === 'live' ? 'Fresh authenticated position'
          : position === 'recent' ? 'Position aging'
          : 'Stale position — last known only',
        isSelf,
        mayRemove: !!admin && !isSelf && member.state === 'active' &&
          canAdminister(localRole as ConvoyRole, 'remove-member', member.role),
      };
    });

  // The metadata store is scoped only by convoy ID; never make an unverified
  // registry entry appear in the selectable authorised convoy list.
  const invitations: EnrolmentUiInvitation[] =
    selected && input.administration
      ? input.administration.invitations
          .filter(item => item.convoyId === selected.convoyId)
          .map(item => ({
            ...item,
            displayState: item.state === 'pending' &&
              currentTime(input.nowMs) && item.expiresAt <= input.nowMs
              ? 'expired' as const : item.state,
            mayCancel: canInvite && item.state === 'pending' &&
              item.expiresAt > input.nowMs,
            grantsAccess: false as const,
          }))
      : [];

  const requests: EnrolmentUiRequest[] =
    selected && input.administration
      ? input.administration.requests
          .filter(item => item.convoyId === selected.convoyId)
          .map(item => {
            const observation = input.pendingJoinViews.find(view =>
              view.requestId === item.id &&
              view.convoyId === selected.convoyId &&
              view.requesterDeviceId === item.deviceId &&
              view.requestedFingerprint === item.fingerprint
            );
            const expired = currentTime(input.nowMs) &&
              item.createdAt + REQUEST_WINDOW_MS <= input.nowMs;
            let displayState: EnrolmentUiRequest['displayState'] =
              item.state === 'rejected' ? 'rejected'
              : expired ? 'expired'
              : item.state === 'approved-awaiting-security'
                ? 'pending-security-enrolment' : 'pending-approval';
            if (observation?.phase === 'blocked' ||
                observation?.phase === 'needs-reconciliation' ||
                observation?.phase === 'unavailable') {
              displayState = 'blocked';
            } else if (observation?.phase === 'rejected') {
              displayState = 'rejected';
            } else if (observation?.phase === 'expired') {
              displayState = 'expired';
            }
            return {
              ...item,
              displayState,
              mayApprove: !!canReview && displayState === 'pending-approval',
              mayReject: !!canReview && displayState === 'pending-approval',
              diagnostic: displayState === 'pending-security-enrolment'
                ? 'Admin approval recorded; Security v2 add-member transaction is NOT available.'
                : displayState === 'pending-approval'
                  ? 'Authenticated request pending owner/admin review. No group access.'
                  : displayState === 'blocked'
                    ? 'Trust, epoch or identity must be reverified.'
                    : displayState === 'expired'
                      ? 'Request validity window has passed; new authenticated request required.'
                      : 'Request rejected; no membership granted.',
              grantsAccess: false as const,
            };
          })
      : [];

  const receivedInvitations: EnrolmentUiReceivedInvitation[] =
    identity && input.state === 'ready'
      ? input.receivedInvitations.map(value => {
          const match = value.invitation.recipientDeviceId === identity.deviceId &&
            value.invitation.recipientFingerprint === identity.fingerprint;
          const expired = value.invitation.state !== 'pending' ||
            value.invitation.expiresAt <= input.nowMs;
          return {
            ...value,
            displayState: !match ? 'wrong-identity' as const
              : expired ? 'expired' as const : 'review' as const,
            canRequestJoin: !!ready && !!input.transportReady &&
              match && !expired &&
              value.authenticatedBy === 'security-v1-direct-session',
          };
        })
      : [];

  let headerState: EnrolmentUiView['headerState'] = 'select-convoy';
  let headerTitle = 'No verified convoy selected';
  let headerDescription = 'Only Security v1 authorised convoys appear here.';
  if (!identity) {
    headerState = 'no-identity';
    headerTitle = 'Authenticated identity unavailable';
    headerDescription = 'Connect a supported production Security identity before managing membership.';
  } else if (!input.productionSecurityReady) {
    headerState = 'unavailable';
    headerTitle = 'Production security unavailable';
    headerDescription = 'Security v1 test identities and MeshCore contacts are not production membership proof.';
  } else if (input.state === 'loading') {
    headerState = 'loading';
    headerTitle = 'Verifying convoy membership';
    headerDescription = 'Protected Security state is being rechecked. No access is assumed.';
  } else if (restoredInvalid) {
    headerState = 'revoked-or-rotated';
    headerTitle = 'Convoy access not verified';
    headerDescription = 'Revocation, identity rotation or group epoch change may have invalidated the previous selection.';
  } else if (selected) {
    headerState = 'verified-membership';
    headerTitle = selected.displayName;
    headerDescription = 'Active membership verified by the Security v1 directory for the current identity and epoch.';
  }

  const unavailable = [
    ...(!identity ? ['No authenticated local Security identity.'] : []),
    ...(!input.productionSecurityReady ?
      ['Production secure-store/cryptographic provider is not confirmed.'] : []),
    ...(!input.transportReady ?
      ['Authenticated direct-session transport is unavailable.'] : []),
    ...secureJoinReadinessV3.blockers,
  ];
  return {
    identity, headerState, headerTitle, headerDescription,
    canCreate: ready && input.state === 'ready',
    canInvite: !!canInvite && input.state === 'ready',
    canReviewRequests: !!canReview && input.state === 'ready',
    canPrepareJoinRequest: receivedInvitations.some(item => item.canRequestJoin),
    blockers: unavailable,
    localRole,
    selected,
    authorizedConvoys: authorized,
    verifiedMemberCount: rosterReady ? normalizedMembers
      .filter(member => member.status === 'verified-active').length : null,
    members: normalizedMembers,
    invitations, requests, receivedInvitations,
    transportLabel: input.transportReady
      ? 'Authenticated transport reported available (delivery unconfirmed)'
      : 'Authenticated transport unavailable — no invitations or join requests sent',
    securityLabel: input.productionSecurityReady
      ? 'Security v1 provider reported ready; incremental Security v2 joining disabled'
      : 'Production Security v1 provider not ready',
    sourceState: input.state,
    diagnostic: input.error,
  };
}
