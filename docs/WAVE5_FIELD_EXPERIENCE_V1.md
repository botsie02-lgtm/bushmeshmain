# BushMesh Wave 5 — Field Experience v1

Repository: botsie02-lgtm/bushmeshmain
Branch: feature/wave5-field-experience-v1
Exact base: 37ded9fa36de2a14970b522a4e9fd1e677534dc2

## Scope and safety

This is production React Native UI code, not a mockup or a new transport.
The existing five-tab Drive / Radio / Convoy / Contacts / Device shell,
AppProviders ordering, ScreenMountGate lifecycle, Background Radio ownership,
native GPS service, Security v1, Protocol v1 and offline map tile renderer
remain the authoritative owners.

The branch must never be merged automatically and must not change main or
integration. The Android workflow invokes **assembleDebug only**. It never
executes adb install, deploys to a Galaxy S22+, or changes the existing phone
installation.

## User journeys

### At-a-glance: Drive and Convoy

- New \`src/app/fieldExperience/fieldPulseModel.ts\` projects actual
  BushMeshContext, RadioSession, LocationSession, OfflineMap and active
  Security-verified convoy provider data.
- \`ConnectedFieldPulse\` consumes those contexts read-only and refreshes
  freshness every 5 seconds.
- \`FieldPulseStrip\` uses four large, two-column navigation tiles
  (Radio, GPS, Maps, Convoy), with distinct available / check / unavailable
  states and accessible labels. Tapping a tile navigates to the existing
  destination; it never sends or starts a radio/GPS session.
- Radio "Connected" alone is insufficient: companion, carrier submission
  handler and canonical datagram transport are separate checks. No field tile
  claims peer delivery, authorisation, or group membership from the carrier.
- GPS status requires validated, sufficiently fresh **native Android GPS**
  readings with reported accuracy. Stale and simulated readings are explicit.
- Map checks distinguish installed verified raster archives, reader support,
  measured trip-point coverage and **actual rendered imagery**. The status
  tiles do not claim raster imagery was loaded.
- Convoy selection remains the existing ActiveOperationalConvoyProvider
  Security v1 directory, not MeshCore contacts/channels. If a roster has not
  been wired, remote counts and locations remain unknown.

### Radio

- \`src/screens/radioPresentation.ts\` is a pure companion/carrier/runtime
  phase model. RadioScreen shows "DISCONNECTED", "COMPANION ONLY" or
  "CARRIER READY" rather than a misleading generic "NODE ONLINE".
- Text submission is only available with an actual selected carrier and
  enabled existing send handler. Carrier text can be available while the
  canonical BushMesh runtime is not; this is called out explicitly.
- Radio acceptance (PACKET_OK) is labelled **RADIO ACCEPTED** and never
  implicitly changed to peer-confirmed. Matching peer ACK remains the
  authority of the existing message status provider.
- Per-channel drafts survive selection changes *without* leaking into a new
  channel's composer. Channel history is strictly scoped to the selected
  channel, or empty when no channel is selected.
- Readable incoming/outgoing labels, timestamp, acceptance/pending/confirmed
  counts, restore/error feedback and an accessible large submission button.
- Dense native inbound/outbound counters are preserved but tucked under
  "Show technical diagnostics"; no diagnostics are deleted.

### Offline maps and Device

- Drive's MapScreen still uses the real ConvoyMap raster renderer; there is
  no substituted map or geocoding/routing implementation.
- Device > Offline map packs now opens the **real** MapPackCatalogPanel
  installer/verification interface, not a second full MapScreen.
- Device Hub's internal storage panel points to that same manager when hosted
  in AppShell, avoiding duplicated installation controls. Standalone
  DeviceHubScreen remains backwards-compatible without the callback.
- MapScreen has a clear verified-member marker feed notice. Its optional
  radio-heard position list is **collapsed by default**, labelled unverified
  and never passed to ConvoyMap.authorisedMembers.
- Legacy direct bearings to radio-heard vehicles are explicitly marked
  **UNVERIFIED** and use the caution styling, even for fresh positions.
  They are not road routing and not trust assertions.
- Trip coverage never says "TRIP COVERED" if no required points exist.
- Map metadata/demo diagnostics are opt-in; destructive "Clear map state"
  requires a separate confirmation. Existing saved pack data is untouched
  by viewing or navigating.

### Secure convoy management

- Existing ConvoyEnrolmentScreen remains backed by
  ConvoyMembershipService and Security v1 directory.
- New read-only EnrolmentMilestones shows authenticated request, recorded
  owner/admin approval, disabled atomic Security v2 transaction, unverified
  recipient installation and no granted membership. A local approval,
  invitation or ACK observation NEVER becomes verified membership.
- Expandable RoleGuide distinguishes owner/admin/member and limitations.
- Security v3/v2 incremental enrolment remains **disabled** without a
  reviewed production provider. The app still passes null/false security
  dependencies until the authoritative staging worker wires them.
- The existing screen now supports callbacks back to Drive and real Map;
  no crypto, enrolment or key distribution code was changed.

### Navigation and accessibility

- Existing 5 tabs remain mounted in the same order with selected states.
  Tabs now have consistent symbols and 64dp touch height.
- Larger 56dp controls on shell/device/radio, improved text size, higher
  contrast secondary labels, responsive 2-column field navigation and
  clearer page hierarchy. No new network dependency or icon package.
- Dense diagnostics are opt-in. This still requires field interactions to
  occur only while safely stopped; the app is not a driving automation tool.
- App Shell does not own or reset long-lived application providers, and
  no persisted user data is migrated, deleted or overwritten.

## Staging interfaces

AppShell already uses these implementations directly.

\`ConnectedFieldPulse\`:
    <ConnectedFieldPulse compact onOpen={section => {
      // section: 'radio' | 'gps' | 'maps' | 'convoy'
      navigateToExistingDestination(section);
    }} />

\`MapScreen\` remains fully compatible with existing consumers:
    <MapScreen
      activeConvoyId={activeSecurityConvoy?.convoyId ?? null}
      authorisedMembers={verifiedPositionProjection ?? []}
      onManageMapPacks={openDeviceMapPackManager}
    />

**Important:** \`verifiedPositionProjection\` is a placeholder for a separately
authenticated Security v1 membership-scoped position feed. This Wave 5 branch
does not synthesize that feed. The shipped AppShell continues passing [] until
a real verified staging integration provides one. Passing ConvoyContext.vehicles,
discovered MeshCore contacts or carrier channel positions here would violate
the security boundary.

\`DeviceHubScreen\` optionally receives \`onOpenMapPacks\`; when absent it
retains its original integrated manager. In AppShell the callback navigates
to the single Device map manager instead.

\`ConnectedConvoyEnrolment\` receives optional \`onOpenDrive\` /
\`onOpenMap\` destination callbacks, but keeps the previous default-deny
service and identity props. Staging must not pass true security readiness
without an actual production provider.

## Testing and field acceptance

A branch-scoped workflow runs:

    npm ci
    npm test -- --runInBand
    npx tsc --noEmit
    npm run lint
    cd android && ./gradlew assembleDebug --no-daemon

The workflow uploads a debug APK for manual review but never installs it.

Added focused tests cover:
- Empty/stale/future GPS, native source requirements and reported accuracy.
- Carrier connected vs channel send vs data runtime and peer ACK distinctions.
- Per-channel message history and draft isolation, diagnostics collapse.
- Measured map pack/reader/coverage vs real imagery claims.
- Visible map marker feed separation, opt-in unverified list and safe clears.
- Admin approval, no installation and never-granted membership milestones.
- Five-tab navigation, touch target sizing and map pack manager routing.

**Screenshots:** no emulator, cloud screenshot runner or physical-device
capture is available in this branch workflow. The Android build is an
artifact, not a screenshot and not proof of visual/physical testing.
Screenshots must be captured from a reviewed Android test device separately;
this branch does not modify the existing Galaxy S22+ installation.

### Manual validation on a separate test installation

1. Start offline with radio disconnected. Radio and pulse must say not ready;
   no peer-delivery claims or composer submission.
2. Connect a MeshCore companion, then test a carrier with and without a
   functioning message handler. Verify link-only vs carrier-ready labels.
3. Switch between two carrier channels with separate unsent drafts and
   histories. Check no draft crosses channels and PACKET_OK is not
   peer-confirmed.
4. Remove GPS or provide an aged fix. Inspect last-known/stale notice,
   accuracy and source. Never substitute a simulated fix as real.
5. Remove verified offline packs; select/verify a real archive in Device,
   open Drive Map and confirm actual raster tile loading separately.
6. With the default security-disabled host, attempt Convoy invitation/join
   flow and inspect milestones. Approval must NEVER grant membership.
7. Inspect unverified radio-heard positions only after explicitly expanding
   their list. Ensure the verified map roster remains empty without trusted
   integration. Direct bearing is marked unverified.
8. Check minimum touch sizes, text scaling, portrait layouts and contrast
   outdoors while stopped. Keep existing S22+ installation intact.
