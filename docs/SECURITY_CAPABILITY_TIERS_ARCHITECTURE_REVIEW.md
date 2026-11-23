# BushMesh Security Capability Tiers — architecture review (proposal only)

**Date:** 2026-11-24  
**Status:** RESEARCH / DESIGN REVIEW ONLY. No additional provider, new security tier, live enrolment or production activation is authorised by this document.  
**Owner branch:** feature/android-production-security-v1  
**Android evidence reviewed:** f7c9147ba2634a054c3137b8fd9a7cce0ee5c30d  
**V2 cross-branch reference:** feature/security-v2-group-transactions-v1 at 2e71491e66e9964c77049fd18454aa1f36adc194  
**Protected Wave 3 baseline:** ca3388e54deafbe5e6bc854c1a145873a1508d01

## 1. Decision and boundaries

**Decision:** investigate a future hardware-wrapped, software-operated Ed25519/X25519 profile while retaining *locally TEE/StrongBox-verified Curve25519* as the only approved asymmetric-key hardware-assurance policy. Neither profile is currently authorised for live BushMesh Security v1/v2 production operation.

The intention is broad offline-device compatibility without representing application-memory private keys as secure-hardware-resident. Never silently substitute RSA, P-256, exportable JS PKCS#8, first-use unauthenticated owner claims, or downgrade the existing hardware gate. Do not alter frozen Security v1 public wire formats or canonical Protocol v1. Do not change the active application dependency graph.

This document is an architectural feasibility assessment, **not** implementation permission, a threat-model sign-off, a remote-attestation scheme, or evidence of hardware rollback resistance.

## 2. Source facts and physical evidence

The physical Samsung Galaxy S22+ SM-S906E on Android 16/API 36, patch 2025-10-01, reported:

- AndroidKeyStore AES-256-GCM local storage level: TEE.
- SQLite local settings verified: synchronous=2 (FULL), secure_delete=1, journal_mode=delete. These are **not** hardware anti-rollback or flash-erasure guarantees.
- AndroidKeyStore Ed25519 and XDH/X25519: provider registration, parameter setup, key generation and KeyInfo inspection PASS.
- Both Curve25519 KeyInfo levels: SOFTWARE, hardwareVerdict SOFTWARE_PROTECTED, privateKeyExportability NON_EXPORTABLE.
- Both failed the required TEE/StrongBox gate. RFC 8410 verification and signing/agreement were NOT_RUN. Temporary key cleanup PASS.
- Full isolated instrumentation suite: OK (21 tests), potentially including hardware-conditional skips; this does not change the capability verdict.
- Device reports a StrongBox feature, **not** proof that these Curve25519 private keys reside in StrongBox.
- ProductionSecurityActivated remains false.

This proves the tested **provider/firmware/key configuration** cannot satisfy BushMesh's existing hardware-verified Curve25519 gate. It does not prove every other configuration, independent secure element, or handset is incapable.

Source boundaries reviewed:

- src/security/ports.ts — frozen CryptoProvider returns opaque PrivateKeyHandle, requires persistence across restart and exact raw 32-byte Ed25519/X25519 public keys; SecureSecretStore explicitly excludes asymmetric private keys.
- src/security/types.ts and src/security/identity.ts — version-1 identity, fingerprint, rotation proof, signing/agreement handles, and integrity checks. Identity creation persists the paired public record + handles atomically, but provider key creation and metadata storage are distinct failure domains.
- src/security/platform/androidProductionSecurity.ts — opt-in, hardware-only provider; native encrypted storage/epoch CAS; not part of active application graph. Group/session symmetric keys can cross the JS bridge under current frozen V1 ports.
- android/securitycore/.../BushMeshCurve25519Keys.kt and CurveKeySecurityPolicy.kt — strict TEE/StrongBox + non-exportability check; diagnostic keys deleted.
- src/security/webCryptoProvider.ts — optional DEV/TEST private PKCS#8 persistence, expressly not an Android production solution.
- src/security/v2/contracts.ts and docs/SECURITY_V2_ANDROID_CONVERGENCE_REVIEW.md on the separate V2 branch — authenticated pinned owner genesis, prepared/committed roster and key epoch, recipient installs, receipts, revocation, independent monotonic epoch fence and recovery. Current Android storage-only commitEpoch is **incompatible** with SecurityV2TransactionalStore.
- ConvoyMembershipService and related V1 interface — local authorisation requires an actual verified group, not a displayed join request. Do not infer Security v2 authority from a V1 group record.

