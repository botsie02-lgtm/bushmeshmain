# Wave 4: required Android production crypto/storage integration ports

**Status:** DESIGN/TEST PLAN ONLY. No production key provider or durable v2 security transaction layer is claimed in Wave 4 staging.

## Existing exact Security v1 surface

`src/security/types.ts` exposes `PrivateKeyHandle {provider,id,algorithm,purpose}` and `LocalIdentityKeyHandles` with a stable key epoch. `src/security/ports.ts` already defines `CryptoProvider`, `SecureSecretStore`, `SecurityMetadataStore` and `SecurityClock`. Implement those contracts rather than inserting secrets in React Native state, AsyncStorage, map catalog or BLE settings.

| Interface/port method | Production proof required |
|---|---|
| `CryptoProvider.generateSigningKeyPair('identity-signing')` | Exact Ed25519, 32-byte raw public key, opaque non-exportable private handle; 64-byte deterministic signature verified across provider recreation and process death |
| `generateAgreementKeyPair('identity-agreement'/'session-ephemeral')` | Exact X25519 and raw 32-byte wire key; actual key agreement symmetry/known vector, ephemeral deletion and 32-byte shared-secret shape |
| `hasPrivateKey`, `deletePrivateKey` | Provider-namespaced alias, stable after restart, deletion idempotent, missing/wrong-purpose handle rejects; no exported PKCS#8 or private bytes to JS |
| `sign`, `verify`, `deriveSharedSecret` | Signature validation and auth failures on wrong key/algorithm/purpose; actual native provider backed by supported mechanism |
| `randomBytes`, `sha256`, `hkdfSha256`, `aeadEncrypt/Decrypt` | OS CSPRNG, SHA-256/HKDF test vectors, AES-GCM authenticated AAD/nonce/tag equivalence, rejects on tamper; no JavaScript plaintext key logging |
| `SecureSecretStore.set/get/deleteSecret` | App-private authenticated encryption under Android Keystore-derived/wrapped protection; no plaintext at rest, no backup export, deletion and crash/restart semantics, zeroization best effort |
| `SecurityMetadataStore.setLocalIdentity` | Atomically commit matching public identity and both handles; no half-initialized state/identity swap after crash |
| `getIdentity/getIdentityKeyHandles` | Invariant checking on every startup: current key epoch and both native aliases physically resolve before returning identity |
| `setPeer/getPeer/listPeers`, pending handshakes/sessions | Durable trust/rotation/revocation/session/handshake state with integrity and invalidations; never treat a contact name or channel PSK as trust |
| `consumeHandshakeId` | Durable, atomic one-time replay rejection across concurrent calls/restart |
| `reserveNonceCounter`, `advanceNonceHighWatermark`, `getNonceHighWatermark` | Monotonic compare-and-reserve with durable commit BEFORE encryption; rollback/backup/power-loss checks |
| `acceptReplayCounter` | Atomic durable replay window; reject duplicate, too-old and out-of-order replay across process death |
| `getGroup/setGroup` | v1 data access only. **NOT** a v2 authorized, atomic roster/key epoch transaction |

The current `WebCryptoProvider` and `SecretStoreWebCryptoKeyPersistence` have **development/test** PKCS#8 persistence behavior; they cannot establish non-exportable production identity. The native `BushMeshPersistenceModule` protects app UI/radio/map preferences with Keystore-backed AES-GCM, but this is **not equivalent** to a Security v1/v2 crypto provider and does not implement the above security metadata commit protocol.

## Recommended isolated native boundary

A new *separate* versioned security bridge/package may expose opaque handles and restricted methods; it must not replace `BushMeshRadioServicePackage` ownership or mutate its existing BLE service. Proposed capability discovery (read-only):

