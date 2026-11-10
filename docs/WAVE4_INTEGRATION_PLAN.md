# BushMesh Wave 4 staging: scope, ownership, merge sequencing and CI gates

**Only writable integration ref:** `integration/bushmesh-wave4-staging`  
**Exact protected, user-reported hardware rollback:** `ca3388e54deafbe5e6bc854c1a145873a1508d01`  
**Created on:** 10 November 2026, from the precise Git commit above (not from a moving branch).  
**State:** planning / safety infrastructure; **no Wave 4 source feature merged**.

## Protected regression foundation

`docs/WAVE3_HARDWARE_ACCEPTANCE_REPORTED.md` records the Galaxy S22+ user's specific Wave 3 passes: genuine Melbourne OSM import/hash, six loaded tiles, VIEW PACK, airplane mode offline map after force-close, encrypted history, bidirectional Heltec/LilyGo messaging, three BLE ownership cycles, clean Background Radio Stop, Drive and GPS diagnostics. These are user reports, not CI's own device evidence.

Do not change Wave 3, Wave 2, Wave 1, legacy integration, main or the existing simulator source. No force merges, overwritten refs, app-data deletion or channel-PSK rotation. Maintain Australia (Narrow) MeshCore private channel #4 and radio's single native BLE owner. Keep app-wide Background Radio provider above the five-tab navigation, existing offline catalog/native verified raster reader, GPS manual control, and map offline-only image loads.

## Source-ref discovery at Wave 4 branch creation

| Workstream | Source branch | Observed HEAD on 10 Nov 2026 | Integrated? |
|---|---|---|---|
| Security v2 transactions | `feature/security-v2-group-transactions-v1` | `ca3388e54deafbe5e6bc854c1a145873a1508d01` | **NO** |
| Android cryptographic/persistence providers | `feature/android-production-security-v1` | same Wave 3 baseline | **NO** |
| Verified convoy telemetry | `feature/verified-convoy-telemetry-v1` | same Wave 3 baseline | **NO** |
| Convoy enrolment UI | `feature/convoy-enrolment-ui-v1` | same Wave 3 baseline | **NO** |
| Deterministic independent simulator | `test/network-simulator-v1` | `2a1f11f6e65b8871eda33ddc74ebbc3106017e9f` | **NO** (reference only) |

**Do not merge any source until its future committed HEAD is explicitly supplied and reviewed.** Always re-read the live source HEAD, compare against `ca3388e54...`, review changes, conflicts, dependency ownership and the actual CI run for the exact source SHA. Do not substitute current branch tip for the supplied commit or merge the independent simulator's divergent runtime.

## Proposed sequencing — conditional, not permission to activate

1. **Formal security v2 contract gate first.** Read `src/convoy/enrolmentV3/SECURITY_V2_CONTRACT_PROPOSAL.md`, `docs/WAVE3_SECURITY_V2_FORMAL_REVIEW.md` and `docs/WAVE4_SECURITY_V2_REVIEW_GATE.md`. Obtain explicit threat-model, API, transaction/authority/rollback and Protocol v1 AAD approval **before any live add-member implementation**. No approval exists yet.
2. **Production Android provider candidate.** Once delivered, inspect algorithm implementation, persistence ownership, on-device hardware capability evidence and device restart tests; may merge **inert and unregistered** behind explicit fail-closed capability checks only after its own CI and security review. A Keystore AES UI prefs module is not evidence for Security v1 signing/X25519 identity, or atomic group epoch state.
3. **Security v2 group transaction implementation.** Only after approved contracts and production provider prerequisites; test atomic prepare/commit/new epoch, owner-anchor authorization, signed distribution/install ACK, rollback/replay/crash and partial delivery. Keeping a candidate module disabled is not approval to switch on join completion.
4. **Verified convoy telemetry.** Read-only model/services may be merged independently if their default is unavailable and ingestion rejects unauthenticated, wrong-group, revoked, stale or embedded-ID-mismatched data. Do not populate Drive roster, authenticated location or quick-action carriers from public contacts, PSK or unsigned metadata.
5. **Convoy enrolment UI.** Safe request/approval **preview**, pending/unavailable states and non-transmitting controls can merge independently with all production commands gated. The live ActiveOperationalConvoyProvider continues using `unavailableConvoyDirectory` until a genuinely implemented, independently reviewed authorized directory is ready. No mock success/administrative privilege or fabricated ACK.
6. **Final end-to-end release candidate.** Require explicit, separately reviewed activation approval only after every gate below, then new staging CI and two-phone/two-radio physical test. A green compile does not imply security readiness.

