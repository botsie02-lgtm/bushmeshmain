# BushMesh secure convoy joining v3 — Security v2 extension proposal (DISABLED)

**Status: DESIGN-ONLY / SECURITY REVIEW REQUIRED.** No member is added to
an existing convoy by this module. No capability or authorization result is
created from draft metadata, signatures, acknowledgements, delivery counters,
local snapshots, invitation text, MeshCore carrier PSKs or phone contacts.

Base: 9956ef244881c79a64e582a08136eceb0a90dce5.
This feature branch adds files only under src/convoy/enrolmentV3,
__tests__ and a feature-scoped GitHub Actions workflow. Frozen Security v1,
Protocol v1, radio/BLE, Android, AppShell, Drive and Map implementations are
not edited.

## Investigated frozen Security v1 and Protocol v1

- IdentityManager.sign/verify uses an opaque non-exportable signing key handle;
  PeerTrustManager.assertTrusted pins deviceId + current fingerprint and
  applyRotation verifies a previous-key-signed, sequential identity rotation.
- DirectSessionManager encrypt/decrypt uses AEAD authenticatedHeader AAD, current
  direct-session keys, replay counters, trust and fingerprint checks.
- GroupKeyManager.createGroup() is only callable for a NEW bmg1_ group and
  resolves trusted founding peers. It has no incremental addMember API.
- GroupKeyManager.wrapActiveKeyForPeer() explicitly requires the recipient
  already be an ACTIVE group member, and a trusted direct session. It cannot
  bootstrap a new member. installWrappedGroupKey() requires the authenticated
  group leader and recipient in the encrypted member roster, and a strictly
  greater epoch for an existing group.
- GroupKeyManager.revokeMember() writes local revoked roster state THEN calls
  rotateGroupKey(); the two writes and key deletion are not one atomic
  transaction. There is no global rekey acknowledgement or atomic CAS on the
  entire group+secret+epoch transaction.
- SecurityMetadataStore.setGroup() is exposed as a generic metadata write,
  not an authenticated commit or a transaction with epoch CAS. This project
  does NOT call it to add a member.
- SecureSecretStore provides protected byte storage but does NOT promise a
  general atomic group metadata/key transaction, cross-process locking, or
  rollback-resistant group high-water. A production provider is required.
- Protocol v1 defines protected direct/group containers, typed control frames
  and immutable canonical AAD from encodeBushMeshAuthenticatedHeader().
  Group carrier privacy and group membership are separate; carrier PSK is
  not an authorization claim.

Hence **actual incremental secure enrolment is blocked** by the frozen
contract. Extending a typed frame or writing group metadata from application
code would bypass the security boundary, so neither is done.

## Current implementation and exports

- contract.ts: Security v2 proposal types, strict bounded control payload
  decoder, additive ProposedSecurityV2EnrolmentPort (NOT implemented),
  activation constant "disabled-pending-security-v2-review".
- roleCredential.ts: domain-separated length-delimited Ed25519 signing and
  cryptographic inspection using frozen Security v1 IdentityManager. Results
  are strictly "valid-signature-only"/"signatures-valid-only". An arbitrary
  signer can sign a claim, so signature validity alone grants NO owner/admin
  authority, group access or enrolment.
- joinState.ts: versioned, bounded diagnostic observation state machine,
  idempotent event IDs, conflict checks, strict epoch progression, partial
  delivery and timeout/rotation/revocation reconciliation. Its phases have
  "-unverified" suffixes and NEVER include "authorised" or "active".
- joinStore.ts: optional protected journal of bounded, public identity and
  workflow diagnostics using injected SecureSecretStore. No group secrets,
  PSKs, ciphertext, session keys or signed grants. Durability is false unless
  explicitly guaranteed by the provider. The journal does NOT act as an
  independent anti-rollback root.
- rosterPolicy.ts: pure structural pre-commit checks to preserve all existing
  members and force a fresh rotated key epoch. This is not cryptographic
  authentication of any proposed GroupRecord.
- compatibility.ts: SecureJoinCompatibilityV3 delegates actual request
  authentication, owner/admin approval/rejection, group revocation and live
  AuthorizedConvoyDirectory reads to ConvoyMembershipService. It never
  overrides it and always returns authorized=false for pending join views.
  executeIncrementalEnrolment() unconditionally rejects with
  SECURITY_V2_CONTRACT_REQUIRED (even if a caller injects a mock).
- index.ts: the single import surface for staging prototypes. Do not attach
  pending observations to ActiveOperationalConvoyProvider.

