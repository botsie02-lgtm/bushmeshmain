# Wave 4 — deterministic Security v2 proposal boundary regressions

**Branch:** `test/network-simulator-v1`  
**Frozen Protocol v1:** `67327e641b169ec94600a7b07188946058c067b7`  
**Assurance:** `fake-decision-only` or `external-provider-unverified`. **NO cryptographically validated Security v2 enrolment is implemented.**

## Why these are shadow-state tests, not a new Security implementation

The Wave 3 formal review `docs/WAVE3_SECURITY_V2_FORMAL_REVIEW.md` on the
separate Security v2 proposal branch is marked **NOT APPROVED**. Frozen Security
v1 `GroupKeyManager` has no atomic incremental add-member operation.
`SecurityMetadataStore.setGroup` is not a safe replacement for group membership
CAS, authenticated role authority, key high-water or durable install acks.
Production Android private-key/secret persistence, role credentials and
recipient installation proof are additional independent blockers.

This branch **does not import, merge or promote** that disabled proposal. It
does not write group metadata, rotate keys, sign role credentials, process
Security v2 control wire or expose an authorised convoy directory.

`Wave4EnrolmentHarness` is a test-only **shadow ledger** with fault injection
that asserts what a reviewed future provider must guarantee. Its active-member
list, fake epoch and journal health are never connected to production membership
or app UI. Its `FakeWave4SecurityDecisionProbe` returns policy booleans
without signatures, cryptography, atomic storage or rollback resistance.
Both `fake-decision-only` and injected `external-provider-unverified`
results are always reported as **unverified**, even when a test passes.

The `Wave4SecurityDecisionProbe` interface is a narrow adapter seam for a
future reviewed provider. It currently includes `authenticateApproval` and
`verifyInstalledReceipt`, but **is not** the proposed
`ProposedSecurityV2EnrolmentPort` itself. When production Security v2 exists,
adapters must explicitly map the reviewed prepare/CAS commit/bound encrypted
distribution/install/verified acknowledgement API and its actual failure codes
into separately gated integration tests. This shadow suite never substitutes
for those tests.

## Which existing canonical code is actually exercised

- Carrier-leg probes use real frozen Protocol v1
  `BushMeshDatagramRuntime.prepareOutbound()` and `acceptInbound()`, real
  B5 4D Message wire encoding and real B5 53 *container framing* through an
  injected **fake** Security v1 direct-session adapter. They are labeled
  `wave4-carrier-only` and are **not** Security v2 control frames or
  authenticated role approvals.
- Position probes use real canonical convoy-wire encoding and protected-group
  container framing via `ConvoyMobilityHarness.publishPosition()`. The
  injected `SecurityDecisionTestAdapter` denies obsolete epochs and revoked
  device/source bindings in-memory. It does **not** encrypt, sign, or establish
  actual group-key possession.
- The existing test-only position observation ledger checks accepted logical
  source against the embedded node ID, ignores older sequences, and records
  unexpected changes. It is **not** a live production `AuthorizedConvoyDirectory`
  or a substitute for the application security ingress gate.

## New scenarios and fixed seeds

| Wave 4 scenario | Seed | Nodes | Fake-provider assertion |
|---|---|---:|---|
| Simultaneous requests and conflict CAS | `0x440101` | 8 | Two approvals at epoch 1 cannot both commit; later retry at epoch 2 converges |
| Owner/admin disappearance mid-join | `0x440102` | 7 | Missing owner or approving admin prevents commit; restoration requires new test decision |
| Approval replay and conflicting approvals | `0x440103` | 6 | Identical prepared replay is no-op, different approvals conflict, committed replay does not re-authorize |
| Partial commit and failed restart | `0x440104` | 5 | Injected pre-CAS failure leaves roster/epoch unchanged; missing journal fails closed |
| Delayed install and lost ack | `0x440105` | 6 | Local installations do not imply globally verified receipts; retry converges only after ack |
| Carrier reconnection with obsolete keys | `0x440106` | 6 | Old member epochs are denied after reconnect until explicit fake recipient installation |
| Concurrent revocation and enrolment | `0x440107` | 8 | Revocation invalidates pre-revocation CAS; revoked and obsolete position traffic denied |
| Identity rotation during joining | `0x440108` | 5 | Old requester fingerprint invalidates prepared approval; fresh request required |
| Sender binding and embedded ID forgery | `0x440109` | 5 | In-memory Security adapter rejects false source/device, ledger refuses mismatched embedded ID |
| High-congestion leader/rear split and regroup | `0x440110` | 20 | Split blocks synthetic distribution; collision/queue loss recorded; key and position traffic resumes |
| Injected deny-only external decision seam | `0x440111` | 5 | A fake external-decision denial cannot be promoted into membership |
| Fixed-seed ten-join monotonicity soaks | `0x440201`, `0x440202`, `0x440203` | 20 each | Ten sequential CAS epochs, partial-write injection, receipt convergence, fresh source positions |
| Exact same-seed transcript replay | `0x4402da` | 20 twice | Security report, event trace and metric samples are bit-for-bit deterministic |