The order of steps 2–5 can change if delivered source has independent harmless UI/read-only changes, but **the dependency and activation gates cannot**. Keep Security v1 and Protocol v1 frozen unless a documented, approved compatibility extension is unavoidable.

## Current contracts and ownership boundaries

| Boundary | Current owner | Required preserve/review |
|---|---|---|
| Identity/trust/keys | `src/security/{ports,types,identity,trust,session,group,nonceReplay}.ts` | Ed25519/X25519 raw 32-byte public keys; opaque handles; no arbitrary metadata membership |
| Incremental enrolment proposal | `src/convoy/enrolmentV3/{contract,compatibility,roleCredential,joinStore}.ts` | `SECURE_ENROLMENT_V3_ACTIVATION='disabled-pending-security-v2-review'`; `executeIncrementalEnrolment` throws |
| Live membership resolution | `App.tsx` and `src/app/activeContext/*` | `ActiveOperationalConvoyProvider` defaults to `unavailableConvoyDirectory` |
| Authenticated positions | `src/convoy/membership/authenticatedPositionIngress.ts` | Verified routing source node equals embedded vehicle node; current protected group + authorization required |
| Radio and native BLE | `src/state/Radio*Context.tsx`, `android/.../radio` | Single native owner, Stop, handoff, encrypted History; no changes without regression proof |
| Maps and GPS | `src/maps`, `src/state/{OfflineMapContext,LocationSessionContext}.tsx` | Genuine local Image.onLoad; raster hash/receipt/restart; manual GPS, no auto permission |
| Drive/quick actions | `src/app/shell/AppShell.tsx`, `src/drive/fieldReadiness` | Null untrusted roster/alerts/carrier; local STOP/HELP/HAZARD/REGROUP previews |
| Simulator | `src/bushmesh/testing/networkSimulator` plus independent reference branch | Seeded failure cases; not a replacement for real RF/Android hardware |

## Wave 4 CI baseline and stage-by-stage gates

`.github/workflows/ci.yml` executes on `integration/**` branches, including Wave 4 staging. On every Wave 4 push and after each permitted merge, require:

1. Wave 4 **static pre-activation safety guard**, `python3 tools/integration/wave4_security_gate.py`. This catches simple accidental live wiring, not cryptographic correctness. Changing the guard requires its own explicitly reviewed security change, never a test-only bypass.
2. `npm ci`, full `npm test -- --runInBand` including trust/session/group/replay, simulator, radio, offline maps, GPS, five-tab and no-GPS VIEW PACK tests.
3. `npx tsc --noEmit`, `npm run lint` (no errors; document warnings), `npx tsc -p tsconfig.network-simulator-v1.json --noEmit`.
4. `python -m unittest discover -s tools/maps -p 'test_*.py'` plus genuine PBF provenance fixture evidence for any changed real generator; never convert fake tiles into "real" evidence.
5. Android `./gradlew assembleDebug --no-daemon` and `:app:testDebugUnitTest --no-daemon`, including native security tests once present, plus debug-signing-key standalone `assembleRelease` and bundled Hermes VIEW PACK verification.
6. Preserve Wave 3 radio lifecycle, three-owner-cycle, history, real raster, airplane restart, GPS and Drive physical regression **after** CI; no CI/emulator claims of actual Heltec/LoRa hardware proof.
7. Document exact staged SHA, source SHA/merge parents/correction SHAs, completed CI run URL and any waiver (security safety waivers are **not allowed**), then move to the next stage only if fully green.

**Blocking failures:** Jest, TS, ESLint errors, simulator, map generator, native JVM, APK packaging, or any gating/security regression. StrongBox not available is not a reason to silently switch algorithms. Until reviewed as a separate mode, unsupported Curve25519 platform hardware is a **fail-closed production capability**.

## Wave 4 exit criteria