## Proposed additive Security v2 API (not approved)

The exact TypeScript shapes live in ProposedSecurityV2EnrolmentPort:

1. prepareAddMember({approval,sessionId,context}):
   authenticated role/root chain, trusted requester and approving authority,
   request/proposal replay IDs, group ID, current fingerprint, sender session,
   immutable Protocol v1 AAD, expected epoch and roster digest checks.
   Returns an opaque transactionRef, expectedEpoch and nextEpoch. MUST NOT yet
   publish a new member.
2. commitPreparedAddition(transactionRef):
   atomic (compare expected group revision/epoch, trusted roster, fresh
   symmetric epoch key, key/roster metadata and rollback-protected monotonic
   high-water). Conflict or partial failure must not expose a false commit.
   Return committedEpoch, rosterDigest and transactionRef. Distinct event IDs
   with conflicting commitments must fail, repeated identical IDs idempotent.
3. wrapCommittedEpoch({transactionRef,recipient,sessionId,context}):
   only after atomic commit; individually wraps the current epoch secret
   through an authenticated Security v1-compatible direct session and returns
   a NEW signed BoundEpochDistributionV2. Its signed metadata binds the exact
   transaction ID, group, roster digest, recipient fingerprint and epoch to
   the full canonical encoding/hash of the frozen wrapped ciphertext.
   The v1 WrappedGroupKeyDistribution alone is NOT sufficient proof of v2
   enrolment. Existing authorized peers remain listed and receive the new
   epoch; failed deliveries remain pending, without rolling back used keys.
4. installCommittedEpoch({transactionId,convoyId,distribution,context}):
   verify authenticated issuer authority, trusted direct session, signed
   roster/transaction binding, new key and monotonic epoch; install atomically
   with local rollback protection. ONLY THEN sign an install-ack.
5. verifyInstalledAck(ack,transactionRef):
   check recipient signature against current trusted fingerprint, session or
   message context, exact transaction, roster digest and committed epoch, and
   replay status. Never treat an acknowledgement string as proof.
6. subscribeInvalidations(listener): mandatory notifications on identity
   rotations, trust revocations, group epoch updates and authority changes.
   The directory must independently re-check current protected Security v2
   state on EVERY resolution, not trust event notifications alone.

Additional production primitives REQUIRED but **absent** from frozen v1:

- Atomic group roster+secret+epoch CAS with idempotent transaction ID log.
- Protected, rollback-resistant group epoch high-water (cannot reuse v1 nonce
  counters as group commit counters without an approved protocol change).
- A signed, immutable convoy-genesis owner anchor and revocable, bounded
  owner/admin delegation graph with monotonically increasing authority
  sequence. Owner transfer and admin revocation must be total order or
  conflict rejecting; leader != owner. Include identity rotations and role
  revocations in that log, and bind it to group epoch.
- Durable per-peer key distribution/retry receipts independent of active
  radio connection, plus authenticated recovery of the current epoch after
  intermittent connectivity.
- Verified installation state for the recipient and a convergence policy
  for old/disconnected/revoked devices. No backwards secrecy can be claimed
  for a removed device that still has an old key.

The active group rekey must be a new epoch rather than reusing existing key
material; a new member must not receive the old epoch. Existing authorized
members must remain listed with exactly pinned fingerprints and Security v2
needs to make old and new epochs unambiguous. A known revoked device must
not regain access to a stale epoch through rejoin or identity rotation.

## Versioned draft wire objects / canonical authentication

These are PROPOSED application payloads carried inside authenticated,
replay-protected Security v1 direct containers, NOT a new Protocol v1 packet
type. Do not transmit them on existing public MeshCore carrier channels
without the protected direct container.

- RoleCredentialClaimsV2:
  schema="bushmesh-convoy-role-credential-v2", version=2,
  credentialId, convoyId, groupId, ownerAnchorFingerprint,
  subject{deviceId,fingerprint,keyEpoch}, role(owner|admin),
  issuer{deviceId,fingerprint,keyEpoch}, authoritySequence, groupEpoch,
  issuedAt, expiresAt. SignedRoleCredentialV2 adds base64url Ed25519
  signature. The authority root MUST be separately anchored by Security v2;
  the ownerAnchorFingerprint field is merely a signed claim until then.
- EnrolmentProposalV2:
  schema="bushmesh-convoy-enrolment-v2", version=2,
  operation="add-member", transactionId, requestId, convoyId, groupId,
  requester and approver identities (each deviceId,fingerprint,keyEpoch),
  expectedEpoch, nextEpoch=expectedEpoch+1, rosterDigestBefore,
  rosterDigestAfter, credentialId, issuedAt, expiresAt.
