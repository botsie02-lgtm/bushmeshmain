# BushMesh Security & Identity v1 Integration Contract

Branch: `foundation/security-identity-v1`

Status: **frozen integration contract candidate** for the canonical BushMesh protocol/runtime. Security v1 remains transport-neutral: it creates/verifies security objects and protects payload bytes, while the protocol/runtime owns packet encoding, routing, retries, discovery, fragmentation, radio/BLE transport and application semantics.

The runtime-facing barrel is `src/security/index.ts`. Integration branches should import only from that barrel. WebCrypto development/test adapters, transcript encoders, nonce/replay helpers and in-memory stores are intentionally not part of the runtime-facing public API.

## Cryptographic profile

Security v1 uses Ed25519 signatures, X25519 key agreement, SHA-256, HKDF-SHA-256 and AES-256-GCM with 128-bit tags. Public Ed25519/X25519 keys are raw 32-byte values encoded as base64url.

Asymmetric private keys are owned by `CryptoProvider` and addressed only through `PrivateKeyHandle`. Higher layers never require PKCS#8/private-key bytes. See `SECURITY_PROVIDER_REQUIREMENTS.md` for Android/iOS/storage requirements.

AES-GCM nonces are 96 bits: a four-byte namespace prefix plus a durable monotonic 64-bit counter. Direct sessions authenticate per-direction nonce prefixes in the signed handshake. Group traffic derives a distinct sender key for each `(groupId, epoch, senderDeviceId)` tuple.

# 1. Frozen transport-neutral objects

These are the Security v1 objects the canonical protocol/runtime may transport or supply.

## Pairing / trust establishment

### Runtime -> Security

- a fresh pairing challenge (`Uint8Array`, at least 16 bytes) supplied to `PairingService.createProof()` / `verifyProof()`;
- a received `PairingProof`;
- the user/admin-confirmed expected fingerprint supplied to `PeerTrustManager.trust()`.

### Security -> runtime / transport

`PairingProof`:

- `identity: DeviceIdentity`
- `challenge`
- `supportedSecurityVersions[]`
- `supportedProtocolVersions[]`
- `issuedAt`
- `signature`

The runtime transports the `PairingProof` as a security payload without rewriting its fields. `verifyProof()` verifies challenge binding, age, identity integrity, signature and version compatibility. Trust is not granted automatically: call `PeerTrustManager.observe()` then `trust(deviceId, expectedFingerprint)` only after the product's pairing confirmation policy succeeds.

The pairing version lists advertise compatibility. The actual direct-session selection is made by the signed direct-session handshake below.

## Direct-session handshake

### Initiator

1. Runtime calls `DirectSessionManager.createOffer(peerDeviceId)`.
2. Security returns `SessionOffer`.
3. Runtime transports the offer verbatim as a security payload.

`SessionOffer` contains:

- `handshakeId`
- full initiator `DeviceIdentity`
- `responderDeviceId`
- ephemeral X25519 public key
- handshake nonce
- sender nonce prefix
- supported Security versions
- supported canonical protocol versions
- `issuedAt`
- Ed25519 signature

### Responder

1. Runtime passes the received `SessionOffer` to `acceptOffer()`.
2. Security validates target identity, peer trust, offer signature, freshness and version compatibility.
3. Security atomically consumes the handshake ID.
4. Security returns `{ response: SessionResponse, session: DirectSessionRecord }`.
5. Runtime transports only `SessionResponse`; `DirectSessionRecord` is local state, not a wire object.

`SessionResponse` contains:

- the same `handshakeId`
- full responder `DeviceIdentity`
- `initiatorDeviceId`
- responder ephemeral X25519 public key
- responder handshake nonce
- responder nonce prefix
- `selectedSecurityVersion`
- `selectedProtocolVersion`
- `issuedAt`
- signature over the complete offer plus response selection

### Initiator completion

Pass the received `SessionResponse` to `finalizeOffer()`. Security checks that the selected versions are exactly the highest mutually supported versions allowed by local minimum policy, verifies the signed transcript and derives/persists the session keys.

`DirectSessionRecord` is persistence/provider state and must not be serialized as a protocol packet.

## Encrypted direct traffic

