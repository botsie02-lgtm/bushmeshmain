# BushMesh Drive field readiness v3

Branch owner: src/drive/fieldReadiness only. This module does not change
AppShell, the physically tested ConnectedDriveDashboard, radio transport,
native GPS, Security v1, Protocol v1, or map rendering.

## What is included

- FieldReadinessDashboard: read-only, vehicle-first React Native briefing.
- ConnectedFieldReadinessDashboard: read-only host using the already existing
  useDriveDashboardController, OfflineMapContext and LocationSessionContext.
- deriveFieldReadiness: pure, deterministic model with an injected clock,
  preserving existing dashboard/TripReadiness/ConvoyMap contracts.
- Large (minimum 56 dp) navigation buttons and (minimum 96 dp) quick-action
  previews. The critical STOP and HELP previews require a second tap.
- Four separate status levels plus "awaiting authorisation":
  connected / degraded / unavailable / stale / awaiting-authorisation.
- Explicit native GPS position age, accuracy, heading and last-known warnings.
- Active convoy remote membership count only when the existing trusted
  dashboard reports an authorised, verified roster; no public contact counts.
- Verified-alert priority for STOP/HELP. Legacy raw carrier messages are shown
  separately as recent MeshCore traffic, never as authenticated messages.
- Map archive inventory and installer readiness, plus an explicit message
  when raster imagery has not really been observed as loaded.
- A dedicated "Manage offline map packs" button. This callback MUST navigate
  to the existing Device map-pack installation/verification screen, not a
  simulated or hardcoded pack list.

## Integration example

Import from src/drive/fieldReadiness.

    <ConnectedFieldReadinessDashboard
      roster={verifiedActiveConvoyRoster}
      verifiedAlerts={authenticatedConvoyAlerts}
      carrierBinding={authorisedCarrierBinding}
      onOpenMap={openRealConvoyMap}
      onManageMapPacks={openRealDeviceMapPackManager}
      onOpenConvoy={openConvoySelection}
      onOpenRadio={openRadioScreen}
      onOpenGpsSettings={openDeviceGpsSettings}
    />

These navigation callbacks are REQUIRED because this feature branch does not
own AppShell. Staging must pass the actual handlers and keep app-lifetime
providers mounted above the dashboard. The component does not start GPS, make
BLE calls, select carrier channels, or modify Background Radio ownership.

Alternative: drive the pure FieldReadinessDashboard component with
deriveFieldReadiness(input). The pure input includes a trusted DriveDashboardModel
from deriveDriveDashboard, installed-pack catalog, map persistence/install
availability, optional measured speed, nowMs and optional imagery evidence.

## Trust, readiness and quick actions

The existing authenticated active-convoy context and verified scoped roster
must remain the sole source of member status. A MeshCore contact, channel, PSK,
invite, or unverified raw position does not establish authorised membership.

The Connected host deliberately takes the same trusted inputs as
ConnectedDriveDashboard. Missing, revoked or mismatched membership must be
represented as null/unverified by the existing Security v1 adapter; unknown
member counts remain UNKNOWN, not 0. Verified alerts are only accepted when
the trusted dashboard has a verified roster and scoped alert feed.

All quick actions in THIS field briefing are LOCAL PREVIEWS, even with a
fully ready radio and active membership. They can NEVER transmit because the
component has no send callback and the Connected host does not call
useDriveDashboardController().performAction or any queue method. STOP/HELP
need confirmation to open an informational preview. HAZARD/REGROUP show
a local preview directly. No preview is represented as sent or delivered.
If any future staging work enables actual transmission, it must use the
existing Security v1 membership/carrier binding plus radio action controller,
with a separate explicit user decision; do not retrofit a raw send callback
to this read-only component.

When valid native GPS reports speed above 5 km/h, complex interactions and
previews are disabled; the map launch remains available. Speed unknown is
never portrayed as "stationary"; the screen always reminds users to interact
only when safely stopped.

## Real offline map imagery

Download and checksum verification alone DO NOT prove an image was rendered.
The existing native tile reader's isAvailable() is also not evidence that a
particular raster was loaded. The view therefore defaults to:

    Offline map imagery NOT confirmed loaded

The optional MapImageryEvidence union accepts a recent, pack-ID/version-matched
actual raster image load or failure event:

    {
      kind: 'loaded',
      packId: 'existing-verified-pack-id',
      packVersion: 'existing-manifest-version',
      observedAtMs: Date.now()
    }

Staging/map owner must obtain this from the REAL ConvoyMap Image.onLoad event
(or equivalent verified rendered-image callback) after validating pack
identity. The current ConvoyMap public interface does not yet publish that
callback; without this additional integration, DO NOT pass a fabricated
evidence object. Expired (>60 s), future or mismatched evidence is ignored.
Even after a genuine image load, the label is "recently confirmed", not
"currently navigating". Trip coverage requires separately validated points;
no route guidance or driving safety is claimed.

## Test coverage

src/drive/fieldReadiness/__tests__/fieldReadinessModel.test.ts:
empty state, disconnected/degraded radio, stale/invalid/native GPS, missing
and revoked membership, verified member status, missing/downloading/invalid
packs, raster load evidence checks, alerts and moving state.

src/drive/fieldReadiness/__tests__/FieldReadinessDashboard.test.tsx:
map and real pack-management navigation, non-transmitting STOP/HELP/HAZARD/
REGROUP previews, second-tap critical confirmation and cancellation, revocation
reset, disabled interactions when moving, readable verified STOP alert, target
sizes.

Validation commands requested for integration:

    npm ci
    npm test -- --runInBand
    npx tsc --noEmit
    npm run lint
    cd android && ./gradlew assembleDebug

Because no shared AppShell or CI files are owned by this branch, do not change
those files to force a workflow. Run these checks in a repository checkout or
a CI runner capable of checking out the feature branch.
