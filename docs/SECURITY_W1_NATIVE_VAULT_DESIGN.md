
# BushMesh W1 native identity vault — design contract R1

Date: 2026-11-24
Status: DESIGN ONLY — NOT IMPLEMENTED, NOT APPROVED FOR PRODUCTION
Branch: feature/android-production-security-v1
Parent review: docs/SECURITY_CAPABILITY_TIERS_ARCHITECTURE_REVIEW.md at bb33d38edcc445ad6d453df926b4b4911db7ea97
Protected Wave 3 baseline: ca3388e54deafbe5e6bc854c1a145873a1508d01
Security V2 reference: feature/security-v2-group-transactions-v1 at 2e71491e66e9964c77049fd18454aa1f36adc194

This design proposes an isolated research path for W1: software-operated Ed25519/X25519 private keys encrypted at rest by an AES-256-GCM wrapping key whose Android KeyInfo explicitly reports TEE or StrongBox. W1 is not hardware-resident Curve25519, not remotely attested, and not currently an approved operational BushMesh security profile.

## 1. Evidence and invariants

On physical Galaxy S22+ SM-S906E, Android 16 API 36, AES storage reported TEE, while both Ed25519 and X25519 KeyInfo reported SOFTWARE with Android API non-exportability. Ed25519 and X25519 generation and KeyInfo extraction succeeded, but hardware verification failed; signing, agreement, and RFC8410 encoding were NOT_RUN. The isolated instrumentation suite completed OK (21 tests) with hardware-conditional test skips possible. These results reject H1 for the tested device/provider/key configuration.

The existing H1 AndroidHardwareCryptoProvider and native BushMeshCurve25519Keys hardware checks remain unchanged. An H1 failure must never silently select W1. Any proposed W1 private keys must remain native-process-only; no unwrapped PKCS8, seed, plaintext key, arbitrary decrypt or key export method may cross the React Native bridge. Do not reuse dev/test WebCrypto PKCS8 persistence, AsyncStorage, general SecureSecretStore or logs. Frozen Security v1 CryptoProvider requires opaque handles and raw 32-byte Ed25519/X25519 public keys; preserve those public and on-air formats.

A verified TEE AES wrapping key protects encrypted *storage*, not private keys operated in app memory. Rooted process compromise, runtime hooks, memory dumps and malicious signing requests remain material threats.

## 2. Proposed API — illustrative only, not callable production code

A separate experimental native-only interface, with its own implementation and vault namespace:

    interface ExperimentalW1Vault {
      describeLocalCapability(): SanitizedCapability
      provisionCandidate(epoch: Long, binding: IdentityBinding): CandidateReceipt
      commitCandidate(candidateId: String, expectedIdentityDigest: ByteArray): CommitReceipt
      abortCandidate(candidateId: String): CleanupReceipt
      status(handle: PrivateKeyHandle): HandleState
      signIdentity(handle: PrivateKeyHandle, message: ByteArray): ByteArray
      agree(handle: PrivateKeyHandle, peerRawPublic: ByteArray): ByteArray
      retireIdentity(expectedEpoch: Long): RetirementReceipt
      inspectRecovery(): RecoveryState
    }

These are design names, not existing methods. There must be no exportPrivateKey, importUnwrappedPkcs8, decryptVaultBlob or caller-supplied Keystore-alias parameter. Signing with a prepared-but-uncommitted candidate must be refused. Handles are never an owner/role credential.

Existing H1 provider remains android-keystore-curve25519-v1. A distinct proposed W1 provider identifier is android-wrapped-software-curve25519-w1. The private handle is provider/id/algorithm/purpose only. W1 IDs and encrypted records must not collide with or be interpreted as H1 aliases. W1 session-ephemeral keys need a separate TTL and crash-lifecycle decision before implementation.

## 3. Sealed record — candidate native-only version 1

Store in a separately versioned, private SQLite vault, not in existing V1 entries or the V2 group store. Record must contain:

| Field | Validation |
| --- | --- |
| schemaVersion | Exactly 1; reject unknown versions |
| recordId | CSPRNG opaque identifier, collision-checked |
| providerId | Fixed W1 string, never H1 |
| algorithm and purpose | Exact Ed25519/X25519 and allowed identity-signing, identity-agreement, session-ephemeral pairing |
| identityVersion and identityEpoch | Exact positive current identity binding |
| publicKeyDigest | SHA-256 of exact validated 32-byte public key |
| identityBindingDigest | Domain-separated canonical digest of intended device/identity metadata; avoid circular fingerprints |
| wrappingKeySlotVersion | Internal stable AES KeyStore alias slot, not caller-controlled |
| nonce and aeadVersion | Random non-repeating 96-bit AES-GCM IV and exact cipher profile |
| ciphertextWithTag | Authenticated private record; 128-bit GCM tag |
| state, operationId, createdAt | Provisioning/active/retired transaction journal data |
| authenticatedSchemaDigest | Canonical AAD binding for record metadata |

Use deterministic length-delimited AAD with domain bushmesh-w1-vault-v1 and providerId, recordId, algorithm, purpose, identity version/epoch, public-key digest and wrapping slot/version. Reject cross-record transplant, AAD tampering, wrong handle, wrong algorithm, wrong epoch, and a stale/different public identity. Use a fresh random 96-bit IV for every seal with the same AES key, and enforce no accidental reuse. Never use a rollbackable SQLite nonce counter as the sole AES-GCM IV uniqueness guarantee.

Plaintext sealed payload must be the minimal reviewed Ed25519/X25519 private-key representation; validate exact algorithm, format, length and public-key match. Zero mutable buffers on all exit paths, while documenting JVM/GC copies and limits of memory erasure. No plaintext private-key bytes enter exported reports or JavaScript.

AES wrapper must be AndroidKeyStore AES-256-GCM with randomized encryption and KeyInfo indicating TRUSTED_ENVIRONMENT or STRONGBOX, explicitly on creation and reopening. SOFTWARE, UNKNOWN, UNKNOWN_SECURE and UNRECOGNISED are rejected pending review. A null encoded AES key alone is not proof of TEE/StrongBox. Alias invalidation/mismatch is fatal.

Database must inspect effective FULL synchronous (2), secure_delete ON (1), DELETE journal mode; no silent fallback to NORMAL/OFF/WAL. This is local crash-durability configuration, not hardware rollback resistance, full-snapshot detection or guaranteed physical-flash erasure.

## 4. Provisioning, interruption and retirement

Proposed local lifecycle:

    ABSENT -> PREPARING -> SEALED_PENDING -> IDENTITY_COMMITTED -> ACTIVE
                                                     |
                                                     v
                                                RETIRING -> RETIRED

All transitions use a replay/idempotence operation ID and verified expected identity epoch. Never assume atomicity across AndroidKeyStore alias changes and SQLite commits.

- PREPARING failure: clean/quarantine orphan records; never publish an identity.
- SEALED_PENDING failure: retain quarantine and recovery journal; do not expose sign/agree before public identity and matching opaque handles commit.
- Commit after crash: compare journal, identity metadata, exact public keys, key epochs, authenticated blob and wrapper slot; fail closed on ambiguity. Avoid silently replacing fingerprint.
- Missing/invalidated wrapper: no plaintext fallback and no new wrapper masquerading as recovery of old ciphertext. Require explicit new identity, trusted peer re-pairing and approved epoch transition.
- Retirement: write a durable tombstone *before* deletion, block sign/agree thereafter, best-effort destroy vault records and appropriate alias, preserve tombstone through restart. Deleting files is not a forensic erasure guarantee.
- Full DB snapshot restore while wrapper survives: AES sealing cannot detect historical valid ciphertext. SQLite high-water alone is not rollback resistance. Need independent anchor or fail-closed fresh-key/epoch recovery review before any production deployment.
- Identity rotation: do not reuse earlier fingerprint; either authenticated existing-key rotation with verified proof and epoch validation, or explicit re-pairing/owner approval. No automatic H1 to W1 migration.
- Concurrent calls: serialize state transitions, reject stale expected epoch, purpose mismatch, wrong provider or duplicate operation IDs.
- OS update, reinstall, backup/restore, device-lock change, process death and reboot require named failure and recovery tests.

## 5. Capability and authorization semantics

