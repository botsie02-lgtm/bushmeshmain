# Wave 3 Security v2 formal review gate — NOT APPROVED

**Source:** `feature/convoy-enrolment-security-v3` at `01ff708eda8609e4dffe0cc8d9833d23ea8d1bcd`  
**Baseline:** `9956ef244881c79a64e582a08136eceb0a90dce5`  
**Status:** DISABLED proposal and test-only compatibility layer. **Not an authenticated production enrolment feature.**

## Integration decision

- Import `src/convoy/enrolmentV3` and its negative/security tests only, with a two-parent staging merge. Do **not** add live provider, radio, roster or action wiring.
- `SECURE_ENROLMENT_V3_ACTIVATION` is the literal `disabled-pending-security-v2-review`. `SecureJoinCompatibilityV3.executeIncrementalEnrolment()` always throws `SecurityV2ContractUnavailable` with `SECURITY_V2_CONTRACT_REQUIRED`.
- `PendingJoinViewV3.authorized` is always false. A valid role-credential signature only proves that key signed those bytes: **it does not prove current owner/admin authority**, enrollment, group key possession or current roster membership.
- The real `App.tsx` mounts `ActiveOperationalConvoyProvider` **without a directory prop**; its default remains `unavailableConvoyDirectory`. The Field Readiness and detailed Drive hosts both pass `roster={null}`, `verifiedAlerts={null}`, and `carrierBinding={null}`. No live code instantiates the v3 proposal as an authorization source.
- The independent simulator is retained as copied tests only; this proposal does not add another protocol/runtime or modify existing BLE ownership, Security v1, MeshCore or the GPS provider.

## Blockers to formal Security v2 activation and approval

1. **Real authenticated incremental add member**: Frozen `GroupKeyManager` has no `addMember` API, and `wrapActiveKeyForPeer` rejects recipients not in the current active roster. Writing `SecurityMetadataStore.setGroup` manually is **not** enrollment or cryptographic permission.
2. **Production Android identity/storage providers**: Non-exportable signing/agreement handles, Keystore/StrongBox suitability, protected secret storage and atomic security metadata, restart-safe replay/nonce state and identity/trust/session lifecycle. In-memory WebCrypto test helpers and encrypted UI preferences do not suffice.
3. **Atomic group roster/key epoch CAS**: One authorized, idempotent add-member transaction with new epoch key, roster digest, rollback-resistant epoch monotonicity, expected-epoch conflicts, durable journal and consistent crash recovery.
4. **Anchored role authority**: Independently signed convoy owner genesis and bounded owner/admin delegation graph; current unrevoked role, fingerprints, key rotations, expiry, sequence and replay must be validated. The group leader is not automatically a convoy admin.
5. **Authenticated recipient distribution**: Signed transcript binds exact direct session AAD, group ID, epoch, roster digest, transaction ID, sender and recipient keys/fingerprints and encrypted wrapped-key bytes. Recipient install must be atomic, checked and acknowledged with a verifiable authenticated signature.
6. **Partial delivery and revocation**: Model multi-vehicle disconnection and stale epochs, group-key rotation, required recipient-install acknowledgements, current verified roster convergence and remote revocation propagation. Never report global completion from a local proposal or a successful send callback.
7. **Protocol/security compatibility review**: Version negotiation/downgrade policy, cross-device tests, tampered payloads, replay, forged owner/admin, old-key revival, crash/rollback cases and explicit approval for the proposed additive v2 contract before implementing it. Frozen Protocol v1 and Security v1 remain untouched meanwhile.
8. **Position/alert/action trust gates**: `acceptAuthenticatedConvoyPosition` must refuse embedded node ID != verified routing source. Live Drive roster and alerts must be bound to actual current membership, fresh location and the exact authorized carrier. STOP/HAZARD/HELP/REGROUP stay local previews.

## Deliberately unavailable

- New convoy joining and committed group-key installs; remote owner/admin grants or elevation.
- Globally verified roster/position/alert feeds derived from the draft proposal, signed-but-unanchored metadata, contacts or carrier channel PSK.
- Production authenticated group revocation propagation and real Drive quick-action transmissions.
- Any claim that this v3 proposal implements Security v2 or that CI passing is security approval.

## Required next evidence

An independently reviewed versioned API with production Android cryptographic provider tests, durable group-epoch atomicity, owner/admin chain verification, authenticated multi-party enrollment/join/revoke/restart scenarios and a separately authorized integration change. Until then the `AuthorizedConvoyDirectory` stays unavailable and the application remains non-transmitting for unauthorised Drive commands.

**Safety tests retained:** `__tests__/convoyEnrolmentSecurityV3.test.ts`, `__tests__/wave2AuthenticatedPositionIngress.test.ts`, simulator identity-mismatch regression, and new Wave 3 disabled-activation assertions.