The existing **44 Network Simulator tests** remain part of the same CI job
and use the original deterministic protocol, position and RF scenarios.

## Security-failure reports

The new suite emits
`artifacts/network-simulator/wave4-enrolment-regressions.json`,
uploaded in GitHub Actions together with existing
`artifacts/network-simulator/convoy-regressions.json`. The Wave 4
report records:

- scenario name, fixed seed, virtual node count, assurance level, failures;
- all shadow transaction references, expected vs committed epoch, mock roster
  revision, prepared/committed/aborted state, acked and pending recipients;
- current committed epoch, per-device *mock installed epoch*, disagreement
  count, epoch disagreement samples, acknowledgement convergence status and
  convergence latency samples;
- replay/conflict/invalid-transition rejections, pre-CAS fault prevention,
  synthetic distribution attempts, delivered carrier legs, fake recipient
  installations, lost or rejected fake install receipts and rollback blocks;
- frozen-runtime datagram attempts, accepted/rejected/lost messages, duplicate
  suppression, queue peaks/drops, synthetic collisions/airtime and per-peer
  position freshness;
- deterministic virtual-time security events. If invariants fail, a detailed
  `failureReport` includes the simulator's source configuration and recent
  carrier trace.

A completed **carrier send**, a prepared approval, a mock receipt or a local
key epoch never count as globally authenticated membership. Only a separately
reviewed provider can assert those facts.

## Key limitations and integration work

1. **No real Security v2:** The proposed
   `prepareAddMember` / `commitPreparedAddition` /
   `wrapCommittedEpoch` / `installCommittedEpoch` /
   `verifyInstalledAck` contract is not implemented here. Shadow CAS is a
   single in-memory model transition, **not** production atomic persistence,
   durability, crypto or a distribution transaction.
2. **No live remote authorization:** The local simulated roster is an
   assertion fixture. Revocation and epoch changes are not cryptographically
   distributed or certified across all disconnected nodes. Revoked offline
   devices may retain obsolete keys until a real authority/key synchronization
   solution exists.
3. **No cryptographic replay proof:** Approval conflicts, fake epochs and
   receipt replay are policy event tests; actual signed role ancestry,
   epoch high-water, anti-rollback and bounded Security v1 replay windows must
   be validated by owning implementations.
4. **No activated convoy joining:** A real Security v2 enrolment feature
   remains blocked by formal review. Neither this branch nor passing tests
   change `SECURE_ENROLMENT_V3_ACTIVATION`.
5. **No real RF:** Packet collision/capture and queue/airtime models remain
   synthetic. No calibrated Heltec vehicle RF, firmware/BLE, Android secure
   storage, or physical location testing is implied.

## Run

```bash
npm ci
npx tsc -p tsconfig.network-simulator-v1.json --noEmit
npm test -- --runInBand \
  __tests__/bushmeshNetworkSimulator.test.ts \
  __tests__/bushmeshConvoyCampaigns.test.ts \
  __tests__/bushmeshWave4Enrolment.test.ts
```

Never wire this shadow ledger into production convoy membership or transmit
a new Security v2 control type before contract approval and independently
validated Security/provider integration.
