# Application-lifetime radio connection ownership

## Ownership model

`src/radio/AppRadioConnectionService.ts` owns the physical companion-radio connection for the React Native application lifetime.

It owns:

- the single BLE-PLX `BleManager` instance;
- the active BLE-PLX `MeshCoreClient` compatibility session;
- the active Android-native `NativeMeshCoreSession` reference;
- BLE scanning and its timeout;
- connection/reconnect status surfaced by `MeshCoreClient`;
- connection owner, device address/label and MeshCore discovery state;
- device diagnostics logs that must survive Device-screen navigation;
- radio startup/channel/contact/battery command state.

`src/state/RadioConnectionContext.tsx` is the application-lifetime React bridge. It initializes and disposes the service with `AppProviders`, mirrors stable radio application state into `BushMeshContext`, and installs the shared channel-message/contact command handlers.

`DeviceScreen` no longer constructs a `BleManager`, `MeshCoreClient`, native session, reconnect timer or scan timer. It observes `RadioConnectionContext` and invokes its commands.

## Screen lifecycle

Because connection lifetime no longer belongs to `DeviceScreen`, `DeviceHubScreen` now uses the same `ScreenMountGate` lifecycle as the other tabs. Navigating away destroys only Device UI state. It does not stop the BLE client, native session or radio reconnect behavior.

Remounting the Device tab reads the current service snapshot, so the active device, owner, scan/connection state, loaded channels and diagnostics remain visible without creating another BLE manager or radio session.

## Explicit disconnect and teardown

Explicit user disconnect remains authoritative. It stops whichever owner is active and clears the application-visible connection state.

Provider teardown calls `AppRadioConnectionService.dispose()` once. Disposal cancels scan resources, stops a BLE-PLX client, stops an active JS-owned native session/coordinator, destroys the BLE manager and clears service listeners. The operation is idempotent so React teardown cannot double-dispose the transport.

Android process-death recovery remains separate: when the JS process is not alive there is no provider teardown callback to run, and the existing Android foreground/native radio recovery path remains responsible for persisted/native ownership.

## Protocol/runtime boundaries

This change does not alter either canonical integration seam:

- inbound remains `ReceivedDatagram`;
- outbound remains `OutboundDatagramEnvelope`.

`MeshCoreClient` and `NativeMeshCoreSession` continue to publish neutral inbound datagrams and continue to claim/release `BushMeshRadioSession` transport ownership. `AppRadioConnectionService` coordinates their application lifetime but does not parse BushMesh packet formats, route protocol messages or perform Security v1 work.

## Remaining application-level work

The radio connection lifetime blocker that required DeviceHub to stay mounted is removed.

The legacy BLE-PLX path remains a compatibility hardware/session implementation. Its protocol-neutral transport/lifecycle responsibilities can eventually be folded behind a fuller `RadioAdapter` implementation, but that migration is not required for Device-screen lifecycle safety and must not create a competing BushMesh protocol/runtime.
