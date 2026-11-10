# Wave 4 formal compatibility review: Security v2 transactions vs Android epoch CAS

**Reviewed source commits (10 November 2026):**
- Security v2: `feature/security-v2-group-transactions-v1` @ `8eeb659dfb2156c676cf1b69d407edb644cdcff8`
- Android candidate: `feature/android-production-security-v1` @ `b0558b643ffed8e839267bca16d4ae5cd363536b`
- Original Security v2 proposal: `src/convoy/enrolmentV3/SECURITY_V2_CONTRACT_PROPOSAL.md`
- Formal Wave 3 gate: `docs/WAVE3_SECURITY_V2_FORMAL_REVIEW.md`

**Decision: NOT APPROVED, NOT INTEGRATED, NOT ACTIVE.** Neither candidate source is merged into the Wave 4 application. Both feature workflows succeeded for their exact SHAs, but the native Security v2 transaction-store and Galaxy S22+ hardware capability proofs are missing.

## Direct interface comparison

The actual `SecurityV2TransactionalStore` is defined in the Security v2 worker's `src/security/v2/contracts.ts`. Its shape is NOT satisfied by the Android worker's `AndroidSecurityEpochStorage`, which exposes ONLY `commitGroupEpoch(params): Promise<boolean>` and `getHighWatermark(groupId): Promise<number>`. Its `commitGroupEpoch` receives a **Security v1 GroupRecord** plus key ref and 32-byte symmetric secret; it cannot replace Security v2's atomic `GroupSnapshotV2` with genesis, complete roster, role revocations, pending-install members, transaction journal and signed ack state.

| Required SecurityV2TransactionalStore method | AndroidSecurityEpochStorage support | Gap / decision |
|---|---|---|
| `getPinnedGenesis` | NO | Independently provisioned, immutable signed owner-genesis digest and pin missing |
| `loadGroup` | NO | Cannot load authenticated `GroupSnapshotV2` with complete roster/authority sequence |
| `getEpochHighWater` | PARTIAL analogous `getHighWatermark` | SQLite high-water exists but not separately rollback-resistant |
| `getEpochKey` | NOT exposed as v2 transaction port | Android v1 SecureSecretStore is separate; no reviewed v2 custody/epoch invariants |
| `getTransaction` | NO | Durable prepared/committed/superseded journal and conflict digest lookup absent |
| `getInstalledDistribution` | NO | Verified installed-envelope digest lookup absent |
| `getVerifiedReceipt` | NO | Exact post-install Ed25519 receipt lookup absent |
| `recordIssuedDistribution` | NO | No per-recipient signed-envelope journal/retry ledger |
| `initializeOwnedGroup` | NO | Atomic genesis+pin+initial key+fence absent |
| `prepareAddition` | NO | Expected roster/epoch CAS and non-publishing request journal absent |
| `commitAddition` | NOT equivalent | Android `commitGroupEpoch` is only a v1 metadata/key/epoch CAS; no v2 roster/genesis/revocations/prepared journal |
| `installEpoch` | NO | Recipient atomic installed group snapshot/key/fence/replay journal absent |
| `recordVerifiedReceipt` | NO | No durable authenticated ACK/reconciliation commit |
| `invalidateEpoch` | NO | Atomic emergency disable and permanent anti-revival fence absent |
| `revokeCredential` | NO | Atomic owner-signed authority-sequence role revocation absent |

**Rule:** No cast (`as SecurityV2TransactionalStore`), interface-wrapping shim, duplicated `setGroup`/secret writes, or in-memory substitute. A type assertion is neither an atomic transaction nor authorization.

## Security v2 contract design observations requiring explicit formal decision

- The reviewed group worker uses a **distinct v2 epoch distribution**; frozen Security v1 `WrappedGroupKeyDistribution` cannot be treated as a v2 new-member bootstrap, and V1 `GroupKeyManager.installWrappedGroupKey()` is not the v2 recipient install.
- The signed owner-genesis **must be independently pinned** on the joining phone. Signed self-asserted role claims or MeshCore channel PSKs prove no owner/admin authority. Owner/admin delegation revocation and cross-phone authoritative sequence convergence remain to be reviewed.
- `prepareAddMember` must verify request, approval, trust pin, current direct session and byte-exact canonical AAD without publishing a member. The protected transaction journal must be idempotent under crash/retry and conflict rejection.
- `commitPreparedAddition` must atomically advance *all* of roster, fresh epoch secret, epoch high-water, revocation state and journal; the newly joined member starts **pending-install**, not authorized from pending or send receipts.
- Recipient installation and signed acknowledgement must each be durable, exact transaction/digest/fingerprint/epoch-bound, independent of radio carrier receipt and recoverable after crash. Existing disconnected recipients need retry/epoch reconciliation without stale-key resurrection.
- A separate monotonic high-water **trust domain** is needed to detect database snapshot rollback. SQLite FULL transactions prevent split writes but not a privileged snapshot restore; no Android hardware-backed rollback resistance is established. Recovery must fail closed or use a reviewed fresh-key rebootstrap.
- Simulated in-memory Security v2 store tests and provider JVM tests establish logic only, not physical KeyMint support, cross-process atomicity, post-power-loss durability, hardware non-exportability or group membership activation.
- Frozen Protocol v1 AAD, sender identity/routing provenance, signed envelope size/fragmentation, version negotiation/downgrade, nonce/replay and domain-separated canonical digest need end-to-end cross-implementation vectors and adversarial review before approval.
- No live `AuthorizedConvoyDirectory` can be built by reading raw candidate snapshots. `unavailableConvoyDirectory` is authoritative until separately reviewed live membership+group-key+role proof, every-read revalidation and invalidation.

## Threat-model cases to close with evidence

Parallel approvals; duplicate/conflicting transaction ID; replayed/stale signed join; group-id substitution; invalid/rotated owner fingerprint; forged delegated admin; removed member retaining old key; swapped direct-session AAD; truncated/altered distribution; duplicate/fake installation ACK; recipient power loss before/after commit; authority restart after commit but before sending; partial fanout to partitioned phones; backup rollback of whole SQLite database; two-device epoch divergence; Android Keystore loss/invalidation; JavaScript secret exposure; carrier-to-verified-position laundering; message replay and compromised bridge producer.

**Formal approval must identify** review owner, canonical contract/version and approved source SHA, production transaction provider SHA, independently verified owner-root provisioning policy, per-device crypto capability evidence, multi-phone vectors/results, rollback limitation, runtime admission and rollout/rollback strategy. **No approval is recorded here.**

## Android provider candidate hardware limitations

Android native package is compiled and registered **only on the worker branch**; its opt-in Security v1 provider is not selected in the live graph. The candidate uses hardware-checked AndroidKeyStore AES-GCM storage and attempts API 33+ Ed25519/XDH using Keystore aliases and KeyInfo, but Galaxy S22+ actual support is unverified. The provider's 16-KiB synchronous entropy pool can exhaust without a replenishment design. V1 Uint8Array/JS bridge carries symmetric keys in memory. Encrypted SQLite and one-transaction v1 epoch CAS do not confer rollback resistance. Keystore handles and encrypted metadata are distinct atomic domains; alias generation/crash can orphan private aliases. A missing exact native Curve25519 algorithm must remain unsupported, not silently become P-256 or exportable PKCS#8.

**Next:** implement/review the full v2 store in a distinct feature branch; run native instrumentation on an isolated app ID and physical two-phone transaction tests before an explicit Security v2 activation approval.
