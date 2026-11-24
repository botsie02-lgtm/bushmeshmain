# Wave 5 W1 implementation selection — research decision R1

**Date:** 2026-11-24
**Decision ID:** W1-R1-2026-11-24-01
**Branch:** `feature/wave5-security-w1-experimental-v1`
**Exact research base:** `10f630bcd6ff3674b85a264cd22e512d1cb0066e`
**Verdict:** **NO-GO for private-key handling or a W1 executable provider in this work package.** Authorise **only a disconnected, testable refusal/policy-and-record-format research module**. No software private-key generation, encryption, sign, agreement, import, export, unseal, vault database, H1 fallback or APK publication is approved.

## Source review completed before this decision

Read `docs/SECURITY_CAPABILITY_TIERS_ARCHITECTURE_REVIEW.md`, `docs/SECURITY_W1_NATIVE_VAULT_DESIGN.md`, frozen `src/security/ports.ts`/`types.ts`, `src/security/platform/androidProductionSecurity.ts`, `BushMeshSecurityCore`, `BushMeshCurve25519Keys`, `CurveKeySecurityPolicy`, and the existing native Security Probe and Android tests from the exact base.

The physical Galaxy S22+ SM-S906E, Android 16/API 36 (2025-10-01 patch) verified a TEE AES-GCM storage key and SQLite FULL/secure_delete/DELETE. Both AndroidKeyStore Curve25519 keys reported SOFTWARE and NON_EXPORTABLE. Their H1 hardware-security test failed and Ed25519 sign/X25519 agreement were NOT_RUN. This does **not** validate a software-operated W1 implementation.

The frozen `CryptoProvider` requires persistent opaque provider/id/algorithm/purpose handles; raw 32-byte Ed25519 and X25519 public keys, 64-byte Ed25519 signatures and exact agreement semantics. Frozen `SecureSecretStore` expressly excludes asymmetric private keys. Current V2 Android storage CAS is not the required transactional authority/receipt/recovery contract. Existing H1 hardware verification is untouched by W1 research.

## Evaluated Android-compatible crypto implementation choices

| Candidate | Provenance and available primitive | Android/API + encoding/operation issues | Decision |
| --- | --- | --- | --- |
| **Bouncy Castle Java lightweight Ed25519/X25519** | Bouncy Castle / Legion of the Bouncy Castle, MIT-style licence; `org.bouncycastle.math.ec.rfc8032.Ed25519`, `org.bouncycastle.math.ec.rfc7748.X25519`; documented RFC 8032/7748 support | Strong candidate for exact 32-byte keys, RFC 8410 wrapping, 64-byte signatures, X25519 low-order/all-zero rejection. Still requires chosen pinned jar/version/hash, transitive-dependency and classloader review, API 24–36 compile/on-device testing, side-channel/GC/hook exposure review, KATs and independent audit | **Preferred candidate for future assessment; NOT approved or added as dependency here.** |
| **Google Tink Java/Android** | Google-maintained; `tink-android` supports API 24+; Ed25519 supported, X25519 HPKE/hybrid encryption available | HPKE/DHKEM is *not* the bare X25519 ECDH operation required by the frozen CryptoProvider. Keysets, prefix/serialization and import/export behavior need strict wire and custody review; no implicit conversion from HPKE | Not selected as complete exact Security v1 implementation |
| **libsodium via JNI/NDK** | Official libsodium supports Android and Ed25519/X25519; secure-memory functions `sodium_malloc`, `sodium_mlock`, `sodium_memzero` available | ARM64/x86 ABI reproducibility, NDK build provenance, JNI copies, ELF signing and dependency supply chain, process-memory and cleanup audit required. Key representation and API use differ (Ed25519 secret-key layouts can be 64 bytes) | Technically plausible, no vetted JNI boundary, not selected |
| **Android JCA/AndroidKeyStore Curve25519** | OS services present on the S22+ API 36 | AndroidKeystore Curve25519 is software-level on this device and returns opaque/non-exportable handles, not a reviewed software seed that can be AES-wrapped by a separate TEE key. Not uniformly supported on API 24; not a W1 seed-persistence design | Do not repurpose H1 or conflate Keystore NON_EXPORTABLE with hardware |
| **Spongy Castle / JS dev WebCrypto / ad-hoc primitive** | Older repackaging or test-only JS | Missing modern maintenance evidence, JavaScript plaintext private material, or unaudited algorithm code; violates custody and compatibility boundaries | Reject |