- SignedEnrolmentApprovalV2:
  kind="approval", proposal, credential, signature. Approval signature is
  over the canonical proposal transcript, and MUST be checked against the
  credential's subject, group, epoch and an anchored, non-revoked role.
- BoundEpochDistributionV2:
  kind="epoch-distribution", schema, version, transactionId, convoyId,
  groupId, committedEpoch, rosterDigest, credentialId, sender identity,
  recipient identity, wrappedKey (exact frozen v1 WrappedGroupKeyDistribution),
  signature. The new authority signature MUST bind the canonical encoded
  distribution bytes (including AEAD encrypted payload) by SHA-256 digest,
  as well as every outer field. Parser checks are only structural; a v2
  provider must verify signature, encrypted binding, current group epoch and
  trusted direct session. A naked v1 key distribution cannot bypass this.
- EnrolmentInstallAckV2:
  kind="install-ack", schema, version, transactionId, convoyId, groupId,
  recipient identity, committedEpoch, rosterDigest, issuedAt, signature.
  Signature MUST be confirmed by Security v2 after local install and must
  match the committed roster; merely parsing this object is insufficient.

Strict JSON-object field allowlists (including the wrapped distribution)
are used in the prototype parser, maximum 8192 UTF-8 bytes. Wire JSON is ONLY a proposal for control transport. The
cryptographic signature input is a separate, deterministic, domain-separated
field encoding, not JSON.stringify, to prevent key ordering ambiguity.

Ed25519 role signature preimage is encodeFields of domain
"bushmesh-security-v2-role-credential-signature-v1" and claims in this
EXACT order: schema, version, credentialId, convoyId, groupId,
ownerAnchorFingerprint, subject.deviceId, subject.fingerprint,
subject.keyEpoch, role, issuer.deviceId, issuer.fingerprint,
issuer.keyEpoch, authoritySequence, groupEpoch, issuedAt, expiresAt.

Ed25519 approval signature preimage is encodeFields of domain
"bushmesh-security-v2-enrolment-approval-v1" and in this EXACT order:
schema, version, operation, transactionId, requestId, convoyId, groupId,
requester.deviceId, requester.fingerprint, requester.keyEpoch,
approver.deviceId, approver.fingerprint, approver.keyEpoch, expectedEpoch,
nextEpoch, rosterDigestBefore, rosterDigestAfter, credentialId,
issuedAt, expiresAt.

encodeFields is Security v1's existing binary encoder: 32-bit BE byte
length followed by UTF-8 domain, then each 32-bit BE byte length followed
by the field's UTF-8 bytes. Decimal integers must have no leading zeros,
timestamps are integer UTC milliseconds. Identity keyEpoch and epoch are
positive unsigned <= 2^32-1. Production design should require SHA-256
roster digests over canonical, sorted, complete roster+role/epoch bytes;
the prototype parser does not itself calculate a group roster digest.

SecurityProtocolContext protocolVersion MUST be exactly the negotiated
protocol version, authenticatedHeader MUST be produced by Protocol v1's
createBushMeshSecurityProtocolContext from the original immutable end-to-end
wire header/routing selector (not forwarded mutable hop state). It must bind:
source/destination identities or canonical routing node IDs, recipient
selector/groupId, message type, messageId, priority, security container,
logical convoy/group ID, transaction ID, event kind, role credential ID,
roster digests and epoch. Fields not present in Protocol v1's canonical
header must be inside the AEAD plaintext or in the separately signed
transcript. Do NOT replace existing Protocol v1 AAD encoding with JSON.
An enrollment control subtype must be fixed in a reviewed additive
compatibility spec; unsupported receivers must reject it.

## Secure-join state sequence

Authenticated direct request (v1, pending)
 -> role approval (v2 existing metadata, still pending)
 -> Security v2 authenticated prepare (not implemented)
 -> Security v2 atomic roster/key-epoch commit (not implemented)
 -> individual authenticated rekey distributions to all active peers
 -> recipient atomic install and authenticated install-ack
 -> authority verifies ack, monotonic epoch and roster digest
 -> recipient's own live AuthorizedConvoyDirectory resolves authenticated
    membership AND application activates convoy only through explicit choice.

