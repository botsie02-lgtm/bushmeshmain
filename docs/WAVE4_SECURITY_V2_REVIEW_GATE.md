# Wave 4 Security v2 formal contract review: blocking checklist

**Decision on 10 Nov 2026:** **NOT APPROVED / LIVE INCREMENTAL ENROLMENT DISABLED.**  
Canonical frozen interfaces: `src/security/ports.ts`, `src/security/types.ts`, `src/security/group.ts`, `src/convoy/membership/securityV1.ts`.  
Design-only proposal: `src/convoy/enrolmentV3/{SECURITY_V2_CONTRACT_PROPOSAL.md,contract.ts,compatibility.ts}`.  
Prior gate: `docs/WAVE3_SECURITY_V2_FORMAL_REVIEW.md`.

## Why a type contract is not an implemented security feature

- `GroupKeyManager.createGroup` creates a NEW group. `wrapActiveKeyForPeer` requires an existing active member; it is **not** an incremental join method. `revokeMember` / `rotateGroupKey` and secret deletion are multiple commits, not one atomic durable transaction. `SecurityMetadataStore.setGroup` alone cannot authorize membership.
- `ProposedSecurityV2EnrolmentPort` declares `prepareAddMember`, `commitPreparedAddition`, `wrapCommittedEpoch`, `installCommittedEpoch`, `verifyInstalledAck`, and `subscribeInvalidations`. This is a **design proposal** that lacks a reviewed implementation and production transaction store.
- `SECURE_ENROLMENT_V3_ACTIVATION` is `disabled-pending-security-v2-review`. `SecureJoinCompatibilityV3.executeIncrementalEnrolment()` always throws `SecurityV2ContractUnavailable`. Pending observation objects always have `authorized:false`.
- Signature validation by `IdentityManager` authenticates signed bytes only, not a current owner/admin chain. Group `leader` in Security v1 is NOT automatically application `owner` or `admin`.
- Android `BushMeshPersistenceModule` currently encrypts unrelated radio/map/GPS/UI application state with Keystore AES-GCM. That is not a complete `CryptoProvider`, `SecureSecretStore` or atomic `SecurityMetadataStore` for Security v1/v2. Production evidence remains absent.

## Threat model before code activation

Adversaries include an untrusted radio peer on the same private channel PSK, forged or replayed invitations and role metadata, malicious/compromised app state, stolen backups, lost devices, stale or duplicated LoRa frames, reset/corrupted files, concurrent owner approvals, partial rekey delivery, identity rotation and revoked peers, and crashes between key/material/metadata writes. Threats include spoofed authenticated source vs embedded vehicle ID, stale traffic being promoted into the verified roster, mismatched canonical Protocol v1 AAD and stale epochs revived after reboot.

**Carrier PSK is never membership authorization.** A valid Ed25519 signature is not a verified role without an anchored, current authority chain. A local display confirmation, sent packet, ACK string or valid-looking ciphertext is not proof of recipient installation.

## Contract review checklist — every item requires evidence and explicit sign-off

