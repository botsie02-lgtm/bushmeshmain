# BushMesh Security & Identity v1 Integration

Branch: `foundation/security-identity-v1`

This subsystem is deliberately independent of the BushMesh radio runtime, transport framing, convoy routing and MeshCore compatibility layers. It defines security services and a very small protocol-binding surface only. The canonical BushMesh protocol/runtime should transport the security objects and provide canonical authenticated header bytes; it should not copy or reimplement the cryptography.

## Cryptographic profile

Security v1 uses platform cryptography through `CryptoProvider`. The included `WebCryptoProvider` implements Ed25519 signatures, X25519 Diffie-Hellman, HKDF-SHA-256, SHA-256 and AES-256-GCM. Device public keys are raw 32-byte Ed25519/X25519 values encoded as base64url. Private keys are PKCS#8 bytes only inside the secure-secret abstraction and transient local variables, which are wiped after use where practical.

AES-GCM nonces are 96 bits: a four-byte namespace prefix plus a durable 64-bit monotonic counter. Direct sessions authenticate a random per-direction prefix in the signed handshake. Group traffic derives a different AES key for every sender and group epoch, so senders can safely use independent monotonic counters without sharing a nonce allocator. Production counter reservation must be atomic and persisted before encryption.

## 1. Public security APIs

The public barrel is `src/security/index.ts`.

- `IdentityManager`: creates or recovers the persistent device identity, signs data, verifies identity material and creates signed key-rotation proofs.
- `PeerTrustManager`: records observed peers, requires explicit fingerprint confirmation before trust, rejects duplicate/unproven identities, revokes peers and applies signed identity rotations.
- `PairingService`: creates and verifies challenge-bound signed pairing proofs without defining any radio or network framing.
- `DirectSessionManager`: creates/accepts/finalizes authenticated ephemeral X25519 session handshakes, encrypts/decrypts direct traffic, enforces peer trust, nonce uniqueness, replay protection, expiry and session retirement.
- `GroupKeyManager`: creates, installs, rotates and revokes convoy/group keys and encrypts/decrypts group traffic with per-sender subkeys.
- `VersionPolicy`: negotiates the highest mutually supported security and canonical-protocol version and rejects lower selections as downgrade attempts.
- `WebCryptoProvider`: development/platform WebCrypto adapter. It is not a secure-storage implementation.
- `SecureSecretStore` and `SecurityMetadataStore`: replaceable persistence ports.
- `SecurityProtocolContext`: the only protocol-facing message context required by encryption APIs: the selected canonical protocol version plus canonical immutable header bytes to authenticate as AEAD associated data.

`src/security/testing/InMemorySecurityStores.ts` is test/development-only and must never be used to persist production secrets.

## 2. What the BushMesh protocol/runtime must call

The canonical runtime should initialize `IdentityManager` during application start, then use `PairingService` and `PeerTrustManager` for peer enrollment. It should transport `PairingProof`, `SessionOffer` and `SessionResponse` as opaque security payloads rather than creating another handshake implementation.

For direct messages, call `DirectSessionManager.encrypt()` before radio framing and `DirectSessionManager.decrypt()` after frame validation. Supply `SecurityProtocolContext.authenticatedHeader` as the canonical byte representation of all immutable routing/header fields that must not be altered without detection. The same exact bytes must be reproducible by firmware and the receiving app.

For convoy/group traffic, call `GroupKeyManager.encrypt()` / `decrypt()`. Group root keys should be distributed only through an already-authenticated direct session or an equivalent authenticated key-wrapping mechanism. Do not send a raw group key in plaintext and do not expose it to UI state.

When a peer is revoked, call `PeerTrustManager.revoke()` and retire any live direct sessions. When device keys rotate, apply the signed `IdentityRotationProof`; sessions bound to the old fingerprint will automatically fail and must be re-established. When membership changes, rotate the group key.

The runtime should not use security-version fields from untrusted traffic to choose a lower algorithm. It should let `VersionPolicy` validate the signed handshake result, and it must reject a `SecurityProtocolContext.protocolVersion` that differs from the selected session/group version.

## 3. What the app must persist

### Secure / hardware-backed secret storage

Persist only through `SecureSecretStore`:

- current Ed25519 private signing key,
- current X25519 private agreement key,
- pending ephemeral X25519 handshake private keys,
- direct-session send and receive AES keys,
- group/convoy root keys.

