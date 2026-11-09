# Authenticated convoy membership v2

All code is new under src/convoy/membership; no App Shell, frozen
Security/Protocol implementation, native radio, MeshCore transport or map code
was edited.

## Authenticated behaviour

- SecurityV1ConvoyMembershipAdapter uses frozen IdentityManager,
  PeerTrustManager, GroupKeyManager, DirectSessionManager,
  SecurityMetadataStore and SecureSecretStore. No MeshCore PSK, channel,
  contact, carrier invitation or unverified position can authorise membership.
- createConvoy actually creates a Security v1 group with local leader.
  Optionally it includes **already trusted** founding peers; this uses
  GroupKeyManager.createGroup(), not a fabricated enrolment.
- wrapEnrolmentForMember calls wrapActiveKeyForPeer() for an existing
  Security v1 group member over an already authenticated direct session.
  Recipient installEnrolment calls installWrappedGroupKey() with canonical AAD,
  verifies local key/epoch/member and registers metadata only on success.
- The service implements the App Shell's AuthorizedConvoyDirectory; both
  listAuthorized() and resolveAuthorized() freshly check local identity,
  active membership, matching fingerprint, current Security v1 epoch and
  protected current epoch key. A stored snapshot is NEVER membership proof.
- receiveJoinRequest accepts only an authenticated direct-session AEAD
  decrypted payload with fingerprint-bound sender, replay window and strict
  ID/time validation. Duplicate event IDs are idempotent only when all
  authenticated fields match.
- removeMember enforces local owner/admin role plus actual Security v1 group
  leader identity; it calls revokeMember(), checks epoch advancement and
  invalidates cached position freshness.
- decryptAuthorizedPosition verifies group AEAD, sender identity, epoch, AAD
  and Security v1 replay window, then rechecks identity and group membership
  after decryption to close revocation races. Caller must decode canonical
  Protocol v1 Location payload before using coordinates. This module does
  not reinterpret legacy carrier coordinates as authorised vehicle positions.

## Owner, admin, member

These are *application* roles, separate from Security v1 group leader/member.
The initial creator is owner. An imported recipient defaults to member,
even if the authenticated sender has Security v1 leader status. Group leader
alone is not proof of ownership. An owner may set a **local only** admin grant
for an existing active Security v1 group leader. It is not a signed remote
role credential. Owners can invite, review, remove non-owners and grant local
admins; admins can invite/review/remove members but cannot remove other admins
or owners; members cannot administer. Every admin operation also requires a
current Security v1 local group-leader identity.

Invitation records are proposals, not cryptographic credentials or bearer
tokens; they expire within seven days and require trusted peer fingerprints.
Approved join requests are explicitly "approved-awaiting-security" and
NEVER add a member or distribute a group key.

## Secure persistence and recovery

SecureConvoyMembershipStore uses an injected Security v1 SecureSecretStore
to save only tightly validated and bounded membership *metadata*. No
AsyncStorage, PSK, carrier secret, private key or group distribution is saved
in the registry snapshot. Production SecureSecretStore must provide platform
at-rest protection, atomic replacement and restart durability; the in-memory
WebCrypto test provider does not meet production durability requirements.
MemoryConvoyMembershipStore is explicitly session-only.

Only one ConvoyMembershipService may write to a given profile's snapshot:
frozen SecureSecretStore lacks cross-process compare-and-swap. After restart
the shell's existing active convoy selection may be restored **only after**
resolveAuthorized revalidates it. No auto-selection on creation, invitation,
channel change or inbound packet. Invoke notifySecurityInvalidation() on
trust, group-epoch and local-identity changes and clear legacy unverified
positions when changing the operational convoy.

## Frozen-contract gaps for staging (do not bypass)

1. GroupKeyManager has no authenticated incremental addMember()/roster
   update API after createGroup(). Admin approval remains pending; later
   enrolment requires a genuine group-key/roster mutation and fresh epoch.
2. Security v1 has group leader/member, but no authenticated app-level
   owner/admin grant, owner transfer or signed role-revocation contract.
   Remote role upgrades are not implemented.
3. Security v1 provides no trust/identity/group change subscriptions.
   Integration must notify the service or refresh directory explicitly.
4. Group revocation rotates the key on the revoker, but **cannot instantly
   erase an old key on disconnected peers**. Staging must distribute the new
   epoch to remaining members and enforce freshness; remote acknowledgement
   and global revocation propagation are not implemented.
5. Canonical Protocol v1 Location frame/header binding and location payload
   parsing must be wired by the staging worker. This module yields decrypted
   authenticated bytes, not location markers by assertion.
6. encodeJoinRequestPayload is only an application payload serializer.
   Staging must encrypt/decrypt via the real Security v1 direct-session
   managers and route it within the canonical protected direct container.
   Invitation delivery likewise needs an authenticated transport envelope.
7. Identity key rotation invalidates a pinned GroupMembership fingerprint
   until a trusted leader redistributes a verified new epoch/roster.
   This module never edits Security v1 group metadata itself.
8. Production platform Security v1 secure stores and a singleton lifecycle
   owner must be supplied. No competing key storage is introduced.

## Exact integration handoff

1. Obtain the existing production Security v1 managers; create
   SecurityV1ConvoyMembershipAdapter(crypto, identity, metadata, secrets,
   trust, groups, sessions).
2. Create SecureConvoyMembershipStore(protectedStore) and a singleton
   ConvoyMembershipService(adapter, store, clock).
3. Pass this service as AuthorizedConvoyDirectory to the existing
   ActiveOperationalConvoyProvider. Pass Security v1 deviceId (not the
   MeshCore public-key prefix) as localIdentityRef.
4. Bind administration UI to service methods only after Security v1
   identity/session readiness. Bind incoming requests through the verified
   direct-session decrypt path and position frames through
   decryptAuthorizedPosition with canonical Location AAD.
5. Invoke notifySecurityInvalidation on revocation, trust or rotation.
   Do not change native Background Radio, Protocol v1 or Security v1 internals
   while wiring this feature.

Tests: __tests__/convoyMembershipV2.test.ts uses the actual Security v1
managers and repository WebCrypto test harness. It is not a hardware test.