| Ref | Required Security v2 invariant | Proving tests/evidence | Gate |
|---|---|---|---|
| S2-01 | Immutable signed owner genesis, anchored fingerprint; bounded owner/admin delegations, revocation and strict sequences | Forged owner/admin, expired/stale, role escalation, changed fingerprint, root replacement, key rotation | BLOCKED |
| S2-02 | Trusted requester and approver bound to current identity epoch, direct session, exact `convoyId`/`groupId` and AAD | Swapped signers/sessions, wrong recipient/group, stale peer trust, replay and downgraded version | BLOCKED |
| S2-03 | Atomic prepare/compare-and-swap commit of **full roster + fresh epoch secret + epoch high-water** with durable idempotency journal | Two simultaneous additions, conflicting IDs, crash at every write/fsync boundary, restart and replay | BLOCKED |
| S2-04 | New member gets ONLY new epoch key; retained active members get new epoch; revoked peers never regain key through old epoch or rotation | Old-key reject, privacy of pre-join history, rekey under partition, revoked old member offline | BLOCKED |
| S2-05 | Versioned distribution binds transaction/roster digest/epoch and both pinned identity fingerprints to authenticated Security v1 direct ciphertext | Tamper each bound field/ciphertext/hash/AAD, receive on wrong session, swapped peer, duplicate delivery | BLOCKED |
| S2-06 | Recipient verifies and **atomically installs** roster/key/high-water, then signs verifiable installed ACK; retries do not invent completion | Corrupted install, duplicate ACK, sender spoof, reboot before/after install, lost ACK, slow recipient | BLOCKED |
| S2-07 | Signed, complete canonical roster digest with sorted members/roles/identity epochs, plus monotonic owner/admin authority sequence | Digest collisions/serialization ambiguity, missing members, unauthorized deletion, epoch regression | BLOCKED |
| S2-08 | Durable replay/handshake IDs/nonce counters and security journals; rollback resistance backed by actual device support or explicitly documented fail-closed limits | Power loss, app force-stop, update/reinstall, copied app backup, counter loss and rollback | BLOCKED |
| S2-09 | Trusted position and alert source must equal embedded node ID and belong to current authorized group, current epoch and exact carrier binding | Forged node ID, revoked member, wrong convoy, stale fix, replay, public MeshCore contacts | BLOCKED |
| S2-10 | Live `AuthorizedConvoyDirectory` rechecks protected current membership on EVERY read and invalidates on trust/key/identity/epoch changes | Restart, swap identities, revoke while UI open, transport disconnect, malformed stored selection | BLOCKED |
| S2-11 | Version negotiation/downgrade policy preserving frozen Security v1/Protocol v1 AAD and wire compatibility | Mixed-version phones, lower-version attacker, invalid authenticated-header metadata | BLOCKED |
| S2-12 | Real Android Ed25519/X25519 and protected storage provider, correct wire byte formats, API/hardware capability and on-device restart proof | Two device firmware/API variants, reinstantiate provider, KeyInfo/attestation where supported, immutable handles | BLOCKED |

**Operational sign-off fields to fill only with evidence:** reviewer; threat-model version/SHA; approved additive port version; proofs/test SHA; Android capability matrix; privacy implications; expiry/revocation policy; counter/rollback limitations; unresolved exceptions; decision/approval date. A merge or green CI does not fill these fields.

## Proposed transaction lifecycle (not activated)

1. Verify identity/trust/anchored role chain; accept an authenticated, replay-protected direct join request. Prepare a transaction with bound proposal, expected group revision/epoch, full digest and idempotency key. **Prepare must not add a member.**
2. Commit exactly one next epoch and complete updated roster with a new random group secret and protected monotonic high-water, in one recoverable transaction. A failed or ambiguous commit must not be reported as successful. Never write `setGroup` as a surrogate.
3. Wrap the new committed epoch for each authorized recipient through the existing direct-session AEAD context. Bind signed distribution to transaction, digest, authority credential, group/convoy and both identities. Track per-recipient pending/delivered/**installed** states.
4. On recipient, authenticate authority and encrypted wire metadata, reject old epochs and idempotently install the new key/roster/high-water. Only after durable installation create a signed ACK.
5. Validate ACK on authority device against exact transaction, installed epoch, recipient identity and roster digest; reconcile missed recipients after partition/rejoin. Distinguish local commit from globally acknowledged/converged membership.
6. Emit invalidation notifications on every mutation, invalidate stale UI/send permissions and verify roster on the next access.

## Production Android qualification

See `docs/WAVE4_ANDROID_PRODUCTION_SECURITY_PORTS.md`. The exact Security v1 key algorithms are Ed25519/X25519 with raw 32-byte public keys, and signing uses 64-byte Ed25519 signatures. Android KeyMint introduced Curve25519 support at its HAL level in Android 13, but this **does not prove** availability of an Ed25519/X25519 non-exportable key through every AndroidKeyStore/JCA device and API; StrongBox supports a narrower required algorithm subset. A P-256 replacement would change Security v1 keys, signatures and protocol contracts and therefore needs a separate explicitly approved protocol migration, not silent substitution.

Official references:
- https://source.android.com/docs/security/features/keystore (KeyMint/Curve25519 history)
- https://developer.android.com/privacy-and-security/keystore (capabilities and StrongBox subset)
- https://developer.android.com/reference/android/security/keystore/KeyInfo (per-key security level)
- https://developer.android.com/privacy-and-security/security-key-attestation (chain and root validation)

**Decision:** Not approved. This document is a review specification, not a waiver and not proof of the missing components. The Wave 4 static guard must fail if someone accidentally exposes the proposed API as a live authorized directory.