Research sources reviewed:
- Bouncy Castle project, license, release and raw APIs: https://www.bouncycastle.org/documentation/documentation-java/ ; https://github.com/bcgit/bc-java/blob/main/docs/interoperability.md ; https://github.com/bcgit/bc-java/blob/main/LICENSE.md ; https://downloads.bouncycastle.org/java/docs/bcprov-jdk14-javadoc/org/bouncycastle/math/ec/rfc7748/X25519.html ; https://downloads.bouncycastle.org/java/docs/bcprov-jdk13-javadoc/org/bouncycastle/math/ec/rfc8032/Ed25519.html
- Tink Android API support and primitive distinctions: https://developers.google.com/tink/setup/java ; https://developers.google.com/tink/supported-key-types ; https://developers.google.com/tink/design/consistency ; https://developers.google.com/tink/hybrid
- libsodium Android and memory protection: https://doc.libsodium.org/installation ; https://doc.libsodium.org/memory_management
- Normative vectors: https://www.rfc-editor.org/rfc/rfc8032 ; https://www.rfc-editor.org/rfc/rfc7748
- Android KeyInfo hardware proof: https://developer.android.com/reference/android/security/keystore/KeyInfo

Documentation or vendor release claims do NOT establish an exact Android 24 minimum-API runtime, constant-time behavior under Android JIT/GC, or an independent security review.

## Concrete outstanding release gates

1. **Crypto decision not signed off:** select an exact Bouncy Castle or libsodium *version, artifact hash, license, transitive dependency set, Android 24–36 ABI and classloader strategy*, security update policy, and independent review of encoding, private-key handling, X25519 low-order/repeated-value checks and side channels. Do not introduce a cryptographic dependency before this.
2. **Native custody design incomplete:** inspect JVM immutable seed, provider object copies, heap dumps, exceptions, JNI/Java crossing, key-use synchronization and best-effort buffer wiping. A TEE-wrapped disk blob is extractable to a compromised app process while using Ed25519/X25519.
3. **Wrapper key policy:** design a *new, dedicated* AES wrapping alias with direct KeyInfo TEE/StrongBox proof on every open; explicit randomized encryption/GCM IV with 128-bit tag, independent AES key identity, no alias recreation when missing, no software fallback and a separately auditable AAD encoding.
4. **Device-lock and recovery undecided:** field-operation authentication/lock behavior and key invalidation (screen lock/biometric), process death, reboot, failed deletion, interrupted provisioning, orphan records and W1 retirement need a reviewed policy and physical tests.
5. **Rollback fence missing:** restoring a coherent old sealed SQLite snapshot while the AES wrapping key survives cannot be detected by AES-GCM or SQLite high-water alone. Need an external trustworthy fence or formally approved fail-closed fresh-identity/epoch recovery.
6. **Identity/authority transitions:** no H1→W1 automatic fallback, no owner-genesis inference, no KeyStore/SQLite atomicity illusion, no convoy or V2 write until independent Security v2 review.

### Explicit executable scope of this branch

Add a standalone `android/securityw1research` **library only**, not referenced by `:app`, `:securityprobe`, Security v1 factories or RN. It may implement:
- immutable, bounded, **public-metadata-only** version-1 record header validation and deterministic length-delimited AAD layout, with no ciphertext encryption/decryption;
- wrapper-evidence validation as a pure policy receiving *test fixtures only* (not proof of actual hardware KeyInfo); explicit TEE/StrongBox requirement;
- fail-closed research gate and operation refusals, stale epoch/purpose/provider/record mismatch handling;
- unit tests for complete failure taxonomy, version mismatch, corrupted/truncated fixture length, stale epoch, replay/conflicting operation identifiers, orphan/interrupted/retired-state refusal, missing/invalidated wrapper, no fallback, no JS linkage and no production-ready claim.

**No private-key material exists or is operated by this code.** Such tests are structural negative tests, **not cryptographic known-answer tests, AEAD tests, process-death/reboot proof or a functioning W1 vault**. Do not claim implementation of these unavailable tests. No experimental APK is appropriate until the independent crypto and lifecycle review gates pass. Existing independently installable Security Probe is left as-is.

## Security classification

W1 remains `LOCAL_HARDWARE_WRAPPED_SOFTWARE_KEY` **proposal only**, not H1. Any eventual W1 code must report `privateOperationSecurity=SOFTWARE`, `externalAttestation=NONE`, `productionActivationApproved=false` and never advertise hardware-backed Curve25519. The current research module always reports `BLOCKED_UNREVIEWED` and refuses provision, commit, sign, agreement, rotate and retire. Existing H1 policy remains unchanged.

**Approval to revisit:** independent crypto-library review + memory-boundary threat review + device-lock/recovery policy + snapshot rollback policy + explicit decision to proceed with isolated test APK, before introducing software Ed25519/X25519 private-key operations.
