# Secure convoy enrolment UI v1 — staging integration handoff

Source ownership: **src/convoy/ui/** only (plus its own tests). This
feature does not edit App.tsx, AppShell.tsx, ConvoyScreen, Drive, BLE, radio,
native GPS, Security v1, Protocol v1 or the Security v2 proposal. Do not merge
directly into main.

## Why the UI is deliberately fail-closed

The existing ConvoyMembershipService provides Security v1-backed creation,
authenticated invitation metadata, authenticated join-request intake,
owner/admin role checks, and local member revocation. It does **not** implement
incremental add-member or atomic group-key/roster transactions.

The reviewed but **disabled** Security v2 proposal is in
src/convoy/enrolmentV3/contract.ts. Its constant
SECURE_ENROLMENT_V3_ACTIVATION = disabled-pending-security-v2-review. No
join request, local approval, observed ACK, transport acceptance, public
MeshCore contact, carrier channel or invitation becomes group membership.

This UI has no crypto, group-key mutation, secret transport or radio-send
implementation. Its default props require **explicit production integration**.
Without a real persistent Security v1 identity and secure-store service, it
shows Security unavailable and disables create/invite/admin actions. The
proposed Security v2 incremental joining remains blocked even after Security
v1 creation works.

## Public component entry points

Import from src/convoy/ui/index.ts:

- **ConnectedConvoyEnrolment** — drop-in host for the existing Convoy tab.
  It calls useConvoyEnrolmentUi with the injected Security v1 service and
  identity provider, and renders ConvoyEnrolmentScreen.
- **ConvoyEnrolmentScreen** — pure presentation and controlled form/confirmation
  state. It requires EnrolmentUiView, busy, notice and callbacks for
  onCreate(name), onSelect(convoyId),
  onPrepareInvite(deviceId,fingerprint,expiresAt),
  onCancelInvite(id), onApprove(id), onReject(id), onRemoveMember(deviceId),
  onRequestJoin(invitationId), onRefresh(). Optional navigation:
  onOpenDrive(), onOpenMap(). It never imports a transport or security manager.
- **deriveEnrolmentUi(input)** — deterministic pure view projection. Input:
  current public Security v1 identity, nowMs, production security/transport
  readiness, independently resolved authorised active convoy, epoch-bound
  verified roster, administration metadata, optional V3 pending observations,
  and authenticated directly received invitation review records.
- **useConvoyEnrolmentUi(deps)** — headless hook exposing view, busy, notice
  and the commands above. Each operation delegates to the existing
  ConvoyMembershipService. Administrative calls always re-resolve local
  membership; the service itself rechecks the live Security v1 role/epoch.

### Exact five-tab staging host

Mount beneath the existing AppProviders and ActiveOperationalConvoyProvider:

    <ConnectedConvoyEnrolment
      service={productionConvoyMembershipService}
      identityProvider={productionSecurityV1Adapter}
      productionSecurityReady={actualPlatformBackedSecurityReady}
      authenticatedTransportReady={authenticatedDirectSessionReady}
      receivedInvitations={authenticatedIncomingInvitationReviews}
      pendingJoinViews={readOnlyV3JoinObservations}
      onSubmitAuthenticatedJoinRequest={sendOverExistingSecureDirectSession}
      onOpenDrive={showDriveTab}
      onOpenMap={showRealConvoyMap}
    />

These identifiers are integration placeholders, NOT runtime globals. The
staging worker must pass real singleton instances and actual tab handlers.
The UI DOES NOT instantiate those services or connect MeshCore carrier data.
The existing ConvoyMembershipService implements AuthorizedConvoyDirectory;
inject that same singleton as the directory to
ActiveOperationalConvoyProvider. Crucially, its localIdentityRef must be the
**Security v1 DeviceIdentity.deviceId**, never an inferred MeshCore public-key
prefix. The identityProvider is a real
Pick<ConvoySecurityV1Port, 'currentIdentity'>. Set productionSecurityReady
true ONLY when a production-grade persistent crypto/secure-storage provider is
actually installed and identity verification is operational. In test/emulator
configurations without that assurance, leave it false.

The member roster is read from service.listMembers(convoyId) ONLY after live
service.resolveAuthorized(convoyId, identityRef) succeeds. The controller
re-resolves the same membership record/epoch after loading the members to
reject a concurrent revocation/epoch rotation. The view requires a matching
fingerprint for the local self member before showing the roster.

To select a convoy, the hook delegates to the existing ActiveOperationalConvoy
context selectConvoy; it NEVER saves or restores its own authorisation token.
On process restart the directory must revalidate persisted selection against
live Security v1 membership and current identity. On revocation, trust
change, identity rotation and key-epoch changes, call
ConvoyMembershipService.notifySecurityInvalidation() and have the App Shell
refresh the existing active directory. The hook subscribes to membership
service invalidations and fails closed while reloading.

## Exact user actions and their meanings

1. **Create**: ConvoyMembershipService.createConvoy(name, []) creates a
   *new* Security v1 group with the local owner as leader. After creation the
   UI refreshes directory/selection and reports verified selection only if
   independently confirmed. Does NOT add new existing-convoy members.
2. **Prepare invitation**: service.invite checks verified owner/admin
   leadership and trusted public recipient fingerprint, saves LOCAL metadata,
   enforces up to seven days. Delivery over an authenticated direct session
   must be supplied elsewhere. The UI shows pending, expired and cancelled.
   It does NOT display shareable carrier PSKs or bearer secrets.
3. **Review received invitation**: incoming records must be delivered by a
   verified Security v1 direct session and match recipient device ID and
   pinned fingerprint. The optional onSubmitAuthenticatedJoinRequest is an
   **integration-owned** authenticated send pipeline. If absent, or if direct
   transport is unavailable, joining is disabled. A request is not a join.
4. **Owner/admin approval**: service.approveJoinRequest validates the
   authenticated request and Security v1 local group leader permissions.
   Result is only approved-awaiting-security. The UI explicitly says that
   atomic Security v2 group-add/key distribution is still unavailable.
   No verified roster or map marker is added.
5. **Reject**: service.rejectJoinRequest marks the authenticated request as
   rejected without group membership. Expired/blocked/rejected records cannot
   be approved via the UI.
6. **Remove member**: a second explicit confirmation precedes
   service.removeMember, which verifies owner/admin policy, performs a local
   Security v1 revocation and key rotation, and invalidates membership caches.
   Remote key distribution / global revocation acknowledgements are NOT
   confirmed. The UI never permits self/owner removal, or an admin removing
   another admin. Revocation of remaining remote access still requires the
   Security v2/distribution integration process.
7. **Identity inspector**: only public device ID, public fingerprint and
   public key epoch are displayed. Never collect signing private keys,
   key handles, group secrets, raw session ciphertext or channel PSKs.
8. **Member list**: service.listMembers provides role, group leader status,
   active/revoked status, and presence based on authenticated position
   ingress. No unscoped ConvoyContext.vehicles or discovered radio contacts
   are used. "No current authenticated position" does not mean the car
   disappeared, and an expired/stale position is never presented as current.
9. **Driver safety**: 56 dp+ controls, explicit review/confirmation for
   create, invitation, admin approval/rejection, join submission and removal.
   The presentation remains safe for use while parked, not while driving.
   STOP/HELP/HAZARD/REGROUP radio actions are NOT present.

## Required external dependencies and blockers

The Security v2 proposal's ProposedSecurityV2EnrolmentPort is still
UNIMPLEMENTED. Its plan/commit/wrap/install/ack and revocable anchored role
credential work must not be synthesised by this UI. The V3 compatibility
wrapper's observations are **read-only diagnostics** and never membership.

The service also needs an actual production Security v1 adapter, protected
durable secret/metadata store, and authenticated direct-session ingestion/
routing. Existing non-production test stores are not sufficient evidence.
Carrier provisioning and canonical Protocol v1 wire mapping remain with
their owning staging workers. This UI does not send packets, change keys or
install security modules.

## Validation

Unit suites in src/convoy/ui/__tests__ cover:
- No identity / no production security provider;
- Missing selection and roster, pending and expired invitations;
- Pending approval vs pending-security-enrolment, rejected/blocked/expired;
- Fresh Security v1 membership confirmation, roles, revocation;
- Identity rotation, epoch mismatch and process-restart revalidation;
- Authenticated direct-transport outage;
- Touch accessibility, navigation, preview and critical confirmation.

Commands to run on a checked-out branch:

    npm ci
    npm test -- --runInBand
    npx tsc --noEmit
    npm run lint
    cd android && ./gradlew assembleDebug --no-daemon

The feature does not modify application integration branches. Never interpret
an unrun test or absent CI status as a passing build.
