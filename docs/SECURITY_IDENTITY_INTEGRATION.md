# BushMesh Security & Identity v1 Integration Contract

Branch: `foundation/security-identity-v1`

Status: **Security v1 contract freeze candidate**. This subsystem remains transport-neutral and independent of radio, BLE lifecycle, routing, convoy application logic and MeshCore compatibility. The canonical BushMesh protocol/runtime transports the security objects and supplies authenticated protocol context; it does not reimplement the cryptography.

## Cryptographic profile

Security v1 uses Ed25519 signatures, X25519 key agreement, SHA-256, HKDF-SHA-256 and AES-256-GCM with 128-bit tags. Public Ed25519/X25519 keys are raw 32-byte values encoded as base64url.

Asymmetric private keys are owned by `CryptoProvider` and are addressed only through `PrivateKeyHandle`. Higher layers never require PKCS#8 bytes. A production Android provider can map handles to Android Keystore/StrongBox aliases; an iOS provider can map them to Keychain/Secure Enclave key references where the primitive/platform combination permits it. `WebCryptoProvider` is development/test-only and may internally export PKCS#8 solely to emulate persistent handles.

AES-GCM nonces are 96 bits: a four-byte namespace prefix plus a durable 64-bit monotonic counter. Direct sessions authenticate random per-direction prefixes in the signed handshake. Group traffic derives a distinct sender key for every `(group, epoch, sender)` tuple.

## 1. Frozen public security API

The public barrel is `src/security/index.ts`. Internal byte encoders, transcript helpers, nonce/replay implementation classes and test stores are intentionally not exported from the barrel.

- `IdentityManager`: create/recover the persistent device identity, sign with an opaque private-key handle, verify identity material and create signed rotations.
- `PeerTrustManager`: observe, trust, revoke and rotate peer identities while retaining fingerprint history.
- `PairingService`: create/verify challenge-bound pairing proofs.
- `DirectSessionManager`: authenticated direct-session handshakes, AEAD, replay enforcement, session expiry, single-session retirement and bulk peer-session retirement.
- `GroupKeyManager`: group creation/rotation/revocation, per-sender group AEAD, and authenticated direct-session wrapping/install of group epoch keys.
- `VersionPolicy`: highest-mutual-version negotiation and downgrade rejection.
- `CryptoProvider`: platform crypto/private-key custody port using `PrivateKeyHandle` rather than private-key bytes.
- `SecureSecretStore`: symmetric secret storage port for direct-session and group root keys.
- `SecurityMetadataStore`: durable public/security metadata, atomic handshake consumption, atomic nonce reservation/high-watermark semantics and durable replay windows.
- `SecurityProtocolContext`: selected canonical protocol version plus immutable canonical header bytes used as AEAD associated data.
- `WrappedGroupKeyDistribution`: transport-neutral group-key delivery object whose key material exists only inside an authenticated direct-session ciphertext.

`WebCryptoProvider` and `SecretStoreWebCryptoKeyPersistence` are development/test adapters. `src/security/testing/InMemorySecurityStores.ts` is not production storage.

## 2. Canonical BushMesh runtime obligations

The canonical runtime must:

1. Initialize `IdentityManager` at startup and fail closed if the identity references unavailable native key handles.
2. Use `PairingService` + `PeerTrustManager` for enrollment; transport `PairingProof`, `SessionOffer` and `SessionResponse` as security payloads without inventing another handshake.
3. Call `DirectSessionManager.encrypt()` before transport/radio framing and `decrypt()` after basic envelope/frame parsing. Supply the exact canonical immutable protocol header bytes through `SecurityProtocolContext.authenticatedHeader` on both sides.
4. On peer revocation, call `PeerTrustManager.revoke()` and `DirectSessionManager.revokeSessionsForPeer()`.
5. After accepting a peer identity rotation, call `DirectSessionManager.rotateSessionsForPeer()` and establish new sessions against the new fingerprint.
6. For group/convoy traffic, call `GroupKeyManager.encrypt()` / `decrypt()`.
7. Deliver a group epoch key only by `GroupKeyManager.wrapActiveKeyForPeer()` over an active direct session and install it with `installWrappedGroupKey()`. Do not expose or transport a raw group key.
8. Rotate the group epoch whenever membership is revoked/removed, then redistribute the new epoch only to active members.
9. Never use untrusted version fields to choose a lower algorithm/version. `VersionPolicy` owns negotiated downgrade checks.

Security v1 does **not** define LoRa framing, routing, message IDs, retry behavior, discovery, convoy routing or radio lifecycle.

## 3. Persistence and atomicity contract

### Native asymmetric private keys

Persist only opaque `PrivateKeyHandle` records in ordinary security metadata. The actual Ed25519/X25519 private key must remain owned by the configured `CryptoProvider`. Production code must not export identity or handshake private keys solely to satisfy this interface.