## 3. Proposed *local* capability profiles, not claims of peer attestation

| Profile | Local private-key custody and operating model | Local classification | Status |
| --- | --- | --- | --- |
| H1: hardware-verified Curve25519 | AndroidKeyStore Ed25519/X25519 handles; KeyInfo explicitly TEE/StrongBox; getter non-exportable; exact sign/agree and encoding self-tests | LOCAL_HARDWARE_VERIFIED only after tests; NOT remotely attested | Existing permitted assurance requirement, but operational production activation still OFF |
| W1: hardware-wrapped software Curve25519 | Software Ed25519/X25519 private keys sealed at rest by TEE/StrongBox AES-GCM; unwrapped only for narrowly scoped native-process operations | LOCAL_HARDWARE_WRAPPED_SOFTWARE_KEY, clearly lower assurance | Research candidate; forbidden from production until separate review and approval |
| U0: unavailable / indeterminate | AES key software/unknown, invalidated wrapper, missing identity, unverified operation, corrupt state, failed cleanup or unreconciled rollback | UNAVAILABLE/UNVERIFIED | Fail closed |

Names are proposals, not frozen protocol labels or signed trust claims. H1 and W1 are **not** interchangeable: a TEE-backed AES wrapping key does not make a software Ed25519/X25519 private key hardware-resident or non-extractable while in use. A local self-test or an identity-signed capability claim is insufficient evidence for another device to assert remotely verified hardware protection.

No group owner may infer another member's hardware security from user-visible labels, user-supplied profile strings, APK assertions or signatures alone. A separate attestation and verification protocol would be required for remote hardware assurance; authenticated identity is not synonymous with hardware assurance. In an offline convoy, lack of independent attestation should remain explicit, even for H1.

## 4. Design alternatives evaluated

| Candidate | Benefit | Principal limitation | Recommendation |
| --- | --- | --- | --- |
| A. H1 hardware-verified only | Best fit with currently reviewed key-custody requirement | Excludes tested S22+ Curve25519 configuration | Preserve as current strict gate |
| B. Native software Curve25519 under verified hardware AES wrapping | Keeps Security v1 algorithms and public wire formats; likely broad Android coverage; offline capable | Software keys appear in process memory during operation; vulnerable to privileged runtime compromise; recovery and rollback are hard | **Research W1**, not approve or enable |
| C. Native W1 plus separate hardware P-256 binding or attestation key | May support additional device-binding evidence on some devices | New keys and attestation trust chain, offline-verifier complexity, still does NOT make Ed25519/X25519 hardware resident | Optional later research only; never substitute P-256 for V1 identity |
| D. JS WebCrypto with persisted PKCS#8, unsealed JS state or AsyncStorage | Easier prototype | Bypasses intended native custody boundary; expanded exposure and leakage surface | Reject for production |
| E. Server-held private identity or online verification dependency | Central policy and recovery | Violates BushMesh's offline operation goal and creates service dependency | Reject as required convoy path |

## 5. Candidate W1 native provider design (requires review before coding)

