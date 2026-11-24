# Wave 5 Field Location Sharing — trust boundaries and physical-test handoff

**Branch:** feature/wave5-field-location-sharing-v1
**Exact base:** 37ded9fa36de2a14970b522a4e9fd1e677534dc2
**Activation:** NO new live feature is mounted in AppShell, existing screens, map or GPS provider. No hardware test is claimed.

## Path A — verified telemetry (DISABLED)

The existing VerifiedConvoyTelemetry library is unchanged. src/convoy/fieldLocation/verifiedBoundary.ts adds a manually installed, inbound-only adapter to canonical BushMeshV1RuntimeService.subscribeInboundResults, rejecting every non-accepted, non-protected-group, non-Convoy event before forwarding to the library's existing sender/epoch/roster/AAD checks. The separate verifiedMapMembersIfAuthorized helper checks an independently revalidated AuthorizedConvoyDirectory membership before AND after reading verified telemetry projection, refusing stale identity/convoy/membership references.

Wave 4 gates are still absent: authenticated current roster, approved Security v1/v2 key and revocation lifecycle, sourceNodeId bound cryptographically to the current sender DeviceIdentity/fingerprint, durable security replay/nonce state, sender protocol sequence allocation and approved LoRa airtime reservation. The production activation constant is deliberately disabled. Do not install a live verified sender or pass channel-only data into any verified projection. A private channel PSK or a sender-chosen name is NOT authenticated convoy membership.

## Path B — optional UNVERIFIED CHANNEL POSITION field-test path

Supported existing transports: AppRadioConnectionService.sendChannelMessage already calls the active native or JS-GATT MeshCore SEND_CHANNEL_TXT_MSG (0x03), where PACKET_OK means local firmware accepted a command, NOT peer delivery. The existing 0x08/0x11 MeshCore channel receive parser provides channel slot, text, timestamp and link metadata, but **no authenticated source radio/device identity**. Field-test wire labels and the session token can be spoofed by anyone holding the channel key. The new module NEVER claims verified sender identity.

MeshCoreInbox now has an optional passive observer independent of its existing persistence-first single consumer. The field adapter uses this observer, existing AppRadioConnectionService owner, existing radio modem profile, nativeRadioService secure random and a READ-ONLY snapshot of LocationSessionProvider. It does not open another BLE connection, rewrite firmware or manage GPS start/stop.

- Wire: BMFL1|24hex-session|uint32-sequence|GPS-milliseconds|lat-E5|lon-E5|claimed-label. Strict seven fields; at most 110 UTF-8 bytes, legal coordinates, safe canonical integers, 1–12 ASCII label characters. Existing MeshCore text limit is 133 characters. This is NOT a Protocol v1 Convoy frame or a Security v1 object.
- Explicit enable: user sees full CHANNEL_FIELD_PRIVACY_WARNING, chooses a currently configured nonzero-secret private channel slot and a claimed display label, then presses Start. App reconnect/restart never auto-enables. No persisted opt-in.
- Genuine GPS only: LocationSessionProvider providerLabel must equal Android GPS, with status tracking/tracking-no-link, fix age at most 30 seconds, future skew at most 5 seconds, accuracy at most 100 m. Reject simulations, missing fixes, stale/invalid coordinates.
- Conservative traffic: at least 60 seconds between send attempts; at most six sends per rolling ten minutes; at most 15 seconds of estimated total LoRa airtime per rolling ten minutes. Estimate comes from existing loraAirtime.ts and advertised real modem plus 64 conservative envelope bytes. Uncertain/failed transmissions consume budget; no implicit retry. These are engineering limits, NOT certified regional regulation or accounting for MeshCore repeater retransmissions: stricter local radio limits may be required.
- Receive: only the selected private channel slot and strict text frame; local receipt and claimed GPS time must each be no more than 90 seconds old or 5 seconds future; firmware timestamp consistency if provided; positive monotonically increasing sequence and claimed GPS timestamp for each claimed session. Duplicate, stale, future, malformed, out-of-order and wrong-channel input is dropped. No cryptographic spoof/replay resistance is claimed.
- Display: at most 20 ephemeral in-memory remote records typed UNVERIFIED CHANNEL POSITION, with transportSourceDeviceId null and sourceAuthentication none-channel-key-only. At 45 seconds label stale, at 90 seconds delete. Render in a separate map overlay, NOT ConvoyMap.authorisedMembers, ConvoyMembershipService, BushMeshConvoyTracker or verified member projection.
- Stop: immediately disables future send attempts, indicator and observers, clears remote coordinates and foreground timers. A firmware command already submitted cannot be retracted. On radio loss, stop is automatic; reconnect does NOT auto-resume. Foreground JS timer is best-effort and offers NO background broadcasting guarantee.

