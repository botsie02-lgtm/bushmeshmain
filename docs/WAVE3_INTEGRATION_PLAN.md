# BushMesh Wave 3 — staged integration coordination and gates

**Protected physical rollback anchor:** \`9956ef244881c79a64e582a08136eceb0a90dce5\`  
**Sole writable integration branch:** \`integration/bushmesh-wave3-staging\`  
**Protected / no changes:** \`integration/bushmesh-wave2-staging\`, \`integration/bushmesh-wave1-staging\`, \`integration/bushmesh-v1\`, \`main\`. No promotion/merge without explicit approval.

## Intake status (inspected 2026-11-09)

All four *anticipated* feature branches currently exist but point to the **same baseline SHA**, not to delivered feature commits:

| Expected branch | Current inspected head | Status |
|---|---|---|
| \`feature/trusted-australian-map-packs-v1\` | \`9956ef24\` | Await authored commits and source validation |
| \`feature/gps-field-validation-v2\` | \`9956ef24\` | Await authored commits and source validation |
| \`feature/drive-field-readiness-v3\` | \`9956ef24\` | Await authored commits and source validation |
| \`feature/convoy-enrolment-security-v3\` | \`9956ef24\` | Await authored commits, security review and production-provider evidence |

**No Wave 3 feature branch has been merged as part of this coordination step.**
Re-read branch heads, ancestry, diff and test results *when delivered*. Do not infer completion from a branch name, or automatically merge based on this table.

## Proposed gated order

1. **Trusted Australian raster pack provisioning** — clear Wave 2's only blocked hardware check. Preflight compile in isolation: manifest provenance/license/attribution, asset creation and deterministic SHA-256, private native install+verification, real raster fixture. Only then merge with an explicit two-parent integration commit and run the complete staging gates.
2. **GPS field validation** — adopt read-only acquisition/fix quality diagnostics and reproducible signal-loss tests without changing the explicit LocationSessionProvider start/stop lifecycle or Android radio ownership. Test field battery and foreground/background wording; do not assume process-restart tracking.
3. **Drive field readiness** — add glanceable availability and map management entry points; consume only verified roster/alerts, and otherwise show unavailable/previews. It may merge with safe read-only functionality **without** waiting for security enrolment, but must not enable transmissions.
4. **Convoy enrolment security** — security-sensitive and conditional: review versioned/frozen contract changes independently, prove production providers and authenticated incremental enrolment, and obtain explicit authorization for any Security v1 contract extension. Until then, merge **at most** inert, verified API/tests; never enable joining, group key updates, remote positions, grants or live Drive actions by assertion. This stage can remain deferred while the map/GPS/Drive improvements are field-tested.

After **each** stage, capture source SHA, exact merge commit, resolved conflicts, changed files, Jest/TypeScript/ESLint/Android results, new regression tests and on-device evidence. Abort forward integration on failed gates; use the immutable Wave 2 rollback anchor. Do not rebase or force-push protected branches.

## Existing public interfaces and ownership rules

| Feature | Existing integration contract | Required future source evidence |
|---|---|---|
| Maps | \`BushMeshMapPackManifestV1\` and \`validateMapPackManifest\`; \`OfflineMapContext.registerMapPackManifest/installMapPack/verifyMapPack\`; \`BushMeshMapPacks\` and native \`BushMeshOfflineTiles.readTileBase64\`; \`ConvoyMap\` via \`nativeOfflineTileSource\` | Reviewed legally usable raster data, versioned trusted manifest catalog/provisioning UI, HTTPS artifact with exact size/SHA and attribution, valid native receipt, actual \`Image.onLoad\`, offline restart, no online fallback |
| GPS | \`DeviceGpsSettingsPanel\`, \`gpsPreferences\`, \`AndroidGpsLocationProvider\`, \`LocationSessionProvider\` | Fix age/accuracy/source/heading, future/stale/unavailable state, observed cadence vs Android *request hints*, battery-aware reports, location-outage regression, privacy-safe summary (exclude exact coordinates by default), independent manual GPS permission/start/stop |
| Drive | \`ConnectedDriveDashboard\` in five-tab \`AppShell\`, \`DriveDashboardTrustedInputs\` (\`roster\`, \`verifiedAlerts\`, \`carrierBinding\`), current radio/GPS/map providers | No forged roster or alert input; guarded freshness/identity/carrier binding; accessible Device map-pack management; never equate archive metadata with rendered basemap; preserve Radio and Device tabs; no implicit send |
| Convoy Security | \`ConvoyMembershipService\`, \`SecurityV1ConvoyMembershipAdapter\`, \`AuthorizedConvoyDirectory\`, \`CryptoProvider\`, \`SecurityMetadataStore\`, \`SecureSecretStore\`, \`GroupKeyManager\` | Production-backed opaque key handles and durable stores, atomic replay/nonce behavior, authenticated incremental add-member/epoch+roster update, admin authority proof, session/AAD identity binding, revocation/rotation/invalidation, verified group lifecycle and source/embedded-ID consistency |

### Security hard stop

The **current** Wave 2 \`ActiveOperationalConvoyProvider\` uses \`unavailableConvoyDirectory\`; Drive passes \`roster={null}\`, \`verifiedAlerts={null}\`, \`carrierBinding={null}\`. **Preserve those defaults until justified by genuine production Security v1 state.** The in-memory WebCrypto test provider and encrypted UI preferences are not a production Security v1 lifecycle. Frozen \`GroupKeyManager\` has no authenticated incremental roster-add API; \`approved-awaiting-security\` remains pending, not authorization.

Require a reviewed, versioned protocol/security change (if necessary) before changing frozen contracts. No PSK, public MeshCore contact, unverified packet, invitation, local admin label or saved convoy record grants access. Do not expose remote owner/admin elevation, revocation propagation, verified position markers or STOP/HELP/HAZARD/REGROUP radio transmissions without end-to-end authenticated identity, roster, carrier binding, freshness and proof. Keep \`acceptAuthenticatedConvoyPosition\` fail-closed on embedded node ID vs authenticated routing source mismatch. Retain tests for compromised/revoked peers, replay, wrong source, stale location, and denied action.

### Native BLE/radio invariants — no regressions

- Exactly one active BLE GATT owner: React Native BLE Tools **or** Android-native Background Radio. Never use an unknown-status fallback as permission to take ownership.
- Preserve native command-session recovery, write callback confirmation separate from firmware \`PACKET_OK (0x00)\` acceptance and from **peer delivery**, and no auto-retry on uncertain submission.
- Preserve live inbound \`0x83\` queue handling, de-duplication, encrypted Radio History, persisted reconnect-target cleanup, and retryable **actual** stop/disconnect.
- GPS foreground location requests and session persist independently of a radio Stop. Never change Australia (Narrow), channel #4, or its PSK as part of Wave 3 integration.
- Do not claim always-on background/process-restart GPS or radio delivery merely because a provider/interface compiles.

## Build / integration gate (required for **every** stage)

1. Check source branch head is a new, reviewed commit and record \`git merge-base\`, changed public APIs, Android registration, dependency/persistence migrations, and overlap with current staging. No blind merge.
2. Run standalone preflight for the map and Drive sources **before merge**; isolate fixes and preserve traceability. Do not advance staging until preflight is green.
3. Merge only into Wave 3 staging, record two parents (staging and exact feature head), keep the validated radio foundation intact. Stop and reconcile explicit conflicts rather than overwriting its files.
4. Require \`npm ci\`, \`npm test -- --runInBand\`, \`npx tsc --noEmit\`, \`npm run lint\`, \`npx tsc -p tsconfig.network-simulator-v1.json --noEmit\`, \`cd android && ./gradlew assembleDebug --no-daemon\` and \`./gradlew :app:testDebugUnitTest --no-daemon\`. Existing \`.github/workflows/ci.yml\` runs these on integration pushes. Zero lint errors; record warnings separately.
5. Retain the isolated multi-node simulator suites/seeded chaos and source/embedded-node mismatch check; **never merge** unrelated simulator runtime or branch history. Simulator pass is not RF proof.
6. Test the map workflow and complete S22+ regression checklist in \`docs/WAVE3_ANDROID_RASTER_ACCEPTANCE.md\` before marking Wave 3 hardware-validated. No app-data wiping or credential renewal during normal upgrade.

## Exit criteria and release decision

**Ready to integrate:** New feature source SHA plus independent tests and complete compatible public contracts; no failed build gates.  
**Ready for Wave 3 physical testing:** Integrated debug build passes all CI gates, trusted raster artifact and registration path are available, safe Security v1 gates remain intact.  
**Wave 3 hardware-validated:** A reviewer records actual map pixel rendering online/offline and negative pack tests, all seven carried-forward Wave 2 radio/UI checks on a Galaxy S22+, three handoff cycles, and any additional feature-specific field observations. Do not infer physical validation from Jest, Android assembly or PMTiles fixtures.