1. Add a **separately named**, explicit opt-in native provider with its own versioned record namespace and alias scope. Never change the meaning of existing android-keystore-curve25519-v1 handles. A W1 handle remains an opaque provider/id/algorithm/purpose descriptor to TypeScript and cannot transport private-key bytes.
2. Require locally proven TEE/StrongBox AES-256-GCM wrapping key via KeyInfo, stable app-scoped alias, randomized IV, correct AAD binding provider ID, handle ID, algorithm, purpose, identity epoch and vault-record version. Authenticate all metadata before constructing a private key. Deny use if the wrapper is missing, replaced, downgraded or invalidated.
3. Generate exact Ed25519 and X25519 key pairs with a *reviewed, explicitly chosen* cryptographic implementation. Ensure 32-byte Security v1 raw public keys and RFC 8410 compatibility, correct 64-byte Ed25519 signatures, X25519 agreement, misuse/low-order protections, purpose binding, input validation and test vectors. Do not silently choose providers or weaker algorithms.
4. Keep plaintext private-key material in an isolated native operation boundary only for the shortest feasible duration, avoid JS/React state/bridge/log/analytics/crash reports, wipe mutable buffers on success and error, disable unnecessary caching, and document limitations of JVM/GC/native copies and heap or process compromise. Zeroisation is a best-effort mitigation, **not** a promise of perfect memory erasure.
5. Store the encrypted private-key blob in a dedicated security vault, **not** SecureSecretStore: that frozen V1 port explicitly excludes asymmetric private keys. Keep identity and opaque-handle metadata in a transactionally consistent store. Specify crash-safe provisioning, orphan handling, identity retirement, replacement and deletion semantics across the vault, SQLite and AndroidKeyStore; no cross-store atomicity can be assumed.
6. Keep native CSPRNG, domain-separated input binding and error handling; design key lifecycle and recovery for process death, reboot, app data restore, OS upgrade, backup/restore and missing KeyStore wrapper. Existing allowBackup=false and noBackupFilesDir remain necessary but are not sufficient.
7. Treat application compromise, unlocked/rooted state and compromised runtime as material W1 extraction risks. Device lock and optional user-auth-bound wrapper policies must be explicitly chosen based on convoy field operation (hands-free, device locked, emergency operation) and their effect on keys after biometric or lock changes.
8. A W1 provider may satisfy the shape of CryptoProvider without changing frozen public Security v1 encoding. But it is **not** compatible with the H1 security-assurance requirement by type coercion. Require a distinct factory, capability policy and user-approved provisioning flow.
9. Do not infer authority or promote enrolment success from vault possession, successful signature verification or a device-reported security tier. V2 owner genesis, authority chain, verified epoch install and receipt must still be proven independently.
10. Any proposed crypto native bridge must undergo RN 0.85/new-architecture compatibility testing; current native synchronous entropy bridge remains unverified on the live application. Do not reuse JS dev/test WebCrypto PKCS#8 persistence as a production shortcut.

### Important key-use limitation

Even if the W1 wrapping AES key resides in TEE, software Ed25519/X25519 signing or agreement requires their plaintext private-key material in app-process memory. Hardware AES improves protection of *stored* key blobs; it does not prevent a sufficiently privileged adversary from reading them at use time, extracting derived secrets, or directing a compromised application to sign.

## 6. Tier choice, binding, user consent and downgrade handling