- `probeSecurityCapabilities()`: Android API/device build, signing/agreement algorithms genuinely usable via AndroidKeyStore/JCA/native provider, raw-key conversions and hardware level/attestation where available. Report **unsupported** honestly and never silently substitute a different algorithm.
- `createIdentity()/sign()/agree()/verify()`: opaque persistent key handles with strict purpose/provider namespaces and no raw private-key access; sign and agreement must work after native module re-instantiation. No fake crypto fallback.
- `get/store/deleteSecret()`: authenticated encryption under suitable hardware-/Keystore-protected key; actual atomic file commit or journal, restricted app-private storage, clear error semantics.
- `getIdentity/commitIdentityAndHandles()`, `reserveNonce/acceptReplay/consumeHandshakeId()`: validated atomic journal/database persistence, serializable concurrent operations, anti-rollback monitoring; no swallowed security exceptions.
- A **new additive Security v2 transaction port**, not `setGroup`, for `prepare/commit/CAS` of roster+key+epoch+monotonic high-water, recipient install+ACK, recovery and invalidations.

No bridge registration is authorized by this document. Audit user authentication requirements so key operations are not unexpectedly blocked by screen-off field use; never weaken intended authorization just to hide hardware errors.

## Hardware/security-level matrix — mandatory tests

- Separate **available algorithm** from **stored-in-hardware** and **StrongBox-protected**. Query `KeyInfo.getSecurityLevel` (API 31+) and inspect attestation chain with trusted roots/challenge where supported; do not infer backing from an alias or an API version. Record `TRUSTED_ENVIRONMENT`, `STRONGBOX`, `SOFTWARE` or **unknown** per key and operation.
- Android 13 KeyMint HAL added Curve25519 signing/agreement support, but Java `AndroidKeyStore` provider/device support varies; verify actual `KeyPairGenerator`, `Signature` and `KeyAgreement` operations and wire format on the Galaxy S22+ and second Android device. StrongBox's documented required subset includes RSA, AES, P-256 ECDSA/ECDH and HMAC, not a blanket Ed25519/X25519 guarantee.
- Unsupported exact Ed25519/X25519 native operation is **PRODUCTION SECURITY UNAVAILABLE** until an independently reviewed, equivalently protective implementation with unchanged public wire formats is provided. Never claim a software-generated key wrapped at rest is non-exportable at runtime.
- Prefer Android Keystore-generated AES-GCM for secret wrapping where supported; verify IV uniqueness, AAD, tag failure and restored key alias. Do not reuse the UI-persistence alias for group keys or secret counters.
- Attestation is stronger evidence than self-reported KeyInfo but must be verified against current root and revocation status; absence of remote attestation is not evidence of StrongBox.
- StrongBox/TEE do not by themselves prove atomic cross-file group transactions, anti-reinstall rollback or secure time. Document actual monotonic storage limitations.

## Mandatory native test matrix before any activation

| Scenario | Required result |
|---|---|
| Fresh first-run then reinstantiate module / force-stop / reboot | Same identity fingerprint, public keys and handles; signing and key agreement still work |
| API/device feature probes including unsupported StrongBox/Ed25519/X25519 | Honest capabilities; unsupported returns explicit failure and never a spoofed hardware-backed badge |
| Wrong provider/alias/purpose/algorithm, corrupt/missing private-key alias | Fail closed, KEY_NOT_FOUND/typed error; no identity regeneration masquerading as an existing node |
| Group secret read after process death; deleted secret after restart | Correct secret restored only while authorized; deleted references cannot decrypt |
| 100 parallel nonce reservations and replay counter races | Distinct monotonic durable reservations, duplicates never accepted |
| Abrupt process death at each identity/secret/epoch journal phase | Either old complete state or new complete state; no half commit/no reused nonce/epoch |
| Restore stale backup, app data corruption, failed storage/fsync | Fail closed, invalidate affected sessions/groups and do not silently reset counters |
| Key rotation, peer revocation and reinstall | Old handles unavailable as appropriate; re-pairing required, no stale authorizations |
| RN bridge messages and logs | No raw keys, passwords, group secrets, full ciphertext snapshots or precise GPS leak into logs |

CI `:app:testDebugUnitTest` must run any new native security JVM tests plus full TypeScript/Jest/integration gates. Instrumentation on actual devices is additionally required; JVM mocks or an emulator cannot prove StrongBox hardware, true non-exportability or restart durability.

**Reference:** https://developer.android.com/privacy-and-security/keystore and https://source.android.com/docs/security/features/keystore .
