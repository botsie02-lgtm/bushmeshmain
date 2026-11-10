# BushMesh Security v2 — group-roster/key transaction review (NOT ACTIVATED)

Branch: `feature/security-v2-group-transactions-v1`. Exact base: `ca3388e54deafbe5e6bc854c1a145873a1508d01`.

**Status: ADDITIVE REVIEW IMPLEMENTATION, TEST PROVIDER ONLY. NOT PRODUCTION SECURITY APPROVAL.**
`SECURITY_V2_PRODUCTION_ACTIVATION` remains `disabled-pending-formal-review`;
existing `SECURE_ENROLMENT_V3_ACTIVATION` remains
`disabled-pending-security-v2-review`. Neither is connected to App,
`AuthorizedConvoyDirectory`, live membership, radio, GPS, maps, or native BLE.
No frozen Security v1 or Protocol v1 contract was modified.

## Phase 1: findings and contract decisions

Read `docs/WAVE3_SECURITY_V2_FORMAL_REVIEW.md`,
`src/convoy/enrolmentV3/SECURITY_V2_CONTRACT_PROPOSAL.md`,
`src/convoy/membership/`, the Security v1 managers/provider ports and
`src/bushmesh/protocol/securityBoundary.ts`.

The original proposal is directionally correct, but **cannot be treated as a
reviewed production contract**. A V1 GroupKeyManager wraps keys only for
already-active members and has no atomic add-member API; it must not be
circumvented via `SecurityMetadataStore.setGroup`. V1 nonce counters
protect individual AEAD keys, not roster epoch commits. Separate V1 group
key writes and metadata writes do not establish an atomic group transaction.

| Requirement | V2 isolated approach | Production evidence still needed |
| --- | --- | --- |
| Owner genesis | Local owner signs versioned root; independently pinned digest/fingerprint required on recipients | Trusted onboarding/pin ceremony, secure persistence |
| Admin grants | Owner-signed, one-hop, bounded role credential; verify current roster, epoch, sequence and revocation | Owner-approved admin lifecycle/revocation synchronization |
| Prepare | Verify signed requester, anchored approval, trust pins, V1 direct session, AAD hash and before/after roster digests | Native/reviewed control transport |
| Commit | Single provider CAS: journal+roster+new secret+epoch fence; no V1 setters | Transactional native provider + power-loss tests |
| Rekey | Fresh 32-byte epoch root, prior key retired, only pending new member pre-ack | Native protected key custody / hardware feasibility |
| Distribution | Protected V1 direct-session AEAD; V2 outer Ed25519 signature binds transaction, full snapshot, AAD and encrypted bytes | Firmware/runtime interoperable vectors and payload bounds |
| Recipient install | Independent genesis pin + current owner signature + V1 AEAD + atomic newer-epoch installation | Native secure-store atomicity, independent device tests |
| Acknowledgement | Recipient signs exact distribution digest *after* local install; issuer checks trust/fingerprint/epoch/signature + issued envelope | Transport retry/receipt routing, signed confirmation reachability |
| Offline peers | Owner may issue multiple distinct protected envelopes; newer owner-certified epochs may skip offline epochs, with old revocation pins preserved | Offline reconciliation authority policy, bounded epoch history |
| Rollback | Independent monotonic epoch fence abstraction; mismatch fails closed | Real rollback-resistant storage properties; not assumed |
| Replay/downgrade | V2-only object schema; V1 session replay and authenticated AAD; distinct request, tx, install, ack journals | Final Security/Protocol cross-version conformance testing |

### Contract differences requiring security review

1. **Signed join request is mandatory**, not merely a proposal containing
   someone else's requester identity. `SignedJoinRequestV2` authenticates
   the requester, expected epoch, request ID, group and hash of canonical
   Protocol v1 AAD bytes. It is required for `prepareAddMember`.
2. Proposed `BoundEpochDistributionV2.wrappedKey` would misleadingly imply
   it can use frozen V1 group-key package/install semantics. V1 rejects
   new recipients. The new V2 envelope instead has
   `encryptedPayload: EncryptedDirectMessage`; inside is a **different,
   explicitly versioned** V2 epoch package, never passed to
   `GroupKeyManager.installWrappedGroupKey`. The outer signature binds
   every canonical signed field and encrypted envelope. V1 remains unchanged.
3. **New member remains pending-install after atomic commit**. A proposed
   roster is not independently authorized; a current, signed, stored
   recipient acknowledgement is required by
   `resolveCurrentMembership`. The draft compatibility service remains
   permanently unauthorized and is not wired to this API.
4. **No arbitrary-depth delegated role chain**. V2 currently accepts only
   owner self-credentials or owner-signed, currently active admin
   credentials, anchored to a separately pinned owner genesis with
   monotonically checked authority sequence. Admin-to-admin delegation and
   owner transfer are rejected and require a reviewed protocol revision.