- Production activation requires an independently reviewed, explicit policy for which profiles are accepted by convoy owners/admins and for which operations. Default to deny W1 until approved; do not introduce an accidental fallback from H1 to W1 after a failed hardware check.
- Local diagnostic tier is descriptive; negotiated security protocol versions, authenticated public identity, trust decisions and convoy membership remain separate concepts. Do not put unauthenticated or self-asserted tier text into the authority path.
- If tiers later appear in UI, use explicit labels such as **Locally hardware-verified**, **Locally hardware-wrapped software key**, and **Unverified**. For peers, say **peer-reported; not independently attested** unless actual verifier evidence exists.
- Store user consent and selected policy version with audit history, not merely a transient UI flag. Any switch in key-custody profile must be an explicit re-provisioning operation, never overwrite the previous provider's aliases in place.
- If existing identity keys can sign a legitimate IdentityRotationProof and recipient trust/epoch fences validate it, design a reviewed versioned rotation path. Otherwise require new pairing, independent owner approval and epoch rotation. Never silently reuse an old fingerprint for newly generated keys or treat lost keys as authenticated continuity.
- Prevent downgrade from H1-required policy to W1 via compromised or forged invitations, stale capability information, silent connection retries or owner-role impersonation. Commit policy and allowed profile in authenticated authority state if the V2 design ever adds such a requirement; this would be a versioned extension needing separate formal approval.
- A member's W1 status does not permit bypassing signed owner/admin approval, immutable Protocol v1 AAD, roster checks, per-recipient distribution, installed acknowledgement, epoch high-water checks, revocation or anti-replay protections.
- Current ConvoyMap, radio telemetry and joining must remain in their existing safe states. Capability labels must not make pending enrolment appear successfully verified.

## 7. Independent V2 blockers (not solved by W1)

Changing the source of asymmetric keys does **not** close the V2/Android transactional-convergence gap. AndroidSecurityEpochStorage.commitGroupEpoch is storage-only V1-shaped CAS; it lacks independently approved pinned genesis, complete prepared/committed journal, roster validation, installed distribution, verified receipts, credential revocation, key retirement and cross-store recovery. Nor does encrypted SQLite provide independent hardware rollback resistance against restoring a full database snapshot.

Required: a reviewed versioned native V2 store and authority anchor; atomic roster/key/journal/fence operations; explicit fail-closed fresh-key recovery when monotonic counter hardware is unavailable; verified invalidation and rejoin reconciliation. No tier decision can waive these requirements.

## 8. Risk / acceptance matrix

| Threat or failure | H1 | W1 risk and necessary research gate |
| --- | --- | --- |
| Stolen/offline storage blob | Hardware key unavailable as bytes in normal API | TEE-wrapped blob raises bar, but AES alias lifecycle, AAD and backup behaviour must be tested |
| Root, exploit or compromised app at key-use time | Hardware private key not ordinarily extractable; operations may still be abused | Plaintext software key and derived material may be extractable; must disclose and model |
| Forged hardware-tier claim from a remote member | Local inspection alone cannot attest peer | Identity-signing claim is not independent hardware evidence; no remote-hardware label without attestation |
| Loss of hardware wrapping key or changed device lock | Key may be invalidated / unavailable | Sealed W1 identity can become unrecoverable; no silent identity regeneration |
| Snapshot rollback of sealed SQLite / counters | Unsolved independent concern | Equally unsolved; must design fail-closed recovery and new epoch |
| Downgrade / policy confusion | Fixed strict gate | Explicit admin policy, authenticated selection, no automatic fallback |
| Crash mid-identity rotation / retirement | KeyStore and database are different domains | Sealed blob + metadata + epoch commitments need fault injection and recovery journal |
| Process memory dump / native heap | Lower private-key extraction exposure | Significant W1 differential risk; test practical controls and limit use |
| Convoy partition / rejoin / revoked peer | Must satisfy V2 transactions | Same V2 checks, no tier exception |
| Loss of BLE, GPS, radio or offline maps | Must remain unaffected | Keep all work isolated; physical regression when integration is separately approved |

## 9. Implementation and verification sequence — work packages, NOT permission to activate

**Phase R0 (this document):** freeze physical-device evidence and compare source contracts. Produce explicit threat-model differential, capability-schema proposal and refusal matrix. No production code.

**Phase R1 (research only):** draft native W1 vault API and sealed-record schema, error taxonomy, Android capability verification and device-lock policy. Independent crypto review of chosen Ed25519/X25519 implementation and native memory boundary. Evaluate whether AES-wrapped private-key operation can actually meet intended field-use needs on the S22+.