`LocalIdentityKeyHandles` contains the current signing/agreement handles and key epoch. `PendingHandshakeRecord` contains an ephemeral X25519 handle. The provider must be able to resolve these handles after process restart until they are explicitly deleted.

### Symmetric secrets

Persist through `SecureSecretStore`:

- direct-session send/receive AES keys;
- group/convoy root epoch keys.

These values must not enter React state, Redux, AsyncStorage, logs, analytics, crash reports or plaintext files.

### Durable metadata

Persist through `SecurityMetadataStore`:

- local public identity and current private-key handles;
- peer trust/fingerprint history;
- pending and consumed handshake IDs;
- direct-session metadata/state;
- group membership/key-epoch metadata;
- nonce counters and protected high-watermarks;
- replay windows.

Atomicity requirements are part of the interface contract, not implementation advice:

- `reserveNonceCounter(scope, minimumHighWatermark)` atomically compares the stored counter against the protected high-watermark, increments, durably commits, then returns the reservation. Concurrent calls must never return the same counter.
- `advanceNonceHighWatermark()` is atomic, durable and monotonic-max only. A lower write must never reduce the watermark.
- The high-watermark should be stored in a persistence/rollback domain independent from ordinary app metadata where the platform supports that distinction.
- `acceptReplayCounter()` atomically updates and durably commits the entire replay window before returning `true`.
- `consumeHandshakeId()` atomically accepts a handshake ID once and rejects duplicates.

If a nonce counter is detected below its high-watermark, Security v1 throws `COUNTER_ROLLBACK` and retires the affected direct session or revokes the affected group epoch key. It never attempts to continue with a potentially reused AES-GCM nonce.

A coordinated restoration that rolls back **both** ordinary counter state and the protected high-watermark to the same old snapshot cannot be detected by software alone. Native implementations should use the strongest platform rollback-resistant storage available; hardware monotonic counters are not universally available.

## 4. Future firmware interoperability requirements

Firmware implementing Security v1 must match:

1. Ed25519 signatures with raw 32-byte public keys.
2. X25519 key agreement with raw 32-byte public keys.
3. SHA-256 and HKDF-SHA-256.
4. AES-256-GCM with 96-bit nonces and 128-bit authentication tags.
5. Length-prefixed transcript encoding and domain strings in `src/security/transcripts.ts` exactly.
6. Identity fingerprint, pairing, identity-rotation and direct-session handshake transcripts exactly.
7. Highest-mutual-version selection and downgrade rejection exactly.
8. Direct/group AEAD associated-data construction exactly.
9. Durable per-key send counters and persisted replay windows.
10. Group sender-subkey derivation and group epoch membership enforcement.
11. The group-key distribution payload semantics if firmware participates in convoy/group key delivery; transport framing remains owned by the canonical protocol.

Use `docs/security-v1-test-vectors.json` and `__tests__/securityVectors.test.ts` as interoperability fixtures.

## 5. Remaining security decisions

These are intentionally outside the frozen API unless later evidence requires a versioned Security v2 change:

- exact Android StrongBox/Keystore and iOS Keychain/Secure Enclave capability/fallback matrix for Ed25519/X25519;
- device/app attestation policy;
- human fingerprint/QR verification UX and rules for deliberately re-pairing a revoked device;
- default session lifetime and optional message-count key-rotation threshold;
- device identity backup/recovery policy versus intentionally non-exportable device-bound identity;
- fleet-wide/offline revocation propagation policy;
- wall-clock/monotonic-time policy for expiry in long offline operation;
- post-quantum/hybrid migration plan;
- whether future native storage can provide true hardware-backed rollback counters on each supported platform.

No custom cipher, hash, MAC or PRNG should be introduced for these decisions.

## 6. Native-platform work still required

Replace/supplement these development implementations:

- `src/security/webCryptoProvider.ts`: implement Android and iOS `CryptoProvider`s that create and use non-exportable private keys by native handle. The public interface must remain handle-based.
- `SecretStoreWebCryptoKeyPersistence`: development/test compatibility only; do not use PKCS#8 persistence in production merely to mirror WebCrypto.
- `src/security/testing/InMemorySecurityStores.ts`: replace with production `SecureSecretStore` and `SecurityMetadataStore` implementations providing transactional nonce/replay/handshake semantics and protected nonce high-watermarks.

Higher-level `identity.ts`, `trust.ts`, `pairing.ts`, `session.ts`, `group.ts` and `versionPolicy.ts` are platform-neutral and should not need native-specific rewrites.

## Contract freeze rule

Integration branches should depend only on exports from `src/security/index.ts`. Do not import `bytes.ts`, `transcripts.ts`, `nonceReplay.ts` or test stores as runtime APIs. If future protocol work needs more context, add a narrow adapter around `SecurityProtocolContext` rather than moving protocol/radio responsibilities into this branch.
