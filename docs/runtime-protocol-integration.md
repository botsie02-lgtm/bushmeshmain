# BushMesh Runtime / Radio-Core Integration Seam

This branch intentionally does not contain the future canonical BushMesh protocol/runtime. It only defines the outbound seam that runtime will use when it is integrated.

## Canonical runtime contract

The canonical runtime should produce an already-encoded `OutboundDatagramEnvelope` from `src/radio/OutboundDatagram.ts` and hand it to `BushMeshRadioSession.queueOutboundDatagram(...)` (or directly to `BushMeshTransmissionController.enqueueOutbound(...)` in non-UI/runtime wiring).

The envelope contains only delivery information radio-core needs: channel index, transport data type, encoded payload bytes, queue priority, expiry, retry policy, identity association and a diagnostic description. `BushMeshTransmissionController` must not know packet layouts or perform protocol encoding.

`RadioAdapter` remains the hardware abstraction. It sends datagrams accepted by radio-core; it is not a BushMesh protocol runtime.

## Legacy compatibility adapter

The current branch still needs its existing packet formats while the application is running against the legacy implementation. Those encoders and their packet-specific queue rules are isolated in:

`src/radio/LegacyBushMeshOutboundAdapter.ts`

`BushMeshRadioSession` keeps `queueQuickAction`, `queuePosition`, `queueFormationShare` and `queuePositionRequest` as deprecated compatibility helpers. They delegate to the legacy adapter and can be removed later without changing the neutral transmission controller/outbox path.

## Legacy files that can eventually be removed

After the canonical runtime supplies all equivalent outbound and inbound behavior, the legacy protocol implementation can be retired in a separate integration change. Candidates include:

- `src/bushmesh/protocol.ts`
- `src/bushmesh/formationProtocol.ts`
- `src/bushmesh/positionRequestProtocol.ts`
- legacy-only portions of `src/bushmesh/wireProtocol.ts`
- the temporary `src/radio/LegacyBushMeshOutboundAdapter.ts`

Removal must wait until all current application callers and inbound decoding paths have migrated. This seam does not copy or pre-implement the canonical protocol branch.

## Future Security v1 position

`foundation/security-identity-v1` owns identity, trust, encryption and key management. Radio-core does not implement those concerns.

The intended future outbound flow is:

application feature -> canonical BushMesh runtime -> Security v1 protection/authentication where required -> encoded `OutboundDatagramEnvelope` -> radio-core queue/retry/outbox -> `RadioAdapter` -> hardware transport

The intended inbound flow is the reverse boundary:

hardware transport -> `RadioAdapter`/radio lifecycle -> canonical runtime framing/dispatch -> Security v1 verification/decryption where required -> application feature

The `identityRef` field on the outbound envelope is only an association used by radio-core to prevent queued work from being transmitted under the wrong active radio identity. It is not a cryptographic identity, trust decision or key handle.