A proposed local-only W1 report can contain: profile W1_HARDWARE_WRAPPED_SOFTWARE_KEYS, wrapperSecurityLevel TEE or STRONGBOX, privateOperationSecurity SOFTWARE, selfTestResult, externalAttestation NONE, productionActivationApproved false. This is a design example, not actual device output or remote assurance.

No peer is to be labelled remotely hardware-verified based only on self-signed assertions. A convoy owner cannot treat a self-reported H1 label as an authenticated hardware policy attestation. Device assurance, identity authenticity, direct-session encryption, signed owner/admin authority, group epoch installation and membership are separate security properties. Owner-genesis pinning, verified receipts, authority revocation, replay protection and high-water recovery remain mandatory for Security v2. AndroidSecurityEpochStorage.commitEpoch is storage-only and incompatible with the full SecurityV2TransactionalStore.

A proposed W1 option must require explicit reviewed user/admin choice; a failed H1 check cannot select W1 automatically. W1 status must not turn a pending join request, missing location, or unverified member into a verified active member.

## 6. Threat and field-use policy

| Threat | H1 difference | W1 constraint |
| --- | --- | --- |
| Offline stolen database | Hardware key inaccessible as ordinary private bytes | AES-wrapped blob protected at rest if alias remains TEE/StrongBox |
| Root or hooked running app | Operations may be abused; private key usually not extractable | Plaintext software key and derived secrets may be extracted during use |
| Snapshot rollback | Independent epoch problem remains | AES wrapping does not fix epoch or nonce rollback |
| Device-lock / biometric changes | May invalidate keys under chosen policy | W1 wrapper invalidation may permanently orphan sealed identity |
| App/JS bridge leakage | Bridge still handles session/group symmetric values | W1 asymmetric private bytes must NEVER cross JS |
| Forged remote tier | Local self-test != attestation | Peer profile unknown unless independently verifiable |

Device-lock policy is UNDECIDED: mandatory unlock, user-auth timeout, biometric invalidation, background radio/hands-free usability and urgent operations must be evaluated explicitly. Do not silently disable user authentication for convenience.

Cryptographic library/provider selection is UNDECIDED: needs maintained provenance, independently reviewed exact Ed25519/X25519 operations, raw RFC8410 public-key compatibility, valid signing vectors, low-order X25519 protections, deterministic test vectors, native ABI and exception review. Do not silently substitute an algorithm or use random packages.

## 7. Isolated-prototype test gate

Required tests before proposing a standalone APK:

- Crypto: known-answer Ed25519 sign/verify and X25519 agreement, 32-byte public key, 64-byte signature, invalid/low-order public input, mismatch and purpose misuse.
- Wrapping: AES-GCM 96-bit IV uniqueness, AAD tampering, ciphertext/tag corruption, wrong alias and KeyInfo SOFTWARE/UNKNOWN rejection, alias absence and invalidation.
- Custody: no private or seed bytes in React Native API signatures, JS arrays, exports, logs, crash reports, metadata, backups or sanitized diagnostics; native buffer wipe is best effort and separately assessed.
- Lifecycle: interrupted prepare/commit/retire, idempotent retries, stale epoch, orphan records, key rotation, locked-device operation, process death/reboot, restored snapshot and failed deletion.
- Approval: no automatic W1 fallback after H1 failure; no false remote hardware attestation, no unsecured enrolment, strict V2 owner/roster/epoch/receipt/revocation boundaries.
- Isolation: experimental zero-radio, zero-location app only, independent package; no changes to com.bushmeshmain and no production factories or providers selected.

A structural test passing does not demonstrate secure memory handling or physical resilience.

## 8. Exit criteria and next execution package

R1 design requires independent review of the crypto implementation choice, native custody/memory model, SQLite/Keystore lifecycle gap, device-lock policy and snapshot recovery approach. Only after review should an experimental native-only vault prototype be built in a separately opt-in securityprobe test APK. Physical validation on Galaxy S22+ and a comparator handset, plus explicit policy and formal V2 convergence, are separate downstream milestones.

**Not delivered in this change:** no W1 runtime classes, no database schema migration, no private keys, no new Keystore aliases, no Android app changes, no React Native bridge changes, no identity activation, no Secure Convoy v2 enablement.
