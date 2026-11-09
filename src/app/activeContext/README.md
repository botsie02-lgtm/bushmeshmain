# BushMesh application shell / operational context v1

## Ownership and lifetime

- App.tsx mounts AppProviders once and keeps all BLE/native ownership,
  inbound processing, runtime, persistence and location service providers
  outside tab-specific screens.
- AppShell exposes exactly five top tabs: Drive, Radio, Convoy, Contacts,
  Device. Drive is the initial tab.
- Map is an opt-in Drive subview. GPS is a Device subview. All former screen
  components remain reachable without modifying the other workers' files.
- The legacy Drive, Convoy and Map screens can display unscoped inbound
  vehicle positions. They are deliberately opt-in, marked as unverified, and
  never used to construct the default Drive operational roster.
- Radio's existing channel-focused conversation behavior remains intact;
  ViewedConversationContext introduces a separate, in-memory conversation
  selection interface for the future Radio and Contacts integrations.

## Strict identity boundary

The shell distinguishes five concepts:

1. **Selected carrier:** BushMeshContext.activeChannelIndex / activeChannel
   (MeshCore channel). No membership or trust conclusion.
2. **Discovered contacts:** BushMeshContext.contacts (MeshCore directory).
   No membership or trust conclusion.
3. **Viewed conversation:** ViewedConversationContext.viewedConversation,
   a navigation-only typed reference. No cryptographic or radio effect.
4. **Authorised membership:** an AuthorizedConvoyMembership returned by
   AuthorizedConvoyDirectory, bound to a local public identity reference,
   Security v1 verification source and an opaque membership record reference.
5. **Active operational convoy:** exactly one currently selected, freshly
   validated authorised membership; null by default. Never inferred from
   carrier name, PSK, channel index, invite or incoming position traffic.

The default directory intentionally returns no memberships. An integration
worker must supply a directory backed by real Security v1 authenticated
membership state, not by the carrier provisioning or contact directory.
In particular, Security v1 group-key distribution and authenticated
enrollment are *not* implemented by this shell.

## Directory integration contract

Provide an AuthorizedConvoyDirectory to ActiveOperationalConvoyProvider:

- listAuthorized(localIdentityRef): authoritative authorised records only.
- resolveAuthorized(convoyId, localIdentityRef): fresh revalidation; must
  return null for revoked, expired, pending, mismatched or unknown memberships.
- subscribeInvalidations(listener) (optional but strongly recommended):
  notify on revocation, identity rotation and membership state changes.
  Returning a cleanup function is required.

Each record contains convoyId, displayName, localIdentityRef,
authorizationState='authorized', verifiedBy='security-v1' and a
membershipRecordRef. The last field is an opaque **reference** to verification
state, never a raw private key or shared secret. Metadata labels alone cannot
establish trust: the directory implementation is the actual trusted boundary.

For integration, App.tsx's OperationalShell is the wiring point. Until the
Security v1 adapter supplies this directory, No active convoy is correct.

## Optional selection persistence

The shell saves **only** this versioned metadata:

    {schema:'bushmesh-active-convoy-selection',version:1,
     convoyId:'...',localIdentityRef:'...'}

On launch, selected metadata MUST be revalidated against the current local
identity and a live directory entry. Invalid, stale or mismatched stored
selections are discarded. A missing identity never authorises a restore.
Private keys, PSKs, invitations and group secrets are never stored here.

The optional native module named BushMeshActiveConvoyStore must expose:

- loadSelection(): Promise<string|null> (JSON metadata)
- saveSelection(serializedMetadata: string): Promise<void>
- clearSelection(): Promise<void>

Storage should be atomic, separate from Security v1 keys and the canonical
runtime snapshot, and protected according to the app's normal local-data
requirements. This native module is **not yet implemented**. When absent,
selection is session-only, and a fresh app process starts with no active convoy.
A MemoryActiveConvoySelectionStore is available for tests but is not durable.

## Remaining integration work

- Security/integration owner: supply a live authorised-membership directory,
  membership invalidations, identity lifecycle and active-convoy scoped data.
- Native/platform owner: implement the optional selection-store module if
  persistent convoy choice is desired; do not reuse a key/PSK store.
- Drive/Convoy owners: filter position, operational marker and roster data by
  verified convoy membership before retiring the opt-in legacy warnings.
- Radio/Contacts owners: connect conversation navigation to the separate
  ViewedConversationContext; the old RadioScreen presently follows a carrier.
- Device/map owners: move offline map pack *settings* into Device as desired.
  A Device entrypoint currently routes to existing map-pack controls in Drive.

The shell does not merge branches, alter frozen Security/Protocol contracts,
or control radio ownership.
