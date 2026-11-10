import {useCallback, useEffect, useRef, useState} from 'react';
import {checkedMembership} from '../../app/activeContext/operationalConvoy';
import {useActiveOperationalConvoy} from '../../app/activeContext/ActiveOperationalConvoyContext';
import type {ConvoyMembershipService} from '../membership/ConvoyMembershipService';
import type {ConvoySecurityV1Port} from '../membership/securityV1';
import type {ConvoyInvitation, ConvoyMembershipSnapshot} from '../membership/model';
import type {PendingJoinViewV3} from '../enrolmentV3';
import {
  deriveEnrolmentUi,
  type EnrolmentPublicIdentity,
  type EnrolmentUiInput,
  type EnrolmentUiView,
  type ReceivedInvitationReview,
  type VerifiedRosterView,
} from './enrolmentViewModel';

/** Real service, never a duplicate membership/security implementation. */
export type ConvoyEnrolmentUiService = Pick<
  ConvoyMembershipService,
  'createConvoy' | 'invite' | 'cancelInvitation' |
  'approveJoinRequest' | 'rejectJoinRequest' | 'removeMember' |
  'listAdministration' | 'listMembers' | 'resolveAuthorized' |
  'subscribeInvalidations'
>;

export type ConvoyEnrolmentUiDependencies = {
  /** Defaults to null: no functional actions or invented local identity. */
  service?: ConvoyEnrolmentUiService | null;
  identityProvider?: Pick<ConvoySecurityV1Port, 'currentIdentity'> | null;
  /** Integration must attest a persistent production-grade Security v1 provider. */
  productionSecurityReady?: boolean;
  /** Authenticated DIRECT transport, never MeshCore carrier connectivity. */
  authenticatedTransportReady?: boolean;
  /** Verified direct-session delivery pipeline owned by integration. */
  onSubmitAuthenticatedJoinRequest?: (
    invitation: ConvoyInvitation,
  ) => Promise<void>;
  /** Supplied by trusted Security v1 direct-session ingestion only. */
  receivedInvitations?: readonly ReceivedInvitationReview[];
  /** Read-only observations from SecureJoinCompatibilityV3; never authority. */
  pendingJoinViews?: readonly PendingJoinViewV3[];
};

export type ConvoyEnrolmentUiActions = {
  view: EnrolmentUiView;
  busy: boolean;
  notice: string | null;
  refresh: () => Promise<void>;
  create: (name: string) => Promise<boolean>;
  select: (convoyId: string) => Promise<boolean>;
  prepareInvite: (
    recipientDeviceId: string, recipientFingerprint: string, expiresAtMs: number,
  ) => Promise<boolean>;
  cancelInvite: (invitationId: string) => Promise<boolean>;
  approve: (requestId: string) => Promise<boolean>;
  reject: (requestId: string) => Promise<boolean>;
  remove: (deviceId: string) => Promise<boolean>;
  requestJoin: (invitationId: string) => Promise<boolean>;
};

function message(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Operation could not be verified by the Security provider.';
}

type LoadedSnapshot = {
  identity: EnrolmentPublicIdentity | null;
  administration: ConvoyMembershipSnapshot | null;
  verifiedSelection: EnrolmentUiInput['verifiedSelection'];
  roster: VerifiedRosterView | null;
  state: 'loading' | 'ready' | 'error';
  error: string | null;
};

const EMPTY: LoadedSnapshot = {
  identity: null, administration: null, verifiedSelection: null,
  roster: null, state: 'loading', error: null,
};