**Phase R2 (isolated test APK, separate approval):** add opt-in experimental provider only to an isolated test package. Unit test known-answer sign/verify/X25519 vectors, malformed and low-order input, nonce/IV uniqueness, AAD tampering, key-wrapping access, corrupted key blobs, intentionally missing wrapper, startup/restart/reboot, OS upgrade, adversarial error paths, alias cleanup and crash injection. Test *no* production path or silent fallback.

**Phase R3 (security review):** independently examine local/remote assurance semantics, exploit/memory risk, hardware-attestation availability, rollback recovery, owner/administrator consent UX, V2 owner-genesis and store convergence. No implementation approval from CI alone.

**Phase R4 (future integration only after sign-off):** guarded app factory and explicit policy with a separate integration/test branch authorised by the project owner. Real Galaxy S22+ and a hardware-backed capable comparison device, 2+ member off-grid convoy, authority revocation and disconnected rejoin tests. Preserve Wave 3 baseline and never automatically upgrade a pre-existing identity.

### Required fail-closed tests

- H1 rejected on this S22+ when Ed25519/X25519 KeyInfo reports SOFTWARE, even when privateKey.encoded == null.
- W1 not selected implicitly after an H1 failure, including on a restart or a hardware-capability change.
- Hardware AES absent or unknown => no W1 vault read/create; no plaintext fallback.
- W1 private key never crosses the JS boundary, log, telemetry, report, state store or exported backup.
- Vault integrity/AAD tampering, purpose mismatch, stale epoch, wrong identity binding, forged handles and revoked handle fail.
- No silent identity regeneration after alias loss, restore or database rollback.
- V2 request/approval/pinned-genesis, epoch CAS, signed receipts, revocation and anti-replay remain required.
- Stage diagnostics and cleanup may pass while H1/W1 activation still remains disabled.

## 10. Release gates and ownership

| Gate | Owner / required evidence | Status |
| --- | --- | --- |
| H1 hardware Curve25519 support on physical phone | Android worker; full stage report + sign/agree + restart | S22+ FAILED H1 with SOFTWARE key level |
| W1 formal threat model and crypto implementation review | Independent security review, documented assumptions and limits | OPEN |
| Separate W1 native vault API and isolated implementation | Android security feature worker, test APK only | NOT STARTED |
| W1 physical tests and no-JS-private-key evidence | Two physical devices where possible; structured test logs | OPEN |
| V2 authenticated genesis and native transaction store | V2 + Android convergence reviewers | INCOMPATIBLE / OPEN |
| Hardware rollback resistance or fail-closed recovery | Transaction/recovery reviewers, physical fault tests | OPEN |
| Trusted tier claims or remote attestation decision | Identity/UX/security reviewers | OPEN |
| Explicit user/owner policy and no-downgrade UI | Convoy enrolment owners, later approval | OPEN |
| Activate any new production profile | Formal independent review, authorised integration and field acceptance | **DENIED** |

**Recommendation:** preserve strict H1 and research W1 solely as a lower-assurance, offline-capable option. Do not call it hardware identity, silently use software fallback, or enable any tier in production at this stage.

## References

- Android KeyInfo: https://developer.android.com/reference/android/security/keystore/KeyInfo
- Android Keystore: https://developer.android.com/privacy-and-security/keystore
- Android KeyMint / Keystore: https://source.android.com/docs/security/features/keystore
- OWASP Mobile key storage: https://mas.owasp.org/MASTG/knowledge/android/MASVS-STORAGE/MASTG-KNOW-0047/
- Existing implementation evidence: docs/ANDROID_PRODUCTION_SECURITY_V1.md and docs/GALAXY_S22_CURVE25519_STAGE_DIAGNOSTICS.md
- Independent V2 gap analysis: docs/SECURITY_V2_ANDROID_CONVERGENCE_REVIEW.md on feature/security-v2-group-transactions-v1
