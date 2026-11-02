# Security v1 Production Provider Requirements

This document defines the production implementation contract behind the transport-neutral Security v1 APIs. It does **not** implement a native provider and it does not change the Security v1 cryptographic profile.

## Required provider boundary

Production code implements the public `CryptoProvider`, `SecureSecretStore`, and `SecurityMetadataStore` ports exported by `src/security/index.ts`.

The canonical runtime must not depend on `WebCryptoProvider`, `WebCryptoKeyPersistence`, `SecretStoreWebCryptoKeyPersistence`, or the in-memory testing stores. Those adapters remain development/test utilities and are intentionally not exported from the runtime-facing barrel.

### `CryptoProvider`

A production provider must:

- implement the exact Security v1 primitives: Ed25519, X25519, SHA-256, HKDF-SHA-256, and AES-256-GCM with 128-bit tags;
- return raw 32-byte Ed25519/X25519 public keys;
- return only `PrivateKeyHandle` references for asymmetric private keys;
- resolve identity private-key handles across process restart until deletion;
- resolve pending ephemeral handles for the lifetime of a persisted handshake;
- keep asymmetric private-key bytes out of the JavaScript/TypeScript API;
- reject handles owned by another provider or with the wrong algorithm/purpose;
- return `false` from `hasPrivateKey` for deleted/unresolvable handles;
- fail closed with `KEY_NOT_FOUND` when `sign` or `deriveSharedSecret` receives an unavailable handle;
- make `deletePrivateKey` safe for cleanup after partial failures;
- never silently substitute P-256, RSA, another curve, another AEAD, or another protocol version under Security v1.

Provider-specific native error codes may be logged locally after redaction, but the public Security v1 boundary must surface a stable `SecurityError` classification.

## Android

Android implementations should use Android Keystore for non-exportable key custody when the target device/API supports the exact required primitive and key use. Hardware-backed status must be detected rather than assumed.

StrongBox is a preference only when the requested primitive is actually supported by that device's StrongBox/KeyMint implementation. Android's documented mandatory StrongBox algorithm subset is deliberately limited and includes P-256 rather than Ed25519/X25519, so Security v1 must not claim StrongBox backing merely because StrongBox exists.

Recommended provider behavior:

1. Probe the exact Ed25519/X25519 capability required by Security v1.
2. If a non-exportable Android Keystore key can implement the primitive, generate it natively and return a handle containing only a provider identifier plus native alias/reference metadata.
3. If StrongBox is requested and rejects the algorithm/key size, do not change the Security v1 algorithm. Follow the product security policy for fallback to ordinary Keystore or fail provider initialization.
4. If a supported Android version cannot provide a non-exportable native Ed25519/X25519 key, any software-key fallback must remain behind the same opaque provider handle and be protected at rest by a Keystore-backed wrapping key. It must never require PKCS#8 export into the Security v1 TypeScript layer. Whether that weaker fallback is allowed in production is a product policy decision.
5. Use `KeyInfo`/security-level inspection where available to record whether a generated key is software, TEE, or StrongBox backed for diagnostics/policy. Security v1 wire objects must not change based on that local classification.

## iOS

Use CryptoKit/Security.framework behind a native provider. Security v1 requires Curve25519 signing/key-agreement semantics (Ed25519/X25519); do not substitute Secure Enclave P-256 keys under version 1.

Current Apple APIs distinguish Curve25519 keys from Secure Enclave key types. Curve25519 CryptoKit keys do not have a direct Keychain `SecKey` corollary on all supported systems; Apple documents storing those key representations as protected Keychain items. Therefore:

1. Prefer a truly non-exportable native key reference if a supported OS/API provides the exact Ed25519/X25519 operation required by Security v1.
2. Otherwise keep Curve25519 private material entirely inside the native provider and protect its serialized representation in Keychain with the strongest appropriate accessibility/access-control policy. The TypeScript layer still receives only `PrivateKeyHandle`.
3. Do not label Curve25519 identity keys as Secure Enclave-backed unless the actual OS API performs that exact primitive inside Secure Enclave.
4. A future Security version may add a different hardware-native algorithm profile; that must be versioned rather than silently changing Security v1.

## Protected symmetric-secret storage

`SecureSecretStore` holds direct-session send/receive AES-256 keys and group root epoch keys. Production storage must:

- encrypt/protect values at rest with platform facilities;
- be app-private and unavailable to ordinary backup/export paths unless the product explicitly accepts that recovery model;
- never use AsyncStorage, React state, Redux, plaintext SQLite columns, logs, analytics, or crash-report fields;
- return independent byte buffers so callers can wipe temporary copies;
- make delete durable enough that retired/revoked key references cannot be resolved after successful deletion;
- define failure behavior for unavailable device credentials, Keychain/Keystore invalidation, restore onto another device, and protected-data-unavailable states.

A native implementation may use a platform-keystore wrapping key to encrypt symmetric blobs stored in a transactional database. Security v1 does not require the symmetric AES keys themselves to be hardware-non-exportable, because its AEAD port currently accepts key bytes; changing that would require a future versioned provider extension.

## Metadata and rollback protection

`SecurityMetadataStore` is not a generic key/value store. Production implementations must provide the semantics stated on the interface:

- `setLocalIdentity(identity, handles)` atomically commits the public identity and the matching handle set. A crash must not expose one without the other.
- `consumeHandshakeId` is atomic and accepts a handshake ID at most once.
- `reserveNonceCounter` is atomic across threads/tasks/process access to the same store and durably commits before returning.
- `advanceNonceHighWatermark` is monotonic-max only and durably committed.
- `acceptReplayCounter` atomically commits the entire replay-window transition before returning success.
- session/group state transitions used for revocation/rotation must be durable before the runtime treats the operation as complete.

The nonce counter and its protected high-watermark should be placed in different rollback domains where practical. If both can be restored to the same historical snapshot, software cannot prove rollback did not happen.

## Corruption and recovery behavior

Production adapters must fail closed rather than silently re-keying when persistent security state disagrees:

- identity exists but handle metadata is absent -> `IDENTITY_CORRUPT`;
- handle metadata exists but identity is absent -> `IDENTITY_CORRUPT`;
- handle belongs to another provider or native alias is deleted -> `IDENTITY_CORRUPT` at identity recovery, `KEY_NOT_FOUND` for an ephemeral pending handshake;
- session/group metadata exists but the referenced symmetric secret is missing -> `KEY_NOT_FOUND`;
- nonce counter below protected high-watermark -> `COUNTER_ROLLBACK`, followed by retirement/revocation of the affected key scope;
- malformed/corrupt serialized metadata must never be interpreted using permissive defaults that could reuse a key/nonce or resurrect trust.

Application-level recovery from identity corruption requires an explicit product flow (for example, device identity reset and re-pairing). Security v1 deliberately does not auto-delete corrupted identity state because doing so could hide rollback or unauthorized key replacement.

## Native integration test matrix

Each production adapter should run the common Security v1 integration suite against a native-backed test implementation plus platform-specific tests covering:

- key generation -> process restart -> handle resolution;
- key deletion -> `hasPrivateKey === false` and operation failure;
- wrong-provider/wrong-purpose handles;
- atomic local identity commit under injected crash/failure;
- concurrent nonce reservation from multiple tasks;
- simulated ordinary metadata rollback while protected high-watermark remains advanced;
- replay-window durability across process restart;
- symmetric-secret deletion after session/group retirement;
- device-lock/protected-data-unavailable behavior;
- backup/restore or app reinstall behavior according to the chosen product policy.

The native adapter is production-ready only when these semantics hold without changing the public Security v1 objects or wire cryptographic profile.
