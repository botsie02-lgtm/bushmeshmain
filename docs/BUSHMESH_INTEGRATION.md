# BushMesh canonical integration boundary

This branch owns the canonical BushMesh protocol and runtime seam. Radio-core owns hardware/radio lifecycle and accepts opaque encoded datagrams. Security v1 owns identities, trust, sessions, group keys, nonces/replay and cryptography. MeshCore is only a compatibility carrier.

## Canonical imports

Normal application integration should import from:

```ts
import {
  BushMeshDatagramRuntime,
  BushMeshPacketType,
  BushMeshPriority,
} from '../src/bushmesh';
```

Advanced protocol/firmware code may use `src/bushmesh/protocol/public.ts`. Transport/runtime integrators may use `src/bushmesh/runtime/public.ts`. Do not build new code against the broad `protocol/index.ts` or `runtime/index.ts` barrels; those are compatibility surfaces for the existing branch.

## Canonical app-facing runtime

`BushMeshDatagramRuntime` is the stable seam. It deliberately has no radio `send()` method and imports neither radio-core nor MeshCore.

It accepts injected abstractions for:

- runtime clock/timers (`BushMeshRuntimeClock`)
- key/value persistence (`BushMeshRuntimePersistence`)
- transport availability (`BushMeshTransportAvailabilityPort`)
- Security v1 adaptation (`BushMeshSecurityAdapter`)

It produces `BushMeshOutboundDatagram` and consumes `BushMeshInboundDatagram`. BushMesh owns packet decoding, version checks, typed dispatch and duplicate suppression. The radio layer treats `payload` as opaque bytes.

## Outbound radio mapping contract

`BushMeshOutboundDatagram` maps directly to radio-core's neutral `OutboundDatagramEnvelope` without importing it:

| BushMesh | radio-core mapping |
| --- | --- |
| `channelIndex` | `channelIndex` |
| `dataType` | `dataType` |
| `payload` | `payload` (already encoded; never reinterpret) |
| `priority` | `priority` (`safety`, `control`, `message`, `position`, `bulk`) |
| `expiresAtMs` | `expiresAtMs` |
| `retryIntent.maxTransportAttempts` | `retryPolicy.maxAttempts` |
| direct `sessionId`, group `groupId`, or identity association | `identityRef` chosen by the integration layer |
| `diagnostics.label` | `description` |
| `createdAtMs` | `createdAtMs` |

For `retryIntent.mode === 'protocol-managed'`, radio-core should normally use one transport attempt. BushMesh ACK/retransmission logic owns protocol reliability; radio-core must not create a second independent protocol retry loop.

The final integration chooses the numeric `dataType` discriminator and channel mapping. Those values are carrier/integration metadata, not BushMesh wire packet IDs.

## Inbound radio mapping contract

Radio-core `ReceivedDatagram` fields map to `BushMeshInboundDatagram` as follows:

- `channelIndex`, `dataType`, `payload`, `receivedAtMs`, `transport`, `source` map directly.
- `link.rssiDbm`, `link.snrDb`, and `link.pathLength` map directly when available.
- `radioIdentityRef`, `transportDeviceId`, and diagnostic labels may pass through unchanged.
- an integration may additionally provide `sourceNodeId` when it has a canonical BushMesh node identity; this enables `(sourceNodeId, messageId)` duplicate suppression.
- `securityProtected` is supplied by the final security/carrier integration once the protected-wire discriminator is frozen.

Radio-core must not parse BushMesh magic, envelope fields, packet types, fragments, ACKs or typed payloads.

## Security v1 boundary

`src/bushmesh/protocol/securityBoundary.ts` owns the canonical immutable authenticated-header bytes supplied to Security v1 as `SecurityProtocolContext.authenticatedHeader`.

AAD schema v1 is:

1. domain/schema prefix `42 4D 41 01` (`BMA`, version 1),
2. the protocol envelope's version + packet type byte,
3. priority + compression + ACK/store-forward flags byte,
4. canonical VarUint message ID.

Mutable hop TTL/path counters are **not** included. Routers may decrement them without invalidating end-to-end security.

`BushMeshSecurityAdapter` is implemented by the final application integration. BushMesh passes plaintext wire bytes, the canonical protocol context, a traffic class and an association (`direct-session`, `group`, or identity). The adapter calls Security v1 and returns final protected datagram bytes plus the opaque Security protected object. On inbound protected traffic the adapter returns plaintext BushMesh wire bytes and the exact authenticated header used; BushMesh recomputes and compares the canonical header before dispatch.

BushMesh never receives private keys and does not implement encryption, key derivation, nonce management, replay protection, trust, rotation or revocation.

### Security treatment audit

- direct `Message` traffic: direct-session protection required.
- private group `Message` traffic: group protection required.
- `Convoy` group traffic: group protection required.
- `Distress`: security is policy-dependent; authenticated emergency traffic is preferred when context exists, but unauthenticated fallback behavior remains a safety/product decision.
- pairing/session establishment: Security v1 object exists; BushMesh transport schema is not yet assigned/frozen.
- wrapped group-key distribution: Security v1 object exists; BushMesh transport schema is not yet assigned/frozen.
- identity rotation and peer revocation/session retirement: Security v1 objects/actions exist; BushMesh transport schemas are not yet assigned/frozen.

These security-control objects must not be hidden inside unrelated `Command` or `DeviceInfo` payloads merely to avoid defining their final transport schema.

## Protocol-v1 authority

`src/bushmesh/protocol/packetTypes.ts` remains the authoritative packet allocation table. `versioning.ts` owns the two-bit envelope version range and compatibility. `capabilityPolicy.ts` owns negotiated feature policy and now detects loss of previously accepted capabilities/version as a downgrade signal; the trust/security layer decides whether such a downgrade is legitimate after an explicit re-pair/reconfiguration.

ACK `0x0C` retains two schemas distinguished by compression: `Raw` is selective fragment ACK; `Command` is delivery ACK. Weather `0x04` remains reserved. Telemetry `0x05` is canonical; `Battery` is only a source alias.

Golden byte vectors are in `__tests__/bushmeshGoldenVectors.test.ts` and are intended for firmware cross-implementation tests.

## Decisions still not frozen

The following must be resolved before declaring the complete app + firmware protocol/security vectors final:

- the on-wire protected-payload container/discriminator that carries Security v1 `EncryptedDirectMessage` and `EncryptedGroupMessage` objects while leaving enough immutable header information available for AAD before decrypt;
- dedicated transport schemas/packet allocation for pairing/session establishment, group-key distribution, identity rotation and revocation/session retirement;
- emergency unauthenticated/authenticated fallback policy and whether any emergency mode requires signatures without confidentiality;
- the integration-level numeric `dataType` used by radio-core/carriers for BushMesh and for protected-vs-plain traffic;
- whether source/destination routing identities become part of a future immutable authenticated routing header;
- Weather (`0x04`) payload schema;
- hardware confirmation of raw binary payload preservation through MeshCore/Heltec firmware (text-safe compatibility remains adapter-only fallback).

## Integration rules

1. Do not import radio-core or Security branch implementations into canonical BushMesh modules.
2. Do not let radio-core interpret BushMesh packet layouts.
3. Do not let MeshCore define BushMesh MTU/fragment/compression/version/security semantics.
4. Add standardized packet IDs only through `packetTypes.ts` and add deterministic vectors for frozen schemas.
5. Use the canonical AAD builder for every Security v1 protected exchange; never construct ad-hoc AAD in adapters.
6. Treat capability loss as a downgrade signal until the trust/security layer explicitly accepts the new peer state.
