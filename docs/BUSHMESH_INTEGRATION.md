# BushMesh integration boundary

This branch is intended to provide the canonical BushMesh protocol and reusable runtime building blocks. BushMesh owns its wire format, packet schemas, capability/version negotiation, fragmentation/reliability, routing policy, sync, convoy state and airtime policy. MeshCore is a compatibility/hardware adapter and must not define BushMesh protocol semantics.

## Canonical imports

New application code should use:

```ts
import * as BushMesh from '../src/bushmesh';
// or the narrower facades:
import * as BushMeshProtocol from '../src/bushmesh/protocol/public';
import * as BushMeshRuntime from '../src/bushmesh/runtime/public';
```

Do not build new integrations against the broad `protocol/index.ts` or `runtime/index.ts` barrels. Those remain source-compatible migration surfaces for this branch.

## Protocol ownership

`src/bushmesh/protocol/packetTypes.ts` is the authoritative packet allocation registry. Packet codecs and typed dispatch must reference `BushMeshPacketType`; they must not independently allocate numeric packet IDs.

Protocol v1 uses a two-bit envelope version field, so representable versions are 0..3. `versioning.ts` owns compatibility/range negotiation and explicit future migration registration. Discovery advertisements must use the same version range.

ACK packet type `0x0c` has two explicit v1 schemas, distinguished by compression profile:

- `Raw` => selective fragment ACK bitmap.
- `Command` => whole-message delivery ACK.

Packet type `0x04` (Weather) remains reserved until a canonical schema is approved. Packet type `0x05` is canonically Telemetry; the historical `Battery` identifier is only a source-compatible alias.

## Transport ownership

`src/bushmesh/protocol/frameTransport.ts` owns carrier framing, payload-limit fragmentation and peer-policy-aware frame preparation. Hardware adapters provide their payload/MTU limit and translate native frames into `BushMeshInboundTransportFrame`.

The MeshCore bridge may parse/build MeshCore packets and supply MeshCore's payload limit, but it must not own BushMesh fragment sizing, compression selection, capability negotiation or packet definitions.

## Stable runtime surface

`src/bushmesh/runtime/public.ts` intentionally exports transport-neutral state/policy components. Current React Native/global/native/MeshCore orchestration is grouped under `src/bushmesh/runtime/compatibility.ts` and should be treated as transitional application glue.

A future canonical high-level runtime should receive persistence, identity, clock/timer and transport adapters by dependency injection rather than importing React Native/native global stores directly.

## Experimental surface

`src/bushmesh/protocol/experimental.ts` contains helpers that are not part of the stable wire/API contract, including dictionary-learning diagnostics and experimental erasure coding. Consumers must opt in explicitly.

## Integration rules

1. Add new packet IDs to `packetTypes.ts` before writing a codec.
2. Add/extend one typed schema in `typedPackets.ts`; do not introduce parallel packet interpretations in adapters.
3. Capability checks must use `capabilityPolicy.ts` and version negotiation from `versioning.ts`.
4. Link/hardware adapters pass BushMesh payloads to the canonical framing/runtime API; BushMesh code must not parse vendor packet headers.
5. Persisted snapshots require their own explicit storage schema version and must not be treated as wire protocol versions.
6. Future protocol v2/v3 changes require compatibility tests and explicit migration/upgrade policy before release.

## Known integration decisions still open

- Whole-message delivery ACKs are represented canonically, but automatic ACK policy must be destination-aware before enabling it on broadcast media; BushMesh must avoid ACK storms.
- The current application derives node identity from a MeshCore public key. Canonical BushMesh identity needs an injected identity provider so other transports can supply identity independently.
- The current compatibility network runtime still obtains its default persistence from the React Native persistent-store hub. A final reusable orchestrator should receive a `BushMeshKeyValueStore`/checkpoint store explicitly.
- `~BM1:` remains the current text-safe carrier prefix. Before a protocol v2 release, decide whether carrier versioning follows the envelope version or stays a transport-format version.
- Weather (`0x04`) is reserved pending a canonical payload definition.
- Raw binary transport remains hardware-validation dependent; text-safe framing is the compatibility baseline.