### Runtime -> Security

`DirectSessionManager.encrypt(sessionId, plaintextBytes, SecurityProtocolContext)`.

### Security -> runtime / transport

`EncryptedDirectMessage`:

- `securityVersion`
- `protocolVersion`
- `sessionId`
- `keyEpoch`
- decimal-string `counter`
- base64url `ciphertext` (AES-GCM ciphertext plus authentication tag)

The protocol may wrap this object in its own packet/frame encoding. It must not rewrite the protected object's fields.

On receive, parse the object and call `decrypt(envelope, context)`. Security authenticates the protocol AAD before accepting replay state and returns plaintext bytes only after the session is still usable.

## Group / convoy encrypted traffic

### Runtime -> Security

`GroupKeyManager.encrypt(groupId, plaintextBytes, SecurityProtocolContext)`.

### Security -> runtime / transport

`EncryptedGroupMessage`:

- `securityVersion`
- `protocolVersion`
- `groupId`
- `epoch`
- `senderDeviceId`
- decimal-string `counter`
- base64url `ciphertext`

The current group epoch, sender membership/fingerprint, protocol version, AAD and replay window are checked on decrypt.

## Authenticated group-key distribution

Group keys are never returned as raw transport payloads.

Leader runtime calls:

`GroupKeyManager.wrapActiveKeyForPeer(groupId, recipientDeviceId, sessionId, sessions, context)`

Security returns `WrappedGroupKeyDistribution`:

- `distributionVersion: 1`
- `groupId`
- `epoch`
- `senderDeviceId`
- `senderFingerprint`
- `recipientDeviceId`
- `recipientFingerprint`
- `securityVersion`
- `protocolVersion`
- `sessionId`
- `encryptedPayload: EncryptedDirectMessage`

The actual group key, complete membership snapshot and group identity metadata exist only inside `encryptedPayload`, protected by the authenticated direct session. The receiver passes the complete object to `installWrappedGroupKey()`.

Security rejects wrong recipient/sender identity, untrusted peers, wrong direct session, modified outer/package metadata, unsupported versions, duplicate/replayed distribution and epochs that do not advance an existing group.

## Peer identity rotation

The rotating device calls `IdentityManager.rotateKeys()` and transports the resulting `IdentityRotationProof`:

- `previousFingerprint`
- `nextIdentity`
- `rotatedAt`
- signature made by the previous identity signing key

Receiver calls `PeerTrustManager.applyRotation(proof)`. A valid sequential signed rotation preserves trust and moves the previous fingerprint into history.

Existing sessions remain cryptographically bound to the old peer fingerprint and immediately become unusable: attempts surface `ROTATED_KEY`. The runtime should then call `DirectSessionManager.rotateSessionsForPeer(deviceId)` to durably clean up stale session secrets and establish a new session against the new fingerprint.

## Peer revocation / session retirement

Security v1 does **not** define a network revocation-notice object or an authority/fleet revocation protocol. Revocation is a local trust decision:

1. `PeerTrustManager.revoke(deviceId, reason?)`
2. `DirectSessionManager.revokeSessionsForPeer(deviceId)`

After step 1, stale traffic already fails with `PEER_REVOKED`; step 2 durably marks sessions revoked and deletes their symmetric secrets. New offers, offer acceptance and session reuse from the revoked peer are rejected.

Do not accept an unauthenticated network message as a Security v1 revocation command. Fleet/offline revocation propagation requires a separately defined authority policy and is intentionally unresolved.

# 2. Canonical authenticated-data / AAD contract

The protocol/runtime supplies:

```ts
interface SecurityProtocolContext {
  protocolVersion: number;
  authenticatedHeader: Uint8Array;
}
```

`authenticatedHeader` is **not** a BushMesh frame owned or encoded by Security. It is the canonical byte encoding, defined by the protocol branch, of immutable end-to-end protocol metadata whose modification could change the interpretation, destination or policy of the protected message.

The sender and receiver must produce byte-for-byte identical `authenticatedHeader` values for the same protected object.

## Protocol fields that must be included when they exist outside the ciphertext

The canonical protocol AAD should include every immutable end-to-end field that affects semantics, including as applicable:

- protocol message/type discriminator;
- logical source identity/address if the protocol exposes one outside the Security object;
- logical destination device/group/channel identifier if immutable end-to-end;
- stable end-to-end message ID used for semantic deduplication/correlation;
- immutable application/protocol flags that affect interpretation or authorization;
- immutable creation/expiry value if the receiver makes security-relevant acceptance decisions from it;
- any other immutable header value that an attacker must not be able to rewrite while keeping the ciphertext valid.

The protocol branch owns the exact field list and serialization. Use a deterministic binary/canonical encoding; do not use ordinary JSON serialization unless the protocol specification makes ordering/number/string encoding canonical.

## Fields that should not be placed in end-to-end Security AAD

Do not include values that legitimate forwarding changes after encryption, such as:

- RSSI/SNR or receiver diagnostics;
- radio frequency/channel/bearer selection;
- local retry counters;
- mutable hop count, next-hop or relay path;
- local arrival timestamps;
- transport bookkeeping added after Security returns the encrypted object.

If the protocol fragments an already-encrypted Security object, post-encryption fragment headers are outside this Security v1 AAD contract. The protocol layer is responsible for making its reassembly/framing rules non-ambiguous and protecting any fragment metadata that requires integrity.

## What Security adds automatically

The caller does not need to duplicate Security-owned fields into `authenticatedHeader`. Security domain-separates and authenticates them internally.

For direct traffic Security AAD includes:

- `sessionId`
- selected Security version
- selected protocol version
- session key epoch
- nonce counter
- caller-supplied `authenticatedHeader`

For group traffic Security AAD includes:

- `groupId`
- `senderDeviceId`
- selected Security version
- group protocol version
- group epoch
- sender nonce counter
- caller-supplied `authenticatedHeader`

Any mismatch in the canonical authenticated header causes AEAD verification to fail with `AUTHENTICATION_FAILED`. Replay state is updated only after ciphertext/AAD authentication succeeds.

# 3. Version negotiation and downgrade protection

Version selection is Security-owned policy; transport never chooses a lower version by rewriting fields.

1. `PairingProof` signs both supported-version lists and `verifyProof()` requires at least one mutually acceptable Security version and protocol version.
2. `SessionOffer` signs both supported-version lists.
3. The responder selects the highest mutually supported version permitted by its minimum policy using `VersionPolicy`.
4. `SessionResponse` signs the entire offer plus both selected versions.
5. `finalizeOffer()` recomputes the expected highest-mutual selections; any lower/different selection is `DOWNGRADE_DETECTED`.
6. The selected Security/protocol versions are persisted in the session.
7. `EncryptedDirectMessage` repeats them and decrypt rejects any mismatch.
8. `SecurityProtocolContext.protocolVersion` must exactly equal the session/group selected protocol version; a mismatch is `DOWNGRADE_DETECTED`.
9. Group records fix their Security/protocol versions. Group messages and group-key distributions repeat those values and are rejected if they conflict.

A new incompatible cryptographic profile requires a new Security version. Do not silently swap algorithms underneath version 1.

# 4. Lifecycle and failure contract

Runtime code should branch on exported `SecurityErrorCode`, not error-message text.

Important integration failures:

- `AUTHENTICATION_FAILED`: signature, AEAD/AAD, identity binding or authenticated metadata failed.
- `DOWNGRADE_DETECTED`: selected/envelope/context version conflicts with the negotiated version.
- `UNSUPPORTED_VERSION`: no permitted mutually supported version exists.
- `PEER_NOT_TRUSTED`: peer is unknown/unverified for an operation that requires trust.
- `PEER_REVOKED`: local trust/session/group policy has revoked the peer.
- `ROTATED_KEY`: stale session/group epoch or a session bound to a previous peer fingerprint.
- `EXPIRED_KEY`: session/handshake key lifetime expired.
- `KEY_NOT_FOUND`: required ephemeral/session/group secret cannot be resolved.
- `IDENTITY_CORRUPT`: local persistent identity and opaque native key state disagree or identity metadata is malformed.
- `REPLAY_DETECTED`: duplicate/too-old counter, reused handshake or duplicate group-key delivery.
- `COUNTER_ROLLBACK`: persisted nonce counter is below its protected high-watermark; affected key scope is retired/revoked.
- `NONCE_EXHAUSTED`: the per-key nonce counter cannot safely advance.
- `INVALID_INPUT`: malformed object/encoding outside the accepted Security v1 shape.

