# Drive dashboard v2 — staging handoff

This feature branch adds reusable Drive dashboard files only. It does NOT edit App.tsx, AppShell.tsx, DriveScreen.tsx, other screens, app-lifetime providers, radio ownership, BLE, GPS, or frozen Protocol/Security files.

## Public interfaces

All exports are from src/drive/dashboard/index.ts.

- DriveDashboard: presentation-only React Native component. Props (DriveDashboardProps) include model: DriveDashboardModel, packCatalog, onOpenMap(), onOpenConvoy(), onQuickAction(code); optional onOpenRadio, onOpenDevice, onDismissVerifiedAlert, busyAction, actionResult, showInlineMap, nowMs.
- ConnectedDriveDashboard: drop-in App Shell host. Requires onOpenMap and onOpenConvoy callbacks; optional roster, verifiedAlerts, carrierBinding inputs are NULL by default. Reads existing app providers and uses the existing quick-action queue.
- useDriveDashboardController: headless hook returning {model, packCatalog, busyAction, actionResult, performAction}.
- deriveDriveDashboard(input): pure deterministic projection with explicit nowMs for testing and alternate hosts.
- VerifiedConvoyRoster, VerifiedConvoyAlerts and AuthorisedCarrierBinding: staging-supplied trust assertions, not membership or cryptography implementations.
- decideDashboardAction / performDashboardAction: use existing quick-action definitions, code/TTL values, RadioSession queueDriverAction and drainOnce; no new transmission engine.

## Example shell integration

Render ConnectedDriveDashboard BELOW AppProviders and ActiveOperationalConvoyProvider, inside the shell's Drive tab:

    <ConnectedDriveDashboard
      onOpenMap={() => navigateToDriveMap()}
      onOpenConvoy={() => navigateToConvoySelection()}
      onOpenRadio={() => navigateToRadio()}
      onOpenDevice={() => navigateToGpsSettings()}
      roster={authorisedRoster}
      verifiedAlerts={authorisedAlerts}
      carrierBinding={authorisedCarrierBinding}
      showInlineMap={false}
    />

These navigation methods are illustrative only: the staging worker must wire the actual shell route handlers. The prominent Open ConvoyMap button must open the real Drive map subview. Set showInlineMap true to embed the existing functional ConvoyMap with the verified member projection and current catalog. Native tile-reader availability remains a separate integration prerequisite.

## Security and ownership — mandatory

1. Only useActiveOperationalConvoy().activeConvoy establishes the selected operational convoy. Its Security v1 directory must remain authoritative and handle revocation/identity changes.
2. Build VerifiedConvoyRoster ONLY from authenticated, authorised membership and scoped position data. Supply {convoyId, localIdentityRef, verifiedBy:'security-v1', members}. Members must be authorised REMOTE members, with explicit position:null when unavailable. NEVER pass BushMeshContext.contacts or the unscoped ConvoyContext.vehicles.
3. Build VerifiedConvoyAlerts ONLY after authenticating the incoming alert, confirming sender membership, and checking active-convoy scope. Current DriveContext.alerts is NOT safe to pass directly. Without verified alerts, the UI explicitly says the feed is unavailable. Raw incoming message counts are labelled carrier traffic, NOT unread or authorised convoy messages.
4. AuthorisedCarrierBinding must tie the selected convoy and local identity to the exact MeshCore channel index under integration policy. MeshCore PSK, carrier name or invite alone proves nothing about membership. Without this binding, all quick actions remain local-only previews.
5. All four included commands (STOP / HAZARD / HELP / REGROUP) include location. Transmission requires active Security v1 context, a matching verified roster, the specific authorised carrier binding, connected radio/transport/identity, and a valid <=30 s fix from the known Android GPS provider. Unknown/simulated GPS, stale/future coordinates, missing membership and channel mismatch fail closed.
6. STOP and HELP require a second confirmation tap before transmission. Busy state blocks repeated presses while radio outcome is processed.
7. The existing radio queue may drain an older packet first. Radio accepted is shown ONLY when the reported entry ID matches this command's new queued entry; radio acceptance is NOT peer delivery. Unknown outcomes remain queued/unknown. Actual authenticated group delivery must be integrated by the Security/runtime owners, not fabricated by the dashboard.
8. Do not remount AppProviders or control native radio ownership when mounting the dashboard.

## GPS, maps and readiness

- LocationSessionContext.latestFix supplies position/heading/accuracy and timestamp. Existing getConvoyFreshness supplies live <=30s, recent <=120s, stale <=600s and lost. Stale data is labelled last-known, never current navigation.
- getTripReadiness is reused with stricter authorised convoy, roster, carrier and native GPS prerequisites. DRIVE SETUP READY does not guarantee safe driving, routing, message delivery, or map tile readability.
- OfflineMapContext.coverage, requiredTripPoints and packCatalog are combined with nativeOfflineTileSource.isAvailable(). Zero trip points are NOT evidence that a route is covered. Archive metadata without a tile reader is NOT a rendered basemap. ConvoyMap still reports actual tile read failures.
- Dashboard never starts/stops GPS or BLE; it only consumes current provider state.

## Tests and verification

- src/drive/dashboard/__tests__/driveDashboardModel.test.ts: trust scoping, GPS age, member counts, alerts, traffic, offline packs/readiness.
- src/drive/dashboard/__tests__/quickActionController.test.ts: previews, acceptance attribution, queue errors and unknown outcomes.
- src/drive/dashboard/__tests__/DriveDashboard.test.tsx: safe empty presentation, button sizes, STOP/HELP confirmation and map member isolation.

Recommended staging checks:

    npm ci
    npm test -- --runInBand
    npx tsc --noEmit
    npm run lint
    cd android && ./gradlew assembleDebug

The base CI workflow does not trigger on feature branch pushes, and an Android emulator/screenshot is not provided with this branch.