The OBSERVATION state machine models tentative prepare/delivery/ack messages
for diagnostic/test purposes, with no authoritative "active" state. A dropped
distribution or failed acknowledgement does not undo an already committed
group epoch. Retries must be idempotent for the same authenticated digest,
or reconcile current security state after expiry. A later epoch invalidates
an older transaction; no re-use of an older key is allowed. A lost/rotated
identity pin fails closed until authenticated re-enrolment or a Security v2
identity-rotation roster transaction completes.

## Threat model and limitations

Adversary may control LoRa/BLE carrier, packet ordering, delivery, network
partition, replay, duplication, forged invite/join text, untrusted MeshCore PSK,
and stale local application snapshots. They must be unable to change a
cryptographically authenticated requester identity/role/roster/epoch, replay
an old approval, install a previous epoch, or access verified convoy
positions after local revocation. Offline devices can retain old key material;
this is a **hard global revocation limit** until they learn and enforce the
newest epoch and a rejoin/anti-rollback policy. A compromised rooted device,
compromised Security v1 private handle/provider, or rollback of every trusted
persistent anchor is outside guarantees without hardware-backed defences.

Explicit failure handling:

- Lost request: remains pending; TTL expires without group changes.
- Delayed approval: rejected after expiry or stale epoch/identity.
- Duplicate request/approval: same authenticated ID+digest idempotent; conflict
  with reused ID rejected and alarmable.
- Partial key delivery: commit stays forward-only; retry surviving active
  members and never claim global convergence. Other participants may lag.
- Lost ack: recipient may be installed; retry a signed receipt/revalidation
  without reusing old epoch or adding a second roster entry.
- Restart: journal restored only for diagnostics, bound to local identity;
  authoritative state reloaded independently from protected Security v2 group
  records, high-water and trust. Metadata is never membership proof.
- Identity rotation: old trust and membership fingerprint invalid until
  signed rotation and authenticated roster/epoch update.
- Peer revocation: local group key rotates; reconnecting member must prove
  current trusted identity and receive only an authorised latest epoch.
- Concurrent authorities / partitions: commit MUST use single-writer
  CAS, or deterministic total order/consensus; current v1 stores do NOT
  provide this. Conflicting proposals must not independently win.

## Integration and activation conditions

DO NOT wire executeIncrementalEnrolment() to UI. It throws a stable
SecurityV2ContractUnavailable even when a fake implementation is present.

Before activation, require an approved Security v2 design and code review of
all six API methods, signed owner/admin root and delegation format, atomic
protected key/roster transaction, rollback-resistant epoch high-water, replay
journal and wire compatibility. Implement the Security v2 provider under its
own owned branch, with real crypto and lifecycle. Validate two physical
devices, partial message loss, power-cut recovery and sender/recipient
identity rotation. Produce a documented migration from the v1 group snapshot,
explicitly reject/upgrade ambiguous group records, and verify old v1 peers
cannot silently downgrade the security mode.

Then integrate using:

1. Keep the existing ConvoyMembershipService as the ONLY v1 authority for
   direct-session join intake, trusted owner/admin approval, membership
   directory, local revocation and working founding-member onboarding.
2. Construct SecureJoinCompatibilityV3(existing, securityReadPort,
   ProtectedJoinObservationStore, clock) as an optional administration
   workflow/view only. Its PendingJoinViewV3 has authorized=false.
3. Only after Security v2 is reviewed, implement its native protected
   ProposedSecurityV2EnrolmentPort, add the reviewed activation gate in a
   *separate* commit, and deliver the actual commit, distribution and ack
   transaction through canonical Protocol v1 protected direct envelopes.
4. Revalidate current device ID/fingerprint, authenticated group roster and
   current epoch after each install and on every app restore. Only the
   existing AuthorizedConvoyDirectory may make operational selection visible.
5. Revoke/rotation events must invalidate pending journal state, location
   cache and directory. Never promote legacy unverified ConvoyContext positions.

## Validation

__tests__/convoyEnrolmentSecurityV3.test.ts covers real Security v1
Ed25519 signatures with the frozen provider, forged/stale role and approval
claims, strict wire parsing, epoch rollback, loss/expiry, replay/duplicate
events, partial distribution, mock roster tampering, authenticated v2
service compatibility, protected journal restart, identity rotation and
real Security v1 revocation/rekey obligation. Signing exercises actual
frozen cryptographic methods but does NOT turn a signed claim into trusted
membership or a production-enrolment implementation.

Feature-scoped GitHub Actions runs full Jest, TypeScript, ESLint and Android
debug compile. It does not replace end-to-end hardware security review.