Do not automatically retry authentication/downgrade/replay/counter-rollback failures with a weaker version or old key. Recovery normally means re-establishing a fresh session, rotating a group epoch, or explicit re-pair/reset policy.

# 5. Persistence and atomicity contract

### Local identity

`SecurityMetadataStore.setLocalIdentity(identity, handles)` is one atomic logical transaction. Production storage must never expose only the public identity or only the matching private-key handles after a crash.

At startup `IdentityManager.loadOrCreate()` behaves as follows:

- both identity and handles absent -> create a new identity;
- both present and matching -> recover;
- exactly one present -> `IDENTITY_CORRUPT`;
- referenced native handle unavailable/wrong provider -> `IDENTITY_CORRUPT`.

Security v1 deliberately does not auto-create a replacement identity on mismatch because that could hide rollback or unauthorized key replacement.

### Symmetric secrets

Persist through `SecureSecretStore`:

- direct-session send/receive AES keys;
- group/convoy root epoch keys.

See `SECURITY_PROVIDER_REQUIREMENTS.md` for production requirements.

### Durable metadata

Persist through `SecurityMetadataStore`:

- local identity + handles atomically;
- peer trust/fingerprint history;
- pending and consumed handshake IDs;
- direct-session metadata/state;
- group membership/key-epoch metadata;
- nonce counters and protected high-watermarks;
- replay windows.

`reserveNonceCounter`, `advanceNonceHighWatermark`, `acceptReplayCounter` and `consumeHandshakeId` have atomic/durable semantics defined directly on the public port. If a nonce counter is below its protected high-watermark, Security throws `COUNTER_ROLLBACK` and retires/revokes the affected key scope rather than risking AES-GCM nonce reuse.

# 6. Public API freeze

Runtime-facing classes:

- `IdentityManager`
- `PairingService`
- `PeerTrustManager`
- `DirectSessionManager`
- `GroupKeyManager`
- `VersionPolicy`

Runtime/provider-facing ports:

- `CryptoProvider`
- `SecureSecretStore`
- `SecurityMetadataStore`
- `SecurityClock`

Transport/integration types:

- `DeviceIdentity`
- `PairingProof`
- `SessionOffer`
- `SessionResponse`
- `EncryptedDirectMessage`
- `EncryptedGroupMessage`
- `WrappedGroupKeyDistribution`
- `IdentityRotationProof`
- `SecurityProtocolContext`
- `SecurityErrorCode`

Persistence/provider record types are exported because production `SecurityMetadataStore` implementations need them; they are not wire objects.

WebCrypto classes/interfaces are intentionally not exported from `src/security/index.ts`. Development/tests may import `src/security/webCryptoProvider.ts` directly, but production runtime code must not depend on WebCrypto exportability.

# 7. What Security v1 deliberately does not own

Security v1 does not define or implement:

- LoRa/radio/BLE packet framing;
- packet type numbers or canonical protocol header encoding;
- routing, flooding, convoy routing or next-hop decisions;
- fragmentation/reassembly strategy;
- discovery or presence;
- retries/ACKs/queue scheduling;
- GPS/location/map/application payload schemas;
- UI or pairing UX;
- fleet-wide revocation authority/distribution;
- radio firmware compatibility framing;
- transport message storage/retention.

The protocol/runtime should treat Security objects as payloads and supply canonical immutable AAD bytes; it should not duplicate signatures, key agreement, nonce/replay logic or group-key wrapping.

# 8. Interoperability fixtures

Firmware/native implementations must match the transcript domain strings and encodings in the internal Security v1 implementation. Use `docs/security-v1-test-vectors.json` and `__tests__/securityVectors.test.ts` as cryptographic interoperability fixtures.

If a future runtime needs a genuinely new security-relevant field that cannot fit the `SecurityProtocolContext` AAD boundary, add a versioned Security contract rather than importing internal transcript/byte helpers into protocol code.