5. **Recipients require an anchored owner's distribution signature**,
   even if an admin was permitted to approve/commit on the authority device.
   An offline recipient cannot safely know an arbitrary admin's latest
   revocation state from a stale snapshot. A secure, signed current
   authority-checkpoint/revocation sync is future required work.
6. `SignedOwnerGenesisV2` includes the full public DeviceIdentity so the
   independent owner signature can be checked without inventing public keys.
   The recipient must separately pin the digest and fingerprint via a trusted
   approval process. A self-signed group origin alone grants no authority.

## Phase 2: reviewable API and data flows

Import only `src/security/v2/index.ts` in a future reviewed integration.
Do **not** add exports to `src/security/index.ts` until approval.

`SecurityV2GroupTransactions` constructor accepts the frozen
`CryptoProvider`, `IdentityManager`, `PeerTrustManager`,
`DirectSessionManager`, an explicit `SecurityV2TransactionalStore` and
`SecurityClock`. All private Ed25519/X25519 keys stay opaque inside v1
providers; V2 only calls `identity.sign/verify`, V1 direct-session
`encrypt/decrypt` and `sessions.assertPeerSession`.

Lifecycle:

1. `createOwnedGenesis()` signs a local root and atomically creates the
   genesis roster, epoch 1, fresh key and pinned local root. Other devices
   **must independently provision** that exact root pin before any install.
2. Requester `signJoinRequest()` signs group, ID, epoch, AAD digest, identity
   and time bounds. Approval authority signs an owner/admin credential and
   approval with the existing `enrolmentV3/roleCredential.ts` draft transcript
   format (V2 independently verifies the same deterministic preimage).
3. `prepareAddMember({join, approval, sessionId, context})` verifies current
   trust, exact session-to-requester binding, owner root, credential delegation,
   signatures, expiry, epoch, complete prior and prospective roster digest,
   and creates an idempotent *non-publishing* transaction journal.
4. `commitPreparedAddition(ref)` **revalidates** identities and authority,
   then invokes atomic CAS with a fresh epoch secret. The new member is
   `pending-install`. Missing or ambiguous commit results are not inferred
   from a write callback: retry reads the durable transaction ID/digest.
5. `wrapCommittedEpoch()` verifies current epoch, issuer and recipient,
   produces V1-protected direct ciphertext and signs the complete V2
   distribution transcript. The provider records each issued envelope digest.
   Distinct rekey retries use fresh V1 send nonces.
6. `installCommittedEpoch()` checks independent owner pin, V2 signature,
   pinned recipient/current owner, authorized requester and approval, complete
   signed roster, V1 direct-session AEAD and strictly increasing epoch fence;
   then atomically installs the key, roster, and replay journal. Only **after**
   success does it sign an `InstalledAckV2`. If the process dies after commit
   but before signing/sending the acknowledgement, `recoverInstalledAck()`
   verifies the same signed distribution digest, existing protected epoch key,
   current owner pin, local identity and original protocol AAD, and signs a
   replacement acknowledgement **without replaying** the consumed V1 AEAD.
7. `verifyInstalledAck()` checks the exact previously issued envelope,
   signer fingerprint, Ed25519 signature, current epoch and roster digest,
   then records verified acknowledgement durably. A radio write, delivery
   receipt or raw string cannot substitute for installation.
8. `resolveCurrentMembership()` is a proof-query, **not a live app
   directory**. It requires anchored current state and key; recipients
   additionally require a stored verified ack. No service wires this query
   into the actual app.
9. `applyRoleRevocation()` accepts owner-signed current-sequence revocation
   and atomically advances authority sequence, superseding prepared journals.
   `invalidateCurrentEpoch()` is a local owner-only emergency disable
   that deletes current epoch key without issuing any new group epoch.

A runtime must include the exact **original immutable Protocol v1 AAD**,
generated by `encodeBushMeshAuthenticatedHeader()` /
`createBushMeshSecurityProtocolContext()`. V2 hashes those bytes with its
own domain separator to bind the signed join/distribution claims; V1 AEAD
binds the actual bytes. Logical source/destination/packet type/message ID/
priority/compression and end-to-end group selector are authenticated per
Protocol v1. TTL, hop count, RSSI/SNR, next-hop paths and radio retry state
remain mutable and **must not** enter the end-to-end AAD. Transaction ID,
credential ID, roster hash and epoch, if not represented in the frozen
Protocol v1 AAD encoding, are authenticated inside the V2 signatures and
V1-encrypted plaintext; do not silently alter Protocol v1 wire grammar.

**Canonical encoding**: `src/security/v2/canonical.ts` uses v1 length-
delimited `encodeFields` for genesis, signed join, role credential, approval,
revocation, distribution and ack transcripts. Roster digests bind group ID,
epoch and complete sorted device IDs/fingerprints/key epochs/states/times.
Serialized objects in distribution transcripts use recursively sorted keys
and safe integer normalization, never insertion-order `JSON.stringify`.
The existing draft role and approval transcript field ordering is preserved.

