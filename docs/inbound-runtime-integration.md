# BushMesh inbound runtime integration seam

## Neutral radio-core contract

Radio-core now hands inbound application data upward as `ReceivedDatagram` from `src/radio/ReceivedDatagram.ts`.

A datagram contains only transport-owned facts: channel index, data type, payload bytes, receive timestamp, transport kind, live/background-replay source, optional RSSI/SNR/path metadata, the active local radio identity association when known, an optional transport device id, and a diagnostic label.

Protocol/runtime code must consume this contract through `subscribeReceivedDatagrams(...)` (or a `RadioAdapter.subscribeReceivedDatagrams` implementation when the adapter migration is complete). Radio-core must not inspect BushMesh packet headers or message types before this handoff.

MeshCore channel data is converted by `src/meshcore/MeshCoreReceivedDatagramAdapter.ts`. `NativeMeshCoreSession` publishes live neutral datagrams. `RadioSessionContext` republishes Android background-inbox frames through the same seam while preserving their original receive timestamps.

## Legacy compatibility path

Current application behaviour is preserved by `src/radio/LegacyBushMeshInboundAdapter.ts` and `src/components/LegacyBushMeshInboundBridge.tsx`.

The compatibility adapter is the intentional quarantine for the branch's old inbound packet knowledge. It recognizes the legacy MeshCore development data type, inspects the legacy message type byte, invokes the old position/quick-action/formation/position-request decoders, and then publishes the existing application-domain event through `src/bushmesh/inboundBus.ts`.

`src/bushmesh/meshcoreBridge.ts` remains only as a compatibility facade for older callers/tests that still supply a `MeshCoreChannelDataFrame` directly. New lifecycle code must not depend on it.

## Canonical runtime integration point

When `feature/bushmesh-lora-protocol` is integrated, its runtime should subscribe to `ReceivedDatagram` and become the owner of BushMesh packet recognition, parsing, replay/dedupe policy, routing semantics and protocol-version handling. Its outbound output should continue to use the existing neutral outbound datagram/envelope seam.

The migration sequence is:

1. Radio/BLE/MeshCore produces `ReceivedDatagram`.
2. Canonical BushMesh runtime consumes the datagram and determines whether/how it belongs to BushMesh.
3. Security v1 is invoked by the canonical runtime at the points required for identity validation, authenticated metadata verification, decryption and trust/revocation checks.
4. Only validated/decrypted canonical application events are delivered to convoy, location, Drive, speech, diagnostics and other application services.
5. Legacy compatibility subscription is removed after equivalent canonical application events are wired.

Security v1 does not belong in `RadioAdapter`, `NativeMeshCoreSession`, `ReceivedDatagram`, or the generic radio lifecycle. Radio-core transports opaque bytes and link metadata only.

## Legacy inbound files that become removable

After canonical runtime integration and application-event migration, the following compatibility surfaces can be removed or substantially reduced:

- `src/radio/LegacyBushMeshInboundAdapter.ts`
- `src/components/LegacyBushMeshInboundBridge.tsx`
- `src/bushmesh/meshcoreBridge.ts`
- `src/bushmesh/inboundBus.ts` once application services consume canonical runtime events
- inbound decode responsibilities in `src/bushmesh/protocol.ts`
- inbound decode responsibilities in `src/bushmesh/formationProtocol.ts`
- inbound decode responsibilities in `src/bushmesh/positionRequestProtocol.ts`

Those protocol files may still have temporary outbound compatibility callers until the outbound legacy adapter is retired, so they should not be deleted merely because inbound integration lands.

## Android background capture

`BushMeshNativeInboxCapture.kt` retains its historical class name for compatibility, but it no longer filters the BushMesh development data type. It validates only the MeshCore channel-data envelope and stores complete frames. This is intentional: Android background radio ownership must not decide which application protocol owns payload bytes.

## Application lifecycle readiness

Long-lived providers and runtime bridges now live in `src/app/AppProviders.tsx` rather than accumulating in root `App.tsx`.

The old tab shell kept every screen mounted and hid inactive screens with `display: none`. React effects remain active when a view is merely hidden, which can leave screen-owned BLE subscriptions, GPS watches, speech listeners, timers, radio subscriptions or map listeners alive. The shell now uses `ScreenMountGate` so only the active tab screen is mounted. Global services that genuinely need to survive tab changes remain in providers above the screen gate.

This deliberately separates two lifetimes:

- **application lifetime:** radio session, location session, speech provider, convoy state, persistence, runtime bridges;
- **screen lifetime:** UI-local subscriptions/effects that should exist only while that screen is active.