Security formal review approved with signed-off risk model and compatibility tests; actual Android cryptographic provider on each intended Android API/device, restart-durable protected state; reliable authorized group roster/key epoch transactions and signed installation ACK; real identity-bound member position dissemination; all automated gates; user-executed two-phone/two-radio and baseline regression acceptance with redacted evidence. Until then **Wave 4 remains staging only, not authenticated or hardware validated**. See `docs/WAVE4_TWO_PHONE_TWO_RADIO_ACCEPTANCE.md`.

## Stage 1/2 source review ledger — 10 November 2026 update

This is the **updated** state. The earlier table above records the observed source branch heads *when Wave 4 was created*, not later integration status.

| Stage | Source SHA | Preflight on staging | Two-parent merge / post-merge CI |
|---|---|---|---|
| 1 — Safe Convoy enrolment UI | `07cdcabb073d2b8100478e355b63cdc9b567c939` | `89fe9525f2713d6703a36cf98cf4f18c6f493a1a`, [successful complete CI](https://github.com/botsie02-lgtm/bushmeshmain/actions/runs/42754727594) | `d62eca08c93ba59d656ea4cf928356cb97823260`, [successful complete CI](https://github.com/botsie02-lgtm/bushmeshmain/actions/runs/42755396222) |
| 2 — Verified telemetry library | `49f0ac35fffb59a9a9c7598e7533297b4ebe9f9a` | `a3322cc360274652a5051597ff840a9be1509a5f`, [preflight workflow](https://github.com/botsie02-lgtm/bushmeshmain/actions/runs/42756126447) | Traceable merge commit follows only after the preflight is fully green; inspect this staging branch's history and CI runs for the final SHA |
| 3 — Security v2 group transactions | `8eeb659dfb2156c676cf1b69d407edb644cdcff8` | Review only — [isolated source CI passed](https://github.com/botsie02-lgtm/bushmeshmain/actions/runs/42753389618) | **NOT MERGED**; formal contract blocked pending full production `SecurityV2TransactionalStore` and independent review |
| 4 — Android production security candidate | `b0558b643ffed8e839267bca16d4ae5cd363536b` | Review only — [isolated source CI passed](https://github.com/botsie02-lgtm/bushmeshmain/actions/runs/42752679340) | **NOT MERGED**; exact Galaxy S22+ hardware Ed25519/X25519 still unverified |
| Independent simulator | `e843d957e96536de00aa72401c37eefc4cf37500` | [isolated source CI passed](https://github.com/botsie02-lgtm/bushmeshmain/actions/runs/42752161188) | **NOT MERGED**; divergent source history; shadow state, not production crypto |

**Actual Stage 1 mounting:** `ConnectedConvoyEnrolment` is reachable via Convoy → **View unavailable secure enrolment**. Its hook receives default null service/identity and false production/transport flags; it cannot create invitations, approve, join or grant membership. Existing carrier tools remain reachable with their explicit legacy warning; five tabs and app-level radio providers are untouched.

**Actual Stage 2 mounting:** `VerifiedConvoyTelemetry` is a compiled and unit-tested **library, with no live instantiation**. No runtime inbound subscription, outgoing queue, GPS feed, map/Drive member projection, sequence allocator, verified roster or airtime provider is installed. See `docs/WAVE4_VERIFIED_TELEMETRY_ADAPTER_GATES.md`. The staging default `unavailableConvoyDirectory` remains authoritative.

**Security and Android review:** See `docs/WAVE4_SECURITY_V2_ANDROID_COMPATIBILITY.md` for all required transactional-store APIs and unimplemented methods. See `docs/WAVE4_ANDROID_ISOLATED_SECURITY_FIELDTEST.md` and the manual `wave4-isolated-android-security-fieldtest.yml` diagnostic build; it checks out the Android **source branch by SHA**, uses a completely separate Android package and user-data namespace, and never injects the provider into the normal Wave 4 app.

**Physical regression:** `docs/WAVE4_GALAXY_S22_REGRESSION_CHECKLIST.md`. The full genuine-join rig is `docs/WAVE4_TWO_PHONE_TWO_RADIO_ACCEPTANCE.md`. The existing Wave 3 hardware pass is user-reported, not an independently repeated Wave 4 acceptance.
