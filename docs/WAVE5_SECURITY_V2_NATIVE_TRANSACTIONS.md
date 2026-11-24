# Wave 5 — isolated Android Security v2 transactional storage candidate

**Status: NOT ACTIVATABLE / NOT REVIEWED FOR PRODUCTION.** Branch
`feature/wave5-security-v2-native-transactions-v1`, parent **exactly**
`2e71491e66e9964c77049fd18454aa1f36adc194`.

No Security v1 or Protocol v1 contracts, main, integration branches, Android
W1 key-vault branch, app radio/GPS/maps/UI, MainApplication or live activation
guard were changed.

## What is actually implemented

- `android/app/src/main/java/com/bushmeshmain/securityv2/SecurityV2NativeRules.kt`:
  independent JVM-checkable V2 epoch bounds, 32-byte fresh key, group IDs,
  preserved roster and revoked-member rules. Allows unsigned epoch 1..2^32-1
  instead of Android v1's old signed 32-bit `Int`.
- `.../BushMeshSecurityV2TransactionStore.kt`: a separate, **unregistered**
  Android SQLite database and storage-only native Kotlin implementation with
  `PRAGMA synchronous=FULL`, `secure_delete=ON`, SQL transactions, unique
  request/transaction IDs, encrypted-record *dependency* (not a production
  sealer), immutable approved owner pins, V2 snapshots, prepared/committed
  journals, epoch keys and local high-water, per-recipient issued envelopes,
  installed distribution digests and signed acknowledgement receipts.
- CAS commit checks exact current epoch/roster digest, unchanged authority
  sequence and preserved old members, distinct 32-byte rekey, and replaces
  the old epoch key and roster/high-water/journal in **one SQLite transaction**.
- Install requires an independently pinned owner, recipient-admission proof
  through injected verifier, strictly newer epoch and preserved old revoked
  members/credentials; deletes the older local epoch key within the transaction.
- Role-credential revocation uses expected authority sequence CAS, updates
  current sealed snapshot, and supersedes pending transactions atomically.
  Local invalidation atomically deletes the epoch key and marks the group
  invalidated. **Neither operation is a complete authenticated member-removal
  and multi-device rekey protocol.**
- Sender-side `recoverEpochWitness` verifies committed journal, digest,
  roster epoch and SQL high-water after an ambiguous bridge/commit result.
  `recoverAbortedEpoch` checks a genuinely uncommitted prepared transaction
  before allowing an injected independent witness to cancel a staged
  transition. Recipient-side `recoverInstalledEpochWitness` requires
  installed digest, snapshot, epoch key and high-water. Recovery MUST call
  the external witness; it must never reset a true committed hardware fence.
- `src/security/v2/testing/ReviewOnlyAndroidV2TransactionAdapter.ts` is a
  strict **test-only** implementation of `SecurityV2TransactionalStore`,
  using the *new* proposed `ProposedAndroidSecurityV2NativeBridge` methods.
  It does not import/use/cast `AndroidSecurityEpochStorage`, is NOT exported
  from the production V2 barrel and never obtains `NativeModules`. Native
  bridge naming is a **proposed** surface: **no `@ReactMethod` or
  ReactPackage is registered** in this feature.

### The three mandatory injection boundaries

`BushMeshSecurityV2TransactionStore` cannot be instantiated without
**all three** of:

1. `V2ValueSealer` — a reviewed native at-rest authenticated encryption
   provider. Android V1's separate Keystore-wrapped store is **not**
   automatically adopted or bypassed. Unit/instrumentation fakes are
   intentionally insecure and are **never** application factories.
2. `V2AuthorityAdmission` — externally verified trusted owner ceremony,
   signed genesis, current trusted fingerprint, role chain, request proof,
   recipient install proof, and signed recipient ack. **A self-signed owner
   genesis or carrier PSK is not sufficient.** No production verifier is
   provided, so no actual user can gain a V2 membership via this core.