Production storage should be Android Keystore / StrongBox where available and iOS Keychain/Secure Enclave or the closest platform-supported hardware-backed design. Secret values must not be copied into Redux, React state, AsyncStorage, logs, analytics, crash reports or plaintext files.

### Durable non-secret metadata

Persist through `SecurityMetadataStore`:

- public local identity and fingerprint,
- peer trust records and fingerprint history,
- pending handshake metadata,
- direct-session metadata and expiry/state,
- group membership and key-epoch metadata,
- nonce counters,
- replay-window state.

Nonce counter reservation and replay-window updates require atomic durable operations. A database rollback that can restore an old nonce counter must be treated as a security event: retire the affected key/session rather than risk nonce reuse.

## 4. What future firmware must implement

Firmware interoperating with Security v1 must implement the same primitive profile and canonical encodings:

1. Ed25519 signatures with raw 32-byte public keys.
2. X25519 ephemeral key agreement with raw 32-byte public keys.
3. SHA-256 and HKDF-SHA-256.
4. AES-256-GCM with 96-bit nonces and 128-bit authentication tags.
5. The length-prefixed transcript encoding in `src/security/bytes.ts` and domain strings in `src/security/transcripts.ts` exactly.
6. Identity fingerprints, signed pairing proofs, session-offer/session-response transcripts and version negotiation exactly.
7. Direct-message/group-message AEAD associated-data construction exactly.
8. Durable per-key send counters and replay protection.
9. Peer trust/revocation enforcement and signed sequential identity rotation.
10. Group sender-subkey derivation before group AEAD encryption.

Use `docs/security-v1-test-vectors.json` and the Jest vector tests as interoperability fixtures. Firmware should pass those vectors before live radio interoperability testing begins.

## 5. Remaining security decisions

The following decisions should be made before calling the design production-final:

- **Native key custody:** exact Android/iOS key-generation and non-exportability strategy. The WebCrypto adapter exports PKCS#8 private keys so it can satisfy the generic secure-store port; a native provider should prefer non-exportable key handles.
- **Attestation:** whether BushMesh should use Android hardware attestation / Apple App Attest or another device-attestation layer. This is intentionally not required for v1 identity.
- **Trust UX:** the exact human verification flow for fingerprints/QR codes and rules for re-trusting a previously revoked device.
- **Group key distribution:** canonical protocol message types for wrapping and distributing a new group epoch key to active members.
- **Clock policy:** direct-session expiry currently uses local wall-clock time. Native integration may add monotonic-time checks or signed time sources where available.
- **Session lifetime / rotation cadence:** the default is seven days, but field testing may justify a shorter value or message-count-based rotation.
- **Backup/restore:** decide whether device identity is intentionally non-exportable and lost on device reset, or whether a separately designed encrypted recovery mechanism is required.
- **Post-quantum migration:** retain crypto-provider/version agility so a later hybrid handshake can be introduced without changing the transport/radio subsystem.
- **Compromise recovery:** define fleet-wide revocation distribution and emergency group-key rotation behavior for offline/partitioned convoys.

No custom cipher, hash, MAC or random-number generator should be introduced to solve these decisions.

## 6. Files eventually replaced by native secure-storage implementations

The following are intentionally replaceable boundaries:

- `src/security/webCryptoProvider.ts`: may be replaced or supplemented by Android/iOS native crypto providers that keep identity private keys non-exportable and address them by native handles.
- `src/security/testing/InMemorySecurityStores.ts`: must never ship as production persistence. Replace `InMemorySecretStore` with platform secure storage and `InMemorySecurityMetadataStore` with durable app/database storage implementing atomic nonce and replay operations.

The higher-level files (`identity.ts`, `trust.ts`, `pairing.ts`, `session.ts`, `group.ts`, `versionPolicy.ts`) should remain platform-neutral and consume only the interfaces in `ports.ts`.

## Integration rule

Do not copy code from `feature/bushmesh-lora-protocol` or `foundation/radio-core-v1` into this subsystem. When the branches are integrated later, adapt the canonical protocol/runtime to these public APIs or provide a narrow adapter that produces `SecurityProtocolContext`; do not create a competing networking, radio, convoy or MeshCore runtime here.