## UI/map worker integration (NOT done on this branch)

1. Use createChannelFieldLocationForUi with a live getter exposing LocationSessionProvider status/providerLabel/latestFix. The existing GPS UI starts Android GPS manually; do not allow simulated route.
2. Show CHANNEL_FIELD_PRIVACY_WARNING prominently and require separate manual consent each session. Show a constant UNVERIFIED CHANNEL POSITION SHARING indicator while active and a large Stop control. Do not default-enable or persist consent.
3. Subscribe to session updates. Use shareLatestFix for one explicit attempt (and the built-in foreground timer as a best-effort periodic trigger); render the result as submitted-to-meshcore, not confirmed by a peer.
4. Render session.snapshot().remoteMarkers in a separate **unverified overlay** with obvious UNVERIFIED caption and age; never convert these into authorized ConvoyMapMember records. They have no authenticated sender device ID or safe vehicle role.
5. Dispose on leaving test mode/profile switch. Confirm normal MeshCore text history still persists and remains available.
6. Independently check that existing legacy location sharing is off before claiming this optional mode is the only source of transmitted positions. This module does not control the legacy GPS/radio owner.

## Two-phone / two-radio real-world test procedure — NOT EXECUTED

Rig: Phone A + actual radio A; Phone B + actual radio B. Note phone models, Android APIs, firmware versions and APK source SHA. Use an approved low-power/private test area. Keep vehicles safely parked while manipulating phones. Same compatible legal radio frequencies, bandwidth/SF/CR and properly provisioned private channel on both. Do not copy PSKs or precise GPS into shared diagnostic logs.

| Test | Real actions | Pass criteria |
|---|---|---|
| F0 | Connect A/B to their independent radios and exchange ordinary private-channel text in both directions | Existing two-way MeshCore messaging confirmed, no new BLE owner |
| F1 | Before explicit consent, inspect map and field-mode status | No verified member, no sharing indicator, no field markers |
| F2 | Start native Android GPS using existing controls on both; reject emulator simulated route | Two genuine recent accurate fixes |
| F3 | Read warning, choose private slot, set unverified label, manually Start on both | Persistent unverified-sharing indicator; verified roster still absent |
| F4 | Trigger A real fix, capture its SEND_CHANNEL_TXT_MSG local PACKET_OK and B inbound 0x08/0x11; repeat B→A | Opposite phone sees actual approximate unverified coordinate, never a delivery ACK or authenticated sender |
| F5 | Observe ≥60 s cadence and rolling 10-min limits; vary real positions only when safe | ≤6 attempts/10 min, bounded airtime estimate, no automatic retries |
| F6 | Make GPS unavailable/stale; check no new position send and wait for expiry | Stale label after 45 s, remote marker gone by 90 s |
| F7 | Press Stop, restart app, force-stop/relaunch | No new sends, OFF on restart, no cached positions |
| F8 | Disconnect radio/BLE mid-session and reconnect | Immediate STOP, no automatic restart; new manual consent required |
| F9 | Controlled fixture injection of duplicate, delayed, bad channel/future/malformed frames (never spoof over public RF) | No false verified membership, invalid packets ignored |
| F10 | Inspect verified ConvoyMap, Secure Convoy directory and Drive | Channel positions NEVER appear among authorized members |
| F11 | Disable cellular/Wi-Fi but keep BLE+LoRa working; repeat both directions | Demonstrates only LoRa channel text carriage, NOT Security v1/v2 verified telemetry |
| F12 | Observe one in-flight command and press Stop | No further commands; acknowledge already-submitted radio command cannot be recalled |

Record for each row PASS/FAIL/NOT RUN, build SHA, device/firmware, timestamp, channel slot (not key), local SEND result versus actual inbound type, marker age and channel claim. No exact coordinates, channel secrets, private keys or personal routes in shared evidence. No real-radio pass is asserted until physically tested.

## Tests / remaining activation requirements

Jest cases: __tests__/wave5ChannelFieldLocation.test.ts (two virtual radios, consent, strict payload, real fix gating, spoofable labels, replay/stale, disconnect/reconnect, stop and expiry); __tests__/wave5VerifiedLocationBoundary.test.ts (protected ingress and verified map gate). Test fakes cannot authenticate any channel sender or stand in for physical radio delivery. CI includes full Jest, TypeScript, lint, Android debug compile. The Wave 4 verified telemetry activation gates remain closed until separately formally approved.