3. `V2IndependentEpochWitness` — a separately trusted current-epoch
   high-water and staged/committed transition witness. The Android SQLite
   `epoch_high` table is **not** its own independently rollback-resistant
   evidence. Pending cross-store transitions must fail closed. This branch
   has NO verified hardware/TEE/remote witness implementation.

An implementation with dummy dependencies may exercise SQLite in a disposable
test only, not operational enrolment. A future signed native bridge would
also require verified invocation permissions, native identity/session
binding and exact error propagation.

## Compatibility matrix: SecurityV2TransactionalStore → isolated Kotlin

| V2 port | Kotlin storage operation | Isolated implementation | Still blocking activation |
|---|---|---|---|
| getPinnedGenesis | readOwnerAnchor | Sealed immutable pin read | Authenticated owner pin ceremony + independently verified provenance |
| loadGroup | readGroup | V2 sealed snapshot and local epoch check | Independent witness and full signed-state authentication |
| getEpochHighWater | readEpochFence | SQLite epoch + witness assertion | Hardware-backed or reviewed external anti-rollback |
| getEpochKey | readEpochSecret | Exact current epoch only; no old key returned | Production sealer and key custody; symmetric key enters JS |
| getTransaction | readPreparedTransaction | Sealed journal + issued/verified receipt overlay | Full canonical-signed digest recovery verification |
| getInstalledDistribution | readInstalledDistribution | Local installed digest journal | Remote authenticated receipt confirmation |
| getVerifiedReceipt | readVerifiedReceipt | Durable per-recipient digest | Cryptographic ack verification in admission gate |
| recordIssuedDistribution | recordIssuedDistribution | SQL uniqueness and current-roster check | Reviewed resend envelopes / per-device delivery retries |
| initializeOwnedGroup | atomicCreateOwnerGroup | Atomic fresh key/roster/high-water after pre-pinned genesis | Trusted out-of-band ceremony and external fence |
| prepareAddition | atomicPrepareAddition | Non-publishing epoch/roster CAS, unique request ID | Runtime-proven direct-session join/AAD and signed approval |
| commitAddition | atomicCommitAddition | Atomic next-epoch key, roster, high-water, commit journal; old key removed | Real policy proof and independently durable fence |
| installEpoch | atomicInstallEpoch | Newer-epoch recipient snapshot/key/install CAS | Trusted signed snapshot, stale role checkpoints, external fence |
| recordVerifiedReceipt | atomicVerifiedReceipt | Signed-ack digest and issued-receipt CAS | Exact Ed25519 ack verification, owner confirmation propagation |
| invalidateEpoch | atomicInvalidateEpoch | Local tombstone + delete current key | Complete removal/revocation rekey and remote delivery |
| revokeCredential | atomicRevokeCredential | Authority-sequence CAS + supersede prepared | Independent authority anti-rollback and signed delegation history |

**Additional Kotlin method:** `provisionApprovedOwnerAnchor` is explicit and
refuses to act unless the injected admission gate approves the separate
ceremony. It never blindly pins a received self-signed genesis. The former
Android V1 `commitEpoch` and `epochHigh` methods remain incompatible and
untouched.

### What SQLite FULL does and does not prove

Within the same Android SQLite database, on a correctly behaving filesystem
and SQLite implementation, a committed SQL transaction makes the roster,
sealed next key, journal receipt, local high-water and deletion of previous
key atomic **relative to process crashes and database reads**. SQLite
does **not** prove hardware rollback resistance, non-exportability of group
secrets, side-effect atomicity with Android Keystore/TEE/external witness,
replication to disconnected radios, or memory/flash erasure of old keys.

The external witness calls deliberately occur **outside** SQLite's durable
domain: stage before SQL commit and confirm after commit. Crash windows
therefore require independently checked pending state and explicit recovery.
No default witness exists. Full database restore can revert same-file
high-water, role revocation, journal and tombstones together. For role
revocation at an unchanged epoch, an **independent authority-sequence witness**
or new signed checkpoint is mandatory before production activation.

