# BushMesh Security v1 Threat Model

## Scope

Security v1 protects BushMesh device identity, peer trust, direct-message confidentiality/integrity, convoy/group key custody, replay resistance and downgrade resistance. It is transport-neutral: radio framing, routing, RF availability and convoy application behavior are outside this component.

## Attacker assumptions

Assume an attacker can:

- passively monitor all LoRa/BLE/network traffic;
- inject, drop, delay, duplicate, reorder and modify security payloads and encrypted messages;
- replay old pairing proofs, handshakes, direct messages, group messages and group-key distributions;
- present malformed input and unsupported/lower protocol versions;
- modify unauthenticated/mutable protocol headers in transit;
- learn public device IDs, public keys, fingerprints and group identifiers;
- temporarily partition devices so revocation/key-rotation information arrives late;
- obtain a stale copy of ordinary application metadata/storage;
- compromise a trusted peer and use that peer's currently available keys until revocation/rotation reaches other devices.

For the primary guarantees, assume the local OS crypto implementation, CSPRNG and production native key/secret stores are not currently compromised and the attacker cannot extract non-exportable private keys from them.

## Protected assets

- persistent Ed25519 signing private key;
- persistent X25519 agreement private key;
- ephemeral direct-session X25519 private keys;
- direct-session AES keys;
- convoy/group root epoch keys and derived sender keys;
- trust/revocation state;
- local identity-to-private-key-handle binding;
- nonce uniqueness state and replay windows;
- negotiated security/protocol versions and authenticated immutable protocol headers.

## Security guarantees

When assumptions hold, Security v1 provides:

- stable cryptographic device identity with signed sequential rotation;
- atomic persistence of the local public identity and its matching opaque private-key handles;
- explicit peer trust and fail-closed revoked-peer handling;
- authenticated ephemeral X25519 direct-session establishment bound to trusted Ed25519 identities;
- AES-256-GCM confidentiality and integrity for direct and group traffic;
- authenticated binding of selected versions and caller-supplied canonical protocol headers;
- replay rejection using durable receive windows;
- nonce reuse prevention through atomic monotonic reservations and protected high-watermarks;
- fail-closed retirement of a session/group epoch when nonce-counter rollback is detected;
- per-sender group subkeys so different group senders do not share an AES-GCM nonce namespace;
- group-key delivery only inside an established authenticated direct session, bound to sender, recipient, group, epoch and membership state;
- rejection of duplicate consumed direct-session offers and downgrade selections;
- fail-closed direct traffic when revocation or identity rotation becomes visible while an operation is in flight.

## Non-goals

Security v1 does not provide:

- RF jamming/denial-of-service resistance or guaranteed delivery;
- anonymity, traffic-analysis resistance or hiding device/group identifiers;
- location privacy if the application chooses to send location;
- trust establishment without a trustworthy user/application verification step;
- protection after the local device OS/runtime is fully compromised while keys are usable;
- protection from malicious behavior by a currently trusted group member possessing the current group key;
- global real-time revocation across disconnected partitions;
- a network revocation-authority/distribution protocol;
- a backup/recovery protocol for device identity;
- post-quantum security;
- firmware/device attestation;
- detection of a perfectly coordinated rollback that restores both normal counter persistence and its protected high-watermark to the same prior snapshot when the platform exposes no non-rollbackable counter.

## Compromise and recovery behavior

### Peer device suspected or lost

1. Mark the peer revoked with `PeerTrustManager.revoke()`.
2. Call `DirectSessionManager.revokeSessionsForPeer()` to durably retire/delete all local direct-session keys for that device.
3. Remove/revoke the peer from each group and rotate the affected group epoch.
4. Redistribute the replacement group epoch only to active members over fresh/active direct sessions.

After trust is marked revoked, new handshakes and stale session use fail even before session-secret cleanup completes. An in-flight direct encryption/decryption operation re-checks session/trust usability before returning protected output/plaintext.

Previously captured ciphertext remains protected unless the relevant historical key was compromised. A compromised peer that already possessed a group epoch key may read traffic from that epoch; rotation limits future access.

### Peer identity rotates legitimately

Verify/apply the signed sequential `IdentityRotationProof`. Existing direct sessions remain bound to the old peer fingerprint and immediately fail as `ROTATED_KEY`; call `rotateSessionsForPeer()` to durably delete stale session secrets, then establish new direct sessions bound to the new fingerprint. Existing group membership records referencing the old fingerprint must be refreshed through an authenticated membership/key-rotation flow before accepting traffic under the new identity.

### Local nonce rollback/corruption detected

Treat `COUNTER_ROLLBACK` as key compromise risk, not a recoverable counter error. The affected direct session is revoked; the affected group epoch is revoked/deleted. Establish a fresh session or rotate the group key before sending again.

A failed protected high-watermark write after an ordinary counter reservation burns that reserved counter. Recovery advances to a later counter rather than reusing the failed reservation.

### Local identity metadata mismatch

`SecurityMetadataStore.setLocalIdentity()` must atomically store the public identity and matching key-handle metadata. If startup nevertheless observes only one side, or the referenced private key no longer exists/belongs to the configured provider, initialization fails as `IDENTITY_CORRUPT`. Do not silently manufacture replacement keys under the same device identity.

### Local asymmetric private key unavailable

If public identity metadata references a private-key handle that the configured `CryptoProvider` cannot resolve, initialization fails as `IDENTITY_CORRUPT`. If a persisted pending handshake loses its ephemeral private-key handle, completion fails as `KEY_NOT_FOUND`; the runtime may explicitly abort that pending handshake and start a fresh one.

### Local device compromise

Revoke that device identity from peers, rotate all groups it belonged to, and establish replacement identity/trust as policy permits. Security v1 does not claim forward secrecy after compromise of a currently active session key, nor backward secrecy for group epochs already disclosed to the compromised member.
