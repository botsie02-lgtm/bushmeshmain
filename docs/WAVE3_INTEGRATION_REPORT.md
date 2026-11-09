# BushMesh Wave 3 staged integration record

**Integration branch:** `integration/bushmesh-wave3-staging`  
**Physically tested rollback anchor:** `9956ef244881c79a64e582a08136eceb0a90dce5`  
**Protected branches:** Wave 2 staging, Wave 1 staging, legacy integration and main remained unchanged.  
**Wave 3 physical test state:** NOT TESTED / not production-authenticated.

## Reproducible merge ancestry

| Stage | Source head | Recorded staging merge | Resolution |
|---|---|---|---|
| Trusted Australian raster packs | `13a0a5b256d141c259427f25e515a074f594407c` | `5f2dc33565efeb9e25dcb7f236e728d045bcba60` | Disjoint source files; added CI synthetic MBTiles fixture generation |
| Read-only GPS field diagnostics | `1e639cdd5f0849c4252ecf034124209d00ac6c7b` | `cac4c124253327c5a882b24058e4541a8896a4bc` | Disjoint source files; reused existing Device GPS preferences and LocationSessionProvider |
| Drive field readiness | `d8efff8bf694ae4c68126112d4083bda730b97d8` | `360504e59be398a7a2cb93718f947d10beca37dd` | Preflight integrated real App Shell routes, then recorded two-parent merge with no changed code tree |
| Disabled convoy security proposal | `01ff708eda8609e4dffe0cc8d9833d23ea8d1bcd` | `1e3d80aeb6213f609c64443ec1eca347edd3a126` | Proposal, compatibility adapter, tests and formal review; no operational activation |

### Traceable Drive preflight corrections

- `9d14aed796d1191f5b36abdd4bf5b0b73947b257`: source preflight + Field Readiness as default, tested detailed dashboard retained as separate screen; routes to map, Device packs, GPS preferences, Radio and Convoy.
- `7059f6ffdb197f563bde63f7d2dc1d4a360125f5`: repair React Native text-node assertion expectations and Device subsection navigation test.
- `8cfea24798e3b6a4d3d58f847151aea88f71f0c5`: explicitly route the Device GPS hub button to manual controls, while Drive's GPS details opens diagnostics/preferences.
- Only after complete preflight CI passed did staging record `360504e5` as a two-parent merge referencing the exact Drive source.

### Stage validation gates

Each stage's integration ref passed GitHub Actions `.github/workflows/ci.yml`: `npm test -- --runInBand`, `npx tsc --noEmit`, `npm run lint`, isolated simulator TypeScript compile, deterministic synthetic MBTiles Python fixture, `cd android && ./gradlew assembleDebug --no-daemon`, and `./gradlew :app:testDebugUnitTest --no-daemon`. The Drive preflight initially found test assertion and navigation expectations, which were fixed **before** its merged source ancestry was recorded. Preserve the workflow run IDs as validation evidence, not hardware evidence.

The final release-packaging change adds a GitHub Actions APK artifact **only after** successful Android compilation and native fixtures. In GitHub Actions, open the workflow run for the FINAL Wave 3 head and download `bushmesh-wave3-debug-<full-SHA>` from the run Artifacts section. Install `app-debug.apk` **over** the previous app, preserving application data. The APK is not hardware validated by this artifact upload.

### Canonical ownership and threat boundaries

- No modifications to frozen Protocol v1, Security v1 or native Background Radio ownership. Keep the existing Australia (Narrow) MeshCore profile, private channel #4 PSK, two-way Heltec A/LilyGo B transmission, outgoing `PACKET_OK (0x00)` semantics, incoming `0x83` processing, encrypted Radio History, clean Stop and three-cycle BLE Tools handoff.
- Maps: Manual operator-reviewed manifest/fingerprint is **not** a signed publisher catalog. Installer verification of size/SHA, raster metadata and image sample is not proof that real map imagery rendered. `ConvoyMap` must load real image pixels on the device. The new Field Readiness model is deliberately passed no fabricated `imageryEvidence`.
- GPS: Read-only diagnostics consume the existing session, measured fix intervals are not Android request frequency; no auto-start, additional permissions, radio changes, or process-restart tracking claim.
- Drive: Field briefing and preserved detailed dashboard show only null unverified roster/alerts/carrier binding; local STOP/HAZARD/HELP/REGROUP previews never transmit.
- Security: `src/convoy/enrolmentV3` is design-only, disabled. `ActiveOperationalConvoyProvider` defaults to `unavailableConvoyDirectory`. No signed proposal, channel PSK, contact, local role, invite or unverified position is authorization; no member is added. See `docs/WAVE3_SECURITY_V2_FORMAL_REVIEW.md`.
- Simulator: the independent reference `test/network-simulator-v1` at `2a1f11f6e65b8871eda33ddc74ebbc3106017e9f` has a divergent history, which was NOT merged. The isolated deterministic simulator carried from the validated baseline continues to run; its identity-mismatch checks do not replace physical RF tests.

**Required physical acceptance:** `docs/WAVE3_UNIFIED_HARDWARE_ACCEPTANCE.md`. An APK with green CI is only **ready for physical Wave 3 testing**, never a demonstrated radio/map pass or production-enrolled convoy.