export function useConvoyEnrolmentUi({
  service = null,
  identityProvider = null,
  productionSecurityReady = false,
  authenticatedTransportReady = false,
  onSubmitAuthenticatedJoinRequest,
  receivedInvitations = [],
  pendingJoinViews = [],
}: ConvoyEnrolmentUiDependencies = {}): ConvoyEnrolmentUiActions {
  const active = useActiveOperationalConvoy();
  const [loaded, setLoaded] = useState<LoadedSnapshot>(EMPTY);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const generation = useRef(0);
  const working = useRef(false);
  const identityRef = active.localIdentityRef;
  const selectionId = active.activeConvoy?.convoyId ?? null;
  const selectionRecord = active.activeConvoy?.membershipRecordRef ?? null;

  const refresh = useCallback(async () => {
    const token = ++generation.current;
    // Fail closed immediately on revocation, identity change or restart.
    setLoaded({...EMPTY});
    try {
      if (!productionSecurityReady || !identityProvider || !service || !identityRef) {
        if (token === generation.current) {
          setLoaded({...EMPTY, state: 'ready'});
        }
        return;
      }
      const identity = await identityProvider.currentIdentity();
      if (identity.deviceId !== identityRef) {
        throw new Error('Active radio identity does not match authenticated Security identity.');
      }
      const administration = await service.listAdministration();
      let verifiedSelection: EnrolmentUiInput['verifiedSelection'] = null;
      let roster: VerifiedRosterView | null = null;
      if (selectionId !== null) {
        const current = checkedMembership(
          await service.resolveAuthorized(selectionId, identity.deviceId),
          selectionId,
          identity.deviceId,
        );
        if (current && current.membershipRecordRef === selectionRecord) {
          const members = await service.listMembers(selectionId);
          // Recheck after reading roster to close a revoke/epoch transition race.
          const later = checkedMembership(
            await service.resolveAuthorized(selectionId, identity.deviceId),
            selectionId,
            identity.deviceId,
          );
          if (later && later.membershipRecordRef === current.membershipRecordRef) {
            verifiedSelection = later;
            roster = {
              convoyId: selectionId,
              localIdentityRef: identity.deviceId,
              membershipRecordRef: later.membershipRecordRef,
              members,
            };
          }
        }
      }
      if (token === generation.current) {
        setLoaded({
          identity: {
            deviceId: identity.deviceId,
            fingerprint: identity.fingerprint,
            keyEpoch: identity.keyEpoch,
          },
          administration, verifiedSelection, roster,
          state: 'ready', error: null,
        });
      }
    } catch (error) {
      if (token === generation.current) {
        setLoaded({...EMPTY, state: 'error', error: message(error)});
      }
    }
  }, [
    productionSecurityReady, identityProvider, service,
    identityRef, selectionId, selectionRecord,
  ]);

  useEffect(() => {
    refresh().catch(() => undefined);
    return () => {generation.current += 1;};
  }, [refresh]);

  useEffect(() => {
    if (!service) return;
    return service.subscribeInvalidations(() => {
      // The active provider separately rechecks the directory; this layer
      // never writes its own membership state.
      refresh().catch(() => undefined);
    });
  }, [service, refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const view = deriveEnrolmentUi({
    nowMs,
    localIdentity: loaded.identity,
    productionSecurityReady,
    transportReady: authenticatedTransportReady,
    state: loaded.state,
    error: loaded.error,
    selectedConvoy: active.activeConvoy,
    verifiedSelection: loaded.verifiedSelection,
    selectableConvoys: active.selectableConvoys,
    roster: loaded.roster,
    administration: loaded.administration,
    receivedInvitations,
    pendingJoinViews,
  });

  const transact = useCallback(async (
    operation: () => Promise<string>,
  ): Promise<boolean> => {
    if (working.current || !service || !identityProvider ||
      !productionSecurityReady || !identityRef) {
      setNotice('Production Security v1 and authenticated identity are required.');
      return false;
    }
    working.current = true;
    setBusy(true);
    setNotice(null);
    ++generation.current;
    setLoaded({...EMPTY});
    try {
      const identity = await identityProvider.currentIdentity();
      if (identity.deviceId !== identityRef) {
        throw new Error('Security identity rotated or changed; refresh before continuing.');
      }
      const result = await operation();
      setNotice(result);
      return true;
    } catch (error) {
      setNotice(message(error));
      return false;
    } finally {
      working.current = false;
      setBusy(false);
      refresh().catch(() => undefined);
    }
  }, [service, identityProvider, productionSecurityReady, identityRef, refresh]);

  const requireCurrentSelection = useCallback(async (
    operation: 'invite' | 'review-request' | 'remove-member',
    targetDeviceId?: string,
  ) => {
    if (!service || !loaded.identity || !view.selected || !loaded.roster) {
      throw new Error('A freshly verified local convoy membership is required.');
    }
    const current = checkedMembership(
      await service.resolveAuthorized(view.selected.convoyId, loaded.identity.deviceId),
      view.selected.convoyId,
      loaded.identity.deviceId,
    );
    if (!current || current.membershipRecordRef !== view.selected.membershipRecordRef) {
      throw new Error('Convoy membership changed; reload before administering.');
    }
    const actor = loaded.roster.members.find(item =>
      item.deviceId === loaded.identity?.deviceId &&
      item.identityFingerprint === loaded.identity?.fingerprint &&
      item.state === 'active');
    if (!actor || actor.securityGroupRole !== 'leader' ||
      !['owner', 'admin'].includes(actor.role)) {
      throw new Error('Current verified owner/admin authority required.');
    }
    if (operation === 'remove-member') {
      const target = loaded.roster.members.find(item =>
        item.deviceId === targetDeviceId && item.state === 'active',
      );
      if (!target || target.deviceId === actor.deviceId) {
        throw new Error('Cannot remove the local identity or an unknown member.');
      }
      // Service independently verifies the same policy and performs revocation.
    }
    return current;
  }, [service, loaded.identity, loaded.roster, view.selected]);

  const create = (name: string): Promise<boolean> =>
    transact(async () => {
      if (!service || !view.canCreate) throw new Error('Creation unavailable.');
      const created = await service.createConvoy(name.trim(), []);
      await active.refresh();
      const selected = await active.selectConvoy(created.convoyId);
      return selected
        ? 'Security v1 convoy created and verified locally; selected for this session.'
        : 'Security v1 create returned. Active membership selection still needs independent verification.';
    });

  const select = (convoyId: string): Promise<boolean> =>
    transact(async () => {
      const success = await active.selectConvoy(convoyId);
      if (!success) throw new Error('No live Security-authorised membership for this convoy.');
      return 'Active convoy independently checked by the Security directory.';
    });

  const prepareInvite = (
    recipientDeviceId: string, recipientFingerprint: string, expiresAtMs: number,
  ): Promise<boolean> =>
    transact(async () => {
      if (!service || !view.canInvite || !view.selected) {
        throw new Error('Verified owner/admin invite authority unavailable.');
      }
      await requireCurrentSelection('invite');
      const invitation = await service.invite({
        convoyId: view.selected.convoyId,
        recipientDeviceId, recipientFingerprint, expiresAt: expiresAtMs,
      });
      return 'Invitation ' + invitation.id +
        ' prepared as local metadata only. Authenticated delivery is NOT confirmed.';
    });

  const cancelInvite = (invitationId: string): Promise<boolean> =>
    transact(async () => {
      if (!service || !view.canInvite ||
        !view.invitations.some(item => item.id === invitationId && item.mayCancel)) {
        throw new Error('Invitation cancellation is unavailable.');
      }
      await requireCurrentSelection('invite');
      await service.cancelInvitation(invitationId);
      return 'Invitation metadata cancelled. This does not revoke group keys.';
    });

  const approve = (requestId: string): Promise<boolean> =>
    transact(async () => {
      if (!service || !view.canReviewRequests ||
        !view.requests.some(item => item.id === requestId && item.mayApprove)) {
        throw new Error('Request cannot be approved in its current state.');
      }
      await requireCurrentSelection('review-request');
      const result = await service.approveJoinRequest(requestId);
      if (result.state !== 'approved-awaiting-security') {
        throw new Error('Security service did not confirm the pending approval state.');
      }
      return 'Admin approval recorded — SECURITY ENROLMENT PENDING. No member added.';
    });

  const reject = (requestId: string): Promise<boolean> =>
    transact(async () => {
      if (!service || !view.canReviewRequests ||
        !view.requests.some(item => item.id === requestId && item.mayReject)) {
        throw new Error('Request cannot be rejected in its current state.');
      }
      await requireCurrentSelection('review-request');
      const result = await service.rejectJoinRequest(requestId);
      if (result.state !== 'rejected') throw new Error('Rejection not confirmed.');
      return 'Authenticated join request rejected. No membership created.';
    });

  const remove = (deviceId: string): Promise<boolean> =>
    transact(async () => {
      if (!service || !view.selected ||
        !view.members.some(item => item.deviceId === deviceId && item.mayRemove)) {
        throw new Error('Removal requires a verified owner/admin and removable member.');
      }
      await requireCurrentSelection('remove-member', deviceId);
      await service.removeMember(view.selected.convoyId, deviceId);
      await active.refresh();
      return 'Local Security v1 revocation/rekey confirmed. Remaining members still need new epoch distribution; global revocation is NOT confirmed.';
    });

  const requestJoin = (invitationId: string): Promise<boolean> =>
    transact(async () => {
      const candidate = view.receivedInvitations.find(item =>
        item.invitation.id === invitationId && item.canRequestJoin);
      if (!candidate || !onSubmitAuthenticatedJoinRequest ||
        !authenticatedTransportReady) {
        throw new Error('Authenticated direct-session join-request delivery is unavailable.');
      }
      await onSubmitAuthenticatedJoinRequest(candidate.invitation);
      return 'Join request submitted to authenticated transport. Approval and Security v2 enrolment remain pending; no group access.';
    });

  return {
    view, busy, notice, refresh,
    create, select, prepareInvite, cancelInvite, approve,
    reject, remove, requestJoin,
  };
}