`android/app/src/androidTest/...` contains instrumented SQLite tests with
a clearly labelled XOR **test-only fake sealer** and in-memory witness. They
compile on CI but can execute only on a connected Android device/emulator.
They cannot certify Keystore, cryptographic identity, real power loss or a
hardware monotonic counter.

## Security v2 end-to-end lifecycle and recovery

1. **Genesis**: verify the independent owner ceremony on the device, pin
   exact signed-genesis hash/fingerprint immutably, then atomically install
   epoch 1 with a fresh root key. Mere signature validity is insufficient.
2. **Join**: frozen Security v1 direct session must authenticate the exact
   requester identity/fingerprint and original immutable Protocol v1 AAD;
   V2 verifies request/approval and current owner/admin grant. Native
   prepared journal consumes the request ID *without publishing membership*.
3. **Commit**: revalidate epoch, roster digest and authority sequence;
   commit new 32-byte key and pending-install roster. Older local key is
   removed atomically. If the JS Promise is lost, read exact signed tx digest
   and reconcile the external witness; never generate a second key while
   falsely treating a transaction as uncommitted.
4. **Distribution**: V1 authenticated direct AEAD protects a V2 key
   envelope. Persist issued digest *before radio transmit*. A successful
   radio write is not an installation.
5. **Recipient**: verify owner genesis/authority, authenticated envelope,
   expected fingerprint, Protocol v1 AAD, newer epoch and rollback guard;
   install key, snapshot and digest in one SQL transaction. Signed ack only
   after durable install. If interrupted after SQLite commit, recover via
   installed digest and independent witness; don't replay consumed AEAD.
6. **Convergence**: verified ack stored on owner only proves receipt was
   signed for that transaction. Recipient still needs signed owner
   confirmation/current epoch checkpoint. Partitions and stale approvals
   remain unresolved; no global convergence promise.
7. **Revocation**: reject stale role sequences, supersede pending
   approvals. Member-removal/owner transfer, remote revocation propagation
   and signed rekey are NOT implemented. Old captured ciphertext may be
   readable to any former member who previously held the old key.
8. **Restart/restore**: load only matching roster, key, ledger and
   independent high-water; mismatched/broken states fail closed. Do not
   "repair" by resetting counters, accepting older signed rosters or
   upgrading a MeshCore channel PSK into membership.

## Gaps that deliberately remain unavailable

- Actual Android native `@ReactMethod` bridge or production
  `SecurityV2TransactionalStore` registration. Existing Android W1
  key-vault and frozen V1 ports are separate workstreams.
- Production owner ceremony and secure external pinning, verified native
  cryptographic session/proposal checks, revoked admin/owner chains and
  fingerprint↔Protocol v1 node-ID binding.
- Independent rollback resistance including authority sequence, Keystore
  cross-store recovery, true power-cut validation and protected entropy
  lifecycle. SQLite FULL alone is insufficient.
- Hardware Curve25519 H1 on the physical Galaxy S22+ **fails**. The separate
  experimental W1 alternative is not approved, and this branch neither
  changes algorithms nor falls back to software/exportable private keys.
- Receiver proof of owner-verified ack, authentic remote epoch/role
  checkpoint, concurrent admin ordering across devices, offline member
  reconciliation, exact Protocol v1 control framing and fragmentation limits.
- New authenticated member-removal/epoch invalidation distribution and
  formally reviewed rollback/migration after user reinstall/device loss.

**Approval decision: Security v2 remains disconnected and
`disabled-pending-formal-review`. There are zero newly activatable
multi-device security capabilities.**

## Validation interpretation

CI runs full repository Jest/TypeScript/ESLint and builds the Android app
with the *unregistered* Kotlin source; native JVM policy tests execute on
a hosted runner. `:app:assembleDebugAndroidTest` only compiles real SQLite
instrumentation tests; it does NOT execute device tests. Any failed Android
compile or test is a blocker until corrected. Native functional security
approval requires real device testing and independent formal review.
