# BushMesh Wave 5 — reproducible field reliability and acceptance

**Status: AUTOMATED SIMULATION AND NODE TEST PLAN. PHYSICAL WAVE 5 TESTS NOT RUN.**

- Repository: `botsie02-lgtm/bushmeshmain`
- Branch: `test/wave5-field-reliability-v1`
- **Immutable base:** `37ded9fa36de2a14970b522a4e9fd1e677534dc2`
- Test ownership: only test-only simulator modules, regression tests, CI, metrics and physical procedures. No new protocol, radio engine, crypto, UI, BLE owner or map implementation.
- The base is an **isolated Wave 4 snapshot**: its imported simulator does *not* include all later experiments developed on `test/network-simulator-v1`. This work does not cherry-pick or merge that branch. Synthetic directed-link airtime is **not** an RF collision test.
- Earlier Wave 3 acceptance is **user-reported**, documented in `docs/WAVE3_HARDWARE_ACCEPTANCE_REPORTED.md` (S22+, Heltec, LilyGo, local Melbourne tiles, channel #4, handoff), not independently witnessed here. The `docs/WAVE4_TWO_PHONE_TWO_RADIO_ACCEPTANCE.md` procedures are a **plan, not completed physical Security v2 evidence**.

## CI evidence: repeatable vs measured

```bash
npm ci
npx tsc -p tsconfig.network-simulator-v1.json --noEmit
npx tsc --noEmit
npm test -- --runInBand \
  __tests__/bushmeshNetworkSimulator.test.ts \
  __tests__/bushmeshConvoyCampaigns.test.ts \
  __tests__/wave5FieldReliability.test.ts \
  __tests__/wave5FieldBenchmarks.test.ts \
  __tests__/appRadioNativeStopLifecycle.test.ts \
  __tests__/radioSessionNativeLifecycleAuthority.test.tsx \
  __tests__/meshcoreChannelAcceptance.test.ts \
  __tests__/meshcoreChannelData.test.ts \
  __tests__/outbox.test.ts \
  __tests__/transmissionController.test.ts \
  __tests__/convoyMapModel.test.ts \
  __tests__/deviceGpsReadiness.test.ts \
  __tests__/offlineMapPacks.test.ts \
  __tests__/wave2AuthenticatedPositionIngress.test.ts \
  __tests__/wave4TelemetryStagingGate.test.ts \
  __tests__/groupSecurity.test.ts \
  __tests__/replayGuard.test.ts
```

CI runs in Node 22.13.0 using the checked-in dependency lockfile, the unmodified canonical simulator and the existing real JS radio/ownership/map/GPS/security-test surfaces. Scope is React Native/Jest, *not* native Android build, BLE GATT on hardware or actual LoRa.

### Fixed seeds

| Case | Virtual vehicles | Seed | Assertions |
|---|---:|---|---|
| Lane-change convoy chaos | 2 | `0x510002` | packet loss, reorder, retry, partition, GPS/carrier blackout and recovery |
| Lane-change convoy chaos | 3 | `0x510003` | same |
| Lane-change convoy chaos | 5 | `0x510005` | same |
| Lane-change convoy chaos | 8 | `0x510008` | same |
| Lane-change convoy chaos | 10 | `0x51000a` | same |
| Identical virtual trace replay | 10 | `0x519abc` | bit-for-bit identical report, trace and metrics |
| Missing GPS, stale and fresh fix recovery | 3 | `0x510220` | no fabricated location or fresh heading |
| Carrier outage / deferred unknown delivery | 3 | `0x510221` | pending is unknown until **virtual runtime** receives the packet |
| Synthetic congestion / asymmetric link | 5 | `0x510222` | bounded queue, emergency priority, airtime, loss/drop |
| Fake Security ingress negative matrix | 2 active + witness | `0x510223` | fake epoch, replay, source binding, identity rotation, revocation, embedded ID |
| Channel-only unverified position isolation | 2 | `0x510224` | real app ingress refuses to promote unprotected channel traffic |
| Microbenchmark input workload | 10, 250-map members | `0x51b300` | virtual startup, map scene, tile planning, bounded outbox |

The injected Security adapter uses an explicitly fake Security v1 wrapper. Even passing all spoof/replay tests does **not** validate production signatures, Android Keystore, actual trust and group keys, revocation propagation, or Security v2 enrolment. No protected traffic can be promoted to an authorised app roster from carrier acceptance, private channel PSK, or MeshCore contact discovery.

### Reports

CI publishes two files under `artifacts/wave5-field-reliability/`:

- `deterministic-regressions.json`: seed, node count, exact simulator trace (synthetic), delivery and loss, retries, duplicates, queue maximum/drops, estimated airtime, GPS freshness, negative result metrics and regression failure context.
- `node-benchmarks.json`: Node version, platform, architecture, fixed workload/seed, elapsed/per-operation milliseconds and heap/RSS **deltas** for virtual 10-node startup, 250-member pure map projection, 360×640 offline tile *planning*, and bounded 500-entry outbox cancellation. A job log repeats each measurement as `WAVE5_BENCHMARK_RESULT` for quick comparison.

**Benchmark interpretation:** Node/Jest elapsed time and process memory values are variable by runner and environment. They are measurements of repeatable workloads, *not deterministic numeric guarantees*. No wall-time performance gates or unsupported speedup claim is made. The tile benchmark does NOT open SQLite, read real MBTiles, decode raster pixels, access a native GPU, or prove offline persistence. Real map tile access must be profiled separately on the S22+. Current baseline has no benchmark dataset allowing a trustworthy before/after speedup number.

## Physical hardware script — owner/operator to run (not executed here)

**Safety and preservation:** Use an agreed private Australian frequency/channel and compliant LoRa settings; park vehicles before adjusting radios or phones; never send test STOP/HELP/emergency frames in public traffic. Do not factory-reset radios, uninstall the existing `com.bushmeshmain` app, clear encrypted history/maps, rotate private-channel PSKs, or replace a security field-test app with the production package. Preserve the working **Australia (Narrow)** profile and private channel **#4**, verifying only channel number and profile—never disclose PSK or private keys.

**Minimum rig:** Samsung Galaxy S22+ + Heltec A and LilyGo B; for independent simultaneous end-to-end operation, **a second phone** (record actual model/API) is required. One phone cannot be treated as two concurrent Android owners. Record radio model, firmware build, battery levels, antenna details, Android OS build, app APK/build Git SHA, channel profile, timezone, map pack ID/version/hash, start/end time and test location *coarsely* (no full GPS coordinates by default).

Use one row per check: `PASS / FAIL / BLOCKED / NOT RUN`, timestamp, app SHA, firmware, number sent/accepted/confirmed/received, queue peak and drop, delay percentiles where measured, GPS age/accuracy, screenshot or sanitized log reference, reconnect time, and reason. No results are prefilled.

### A. Stationary device and baseline gates

| ID | Real procedure | Required evidence |
|---|---|---|
| F00 | Verify in-place install on S22+, original profile, Radio History, Melbourne OSM pack/hash; Android permissions and physical Heltec/LilyGo labels | Previous data intact, exact software/hardware inventory, unchanged PSK |
| F01 | A→B and B→A private-channel messages (10 each, uniquely numbered); log firmware acceptance separately from actual arrival | Independent receiver observation for each ID; missing ACK recorded **UNKNOWN**, not delivered |
| F02 | Force-stop/restart app, keep airplane mode/Wi-Fi/cellular disabled, use VIEW PACK and inspect six real Melbourne road tiles | Same reviewed local MBTiles pixels and catalog receipt after restart; no network fetch |
| F03 | Background Radio → confirmed Stop → BLE Tools → disconnect → Background Radio ×3 | S22+ Android native-owner status, no duplicate GATT owner, no leaked connection, retained saved history |

### B. Loss, relay and location reliability

| ID | Real procedure | Required evidence |
|---|---|---|
| F04 | In a permitted private test area, vary distance/antenna orientation without driving while interacting; 20 uniquely numbered A↔B channel messages per condition | RSSI/SNR if measured; packet loss, retry/duplicate accounting; real RF conclusions remain limited to this rig |
| F05 | Switch off one radio or disconnect its BLE deliberately; send five sequential messages; reconnect; check cancel/expiry behavior | No false delivered state, no lost owner cleanup, no stale queued message retransmitted without explicit policy |
| F06 | GPS: initial available fix → indoors/unavailable → stale last-known → restore outdoor fix on S22+, using existing manual GPS controls | Fix age, measured update intervals, accuracy/source, no fabricated fresh fix or unauthorized remote marker |
| F07 | With second phone on LilyGo, observe real packet order/duplication after transient outage or radio restart | Unique IDs vs duplicate UI/history; separated carrier acceptance vs verified peer receipt |
| F08 | Try different send rates **within legal airtime/duty requirements**, record drain and queue pressure; compare safety priority locally without transmitting distress | Queue depth/drop/latency and configured radio limitations; no assumption virtual airtime calibrates LoRa |
| F09 | Park in two groups, separate and regroup real radios, keeping safety-critical use disabled | Document exact topology, visibility and any relay claims separately; two radios alone **cannot prove** canonical multi-hop |
| F10 | Re-check map, GPS, encrypted history, BLE ownership and battery after tests, force-close and restart | No history/catalog/PSK regression; reproducible artifacts, no leakage of coordinates or secrets |

### C. Authenticated convoy/security gates — currently BLOCKED

| ID | Prerequisite | What is permitted now |
|---|---|---|
| S01 | Reviewed and working real Android Security v1 signing/agreement handles, verified trust, replay-protected direct sessions | Only read-only diagnostics until these are established |
| S02 | Formally approved Security v2 owner/admin authority, atomic enrolment, epoch CAS and verifiable installation ACK | Do not attempt operational joining/approval or claim multi-user membership |
| S03 | Live authenticated convoy directory, exact verified GPS/routing-source binding and revoke/high-water reconciliation | Do not display channel-only positions as authenticated, or enable STOP/HELP/HAZARD/REGROUP transmission from unverified membership |

See `docs/WAVE4_TWO_PHONE_TWO_RADIO_ACCEPTANCE.md` for the longer P0–P18 two-phone acceptance procedure. It remains a plan. This script does not substitute fake provider decisions for real Security v2 or guarantee global old-key revocation.

## Diagnostic hand-off and bug-report template

Record: `ID | exact SHA | seed (if synthetic) | phone/radio firmware | steps | expected | observed | status | timestamps | sanitized trace/artifact | native logs if approved | blocking owner`. Classify each outcome precisely: **SIMULATED**, **NODE/JEST COMPILED**, **ANDROID COMPILED**, **USER-REPORTED PHYSICAL**, **DIRECTLY MEASURED PHYSICAL**, or **NOT TESTED**.

Escalate any source-binding mismatch, hidden unverified marker, stale-epoch acceptance, owner handoff that opens two GATT sessions, or old queued packet sent after cancellation to the relevant owner. Do **not** patch production radio/security/map/Drive contracts from this testing-only branch.

### Hard stop / fail-closed criteria

Unknown native ownership, wrong channel/profile, unsupported or failed secure-key probe, broken encrypted-history persistence, lost map SHA, unauthorized verified marker or disabled secure-enrolment gate behaving as active => **STOP / BLOCKED**, preserve logs and rollback details, do not declare physical readiness.