## Transactional store requirements for Android worker

Implement `SecurityV2TransactionalStore` **as a new provider**, not by
calling V1 `SecurityMetadataStore.setGroup`. Production MUST guarantee:

- Atomic and durable CAS for (old expected epoch, roster digest, authority
  sequence, current key identity) -> (new roster, 32-byte fresh protected
  root, new epoch, protected epoch fence, prepared/committed journal).
- Atomic recipient install CAS over pinned owner genesis, high-water,
  signed transaction digest, new key and roster; an ambiguous native result
  must be detectable and reconciled by replay journal before authorizing.
- Per-group locking across processes/threads and transactions; unique
  transaction IDs/request IDs; immutable committed journal digest, and
  idempotent *identical* retries only. Conflicting repeats fail closed.
- Durable per-recipient issued-envelope digests and verified signed receipts;
  journal and remaining recipients survive app restart/radio disconnection.
- Protected asymmetric key handles survive restart and fail closed when
  missing; group keys remain in platform-protected symmetric storage.
  Existing Security v1 APIs do not export private keys.
- Transactional identity-role credential revocations, bound to a
  monotonic authority sequence; invalidation/revocation cannot leave a
  partially published old or new roster.
- Detect ordinary metadata rollback by comparing snapshot epochs to a
  separately protected monotonically advancing epoch fence. **An SQL
  transaction alone does not prevent restoring a coordinated old database
  backup.** Android hardware-backed rollback counters are not promised
  without per-device evidence. Fail closed if external anchor/fence
  integrity cannot be established.

`testing/InMemorySecurityV2TransactionStore` is deliberately not
persistent, encrypted, thread-safe, multi-process-safe or rollback-resistant.
Its pointer swap and separated high-water map are **simulations**. It can
inject failures before/after commit/install and ordinary metadata rollback,
not prove Android fsync, keychain/Keystore semantics or power cut tolerance.

## Threat model and fail-closed cases

Adversary controls RF/BLE delivery order and can forge invitations, signed
unanchored roles, alter JSON/envelopes, replay signed proofs, partition users,
revoke/rotate keys asynchronously, attempt duplicate/concurrent enrollment,
restore ordinary metadata, and compromise a previously trusted member.
It cannot extract a non-exportable owner/peer private key or bypass a
properly hardened storage provider under our stated cryptographic assumptions.

- **Invitation != membership.** Approval signature != current authority.
- Owner roots must be pinned independently of the received distribution.
- A group leader or MeshCore channel PSK is not a valid convoy owner grant.
- No `active` member is inferred from prepared state, pending installation,
  radio write, envelope reception or a plaintext acknowledgement string.
- Every new epoch uses a fresh secret. An old key cannot read the new epoch;
  a revoked peer who retained the old key may read previously captured old
  traffic. Security v2 does not claim retrospective secrecy.
- Revoked fingerprints and high-water must never be replaced by an old
  snapshot. Identity rotation invalidates stale sessions and requires a
  reviewed roster/owner-anchor migration flow; it does not silently rebind.
- Unauthorized admin chains, unsigned or stale owner claims, role revocation
  with stale authority sequence, old epoch installs, missing keys and
  corrupt journals fail closed.
- If one storage domain rolls back while the other stays current, reject.
  A coordinated rollback of both snapshot and protector requires additional
  platform trust/hardware evidence; no test-only code can prove immunity.
- Security v2 does not route, transmit or parse LoRa frames, enable
  offline group traffic, alter V1 AEAD, or expose `AuthorizedConvoyDirectory`.

## Multi-device tests and blocked activation

Deterministic Jest scenarios cover requester/owner cross-device sessions,
genuine Protocol v1 AAD bytes, independently pinned owner genesis, forged
authority, role revocation, duplicate request/transaction IDs, stale
roster/epoch conflicts, power loss before/after atomic swaps, lost recipient
key, trust rotation, downgrade and AAD tampering, replayed distribution,
missing pin, bad ack, committed-but-unacknowledged membership and
old-snapshot rollback detection. Android CI builds the unchanged native app
without activating the new code.

Still **blocked** pending independent formal security approval:
production Android CryptoProvider/transactional-group store and
after-process-restart/power-cut tests; authority checkpoint and remote role
revocation propagation; secure owner transfer and authenticated roster
revocation/rekey; bounded recipient reconciliation when the owner/admin
changed while disconnected; certified per-device rollback defense; group
message data-plane v2 integration and full packet sizing/fragmentation;
application directory integration/UX policy; physical multi-device RF tests.

**Security classification:** isolated versioned API and code implemented;
atomicity/rollback/power loss simulated; production native persistence and
runtime interoperability blocked; **zero newly production-ready membership
or radio transmission capabilities**.
