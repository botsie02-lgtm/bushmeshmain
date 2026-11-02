# BushMesh implementation status

Branch: `feature/bushmesh-lora-protocol`

This checklist distinguishes the **frozen software wire contract** from real MeshCore/Heltec validation. A software contract can now be canonical while carrier behavior remains hardware-pending.

## Protocol v1 freeze milestone

**BushMesh Protocol v1 / Security v1 / radio integration is frozen at the software-contract level.**

Frozen in this branch:

- ordinary BushMesh magic/envelope (`B5 4D`)
- Security-container discriminator (`B5 53`), container version 1 and kind allocation
- deterministic positional binary serialization for protected direct/group traffic and Security v1 `PairingProof`, `SessionOffer`, `SessionResponse`, `WrappedGroupKeyDistribution` and `IdentityRotationProof`
- Security-control object size limits and unknown-field/version rejection
- canonical Security AAD v1, including immutable logical source/destination/group routing selectors
- default-deny emergency authentication policy with explicit unauthenticated fallback opt-in
- carrier `dataType` defined as adapter metadata, not a protocol discriminator
- protect-before-fragment ordering and reassemble-before-Security verification
- fragment ACK vs whole-message delivery ACK semantics
- no network revocation/session-retirement object in v1; Security v1 revocation remains local trust/session state
- golden byte vectors intended for firmware cross-implementation

`Weather 0x04` remains reserved and undefined by design and does not block v1.

Still hardware-pending:

- raw MeshCore/Heltec binary byte preservation
- real carrier MTU
- RF loss/reordering behavior
- multi-radio ACK/congestion behavior
- actual RSSI/SNR/path semantics
- long-running field routing/store-forward behavior

These hardware checks may tune operational policy but must not silently change frozen v1 bytes. A wire-breaking change requires a future protocol/container version.

## Status legend

- **Frozen** — byte/interface behavior is part of BushMesh Protocol v1 and requires a future version for breaking change.
- **Implemented** — core software behavior exists and is covered by tests.
- **Mostly implemented** — primary behavior exists but still needs application lifecycle or persistence wiring.
- **Experimental** — prototype exists and is not required for v1 interoperability.
- **Hardware pending** — software exists, but real Heltec/MeshCore behavior has not been validated.

## Original 28-item roadmap

1. **Persistent store-and-forward — Mostly implemented**
   - delivery queue snapshot/restore
   - generic async key/value storage adapter
   - persistent delivery runtime
   - TTL, attempts, retry timing and exponential backoff
   - automatic flush through a supplied sender when connectivity is available
   - canonical runtime persistence port is transport-neutral

2. **Selective retransmission — Implemented / v1 fragment ACK frozen**
   - fragment ACK bitmaps
   - automatic receiver ACK generation
   - automatic sender ACK application
   - resend only unacknowledged fragments
   - retry/backoff/attempt ceilings
   - fragment ACK confirms fragment receipt only, not authenticated logical delivery

3. **Message IDs and deduplication — Implemented**
   - uint32 message ID generator
   - source/message identity
   - bounded recent-message cache
   - duplicate suppression
   - canonical runtime dedup state restores across restart

4. **Controlled mesh forwarding — Implemented at protocol layer / Hardware pending**
   - TTL decrement
   - forward-once behavior
   - duplicate suppression
   - deterministic rebroadcast jitter
   - destination/local-delivery decisions

5. **Basic routing table — Implemented at protocol layer / Hardware pending**
   - multiple candidates per destination
   - next hop, hop count, score, age and expiry
   - stale-route pruning

6. **Link-quality scoring — Implemented / Hardware pending**
   - RSSI/SNR smoothing
   - hop penalty
   - freshness
   - battery contribution

7. **Compact telemetry — Implemented**
   - battery, voltage, temperature, altitude, speed and heading
   - compact GPS and GPS deltas

8. **Distress packets — Implemented software policy / Hardware pending**
   - emergency category
   - location and battery
   - emergency priority
   - ACK/store-forward semantics
   - Security v1 policy frozen: authentication required by default; unauthenticated fallback only by explicit application opt-in

9. **PING / node discovery — Implemented at protocol layer**
   - node hello
   - PING and explicit PONG
   - nonce tracking, timeout and RTT
   - node ID, role, protocol range and capabilities

10. **Capability negotiation — Implemented**
    - mutual capability intersection
    - text-safe vs experimental binary transport policy
    - fragmentation, selective ACK, store-forward, GPS delta, files and routing gates
    - downgrade detection for lost previously accepted capability/version state

11. **Compression negotiation — Mostly implemented**
    - semantic/dictionary/raw selection driven by peer capabilities
    - dictionary version match required
    - sensor-delta and compressed-binary capability bits

12. **Better dictionary compression — Implemented foundation**
    - stable append-only dictionary IDs
    - common phrases and bush/convoy terminology
    - raw UTF-8 literals
    - dictionary version 1
    - dictionary disabled when peer version differs

13. **Dictionary learning infrastructure — Implemented**
    - local frequency statistics for 1–3 word phrases
    - estimated byte-savings ranking
    - snapshot/restore of statistics
    - does not mutate OTA dictionary dynamically

14. **Semantic messaging expansion — Implemented foundation**
    - expanded convoy/bush intents
    - typed destination/ETA/quantity parameters
    - conservative recognizer with lossless fallback

15. **Semantic voice pipeline interfaces — Implemented interface**
    - transcript -> semantic recognizer
    - semantic/dictionary/raw fallback
    - decoded semantic -> natural text
    - native speech integration remains application/platform behavior, not Protocol v1 wire behavior

16. **Message scheduling — Implemented foundation**
    - emergency
    - direct
    - ACK/retransmission
    - location
    - telemetry
    - file
    - background
    - FIFO behavior inside equivalent priority

17. **Airtime budgeting — Implemented foundation / Hardware pending**
    - LoRa airtime estimator
    - rolling budget
    - emergency airtime reserve
    - scheduler can consult budget
    - field radio parameters/regulatory limits remain configuration

18. **Progressive location — Implemented at protocol layer**
    - adaptive precision
    - explicit location precision request
    - explicit absolute-location request
    - emergency packets can use maximum precision

19. **GPS delta state — Implemented**
    - absolute anchor
    - compact metre deltas
    - periodic re-anchor
    - force absolute on large jump
    - receiver rejects delta without anchor

20. **Sync protocol — Implemented foundation**
    - Bloom summary + contiguous watermark
    - explicit missing-range request
    - generations
    - namespaces for messages, contacts, channels, map markers and configuration

21. **Compact node/inventory summaries — Implemented foundation**
    - generic inventory summaries for messages/contacts/channels/markers/config
    - Bloom filters avoid large ID inventories

22. **File transfer foundation — Implemented / Hardware pending**
    - FILE_START / FILE_CHUNK / FILE_ACK / FILE_END / resume
    - CRC-16 chunks and CRC-32 whole-file validation
    - duplicate/out-of-order handling

23. **Resumable transfers — Mostly implemented**
    - sender ACK state
    - missing-chunk selection
    - resume from next missing chunk
    - durable integration still depends on final application persistence wiring

24. **Small route/contact/config payloads — Implemented**
    - compact contact cards
    - first route point absolute, following points metre-delta encoded
    - compact numeric-key configuration bundles

25. **Fountain/erasure coding — Experimental / not part of required v1 interop**
    - XOR parity prototype recovers one missing chunk per parity group
    - deliberately not enabled in normal file transfer

26. **Protocol fuzz testing — Implemented for current protocol surface**
    - malformed/random input
    - frame limits
    - malformed varints/fragments/tokens and CRC paths
    - Security-container malformed length/version/kind/tamper boundaries
    - decoders fail closed

27. **Protocol versioning — Frozen for v1**
    - ordinary envelope protocol v1
    - Security container v1
    - Security object body schema v1
    - authoritative packet registry
    - unsupported versions and unknown/trailing v1 fields rejected
    - future wire-breaking changes require a future version

28. **Developer/debug tooling — Implemented backend**
    - packet HEX inspector
    - type/version/priority/compression inspection
    - payload size
    - fragment position
    - rendered text when possible
    - typed-packet identification

## Security v1 transport freeze

Frozen Security container kinds:

```text
0x01 Protected Direct
0x02 Protected Group / Convoy
0x10 PairingProof
0x11 SessionOffer
0x12 SessionResponse
0x13 WrappedGroupKeyDistribution
0x14 IdentityRotationProof
0x15 reserved / undefined in v1
```

There is intentionally no network peer-revocation/session-retirement object in v1. Security v1 owns local revocation/session cleanup. A future authority-based propagation protocol needs a new authenticated schema.

Protection occurs **before** fragmentation. Complete protected bytes are reassembled before Security replay/authentication/decryption. Fragment CRC/ACK state is not Security authenticity.

## Canonical integration surfaces

Use:

- `src/bushmesh/index.ts`
- `src/bushmesh/protocol/public.ts`
- `src/bushmesh/runtime/public.ts`
- `src/bushmesh/runtime/BushMeshDatagramRuntime.ts`
- `src/bushmesh/protocol/securityWire.ts`
- `src/bushmesh/protocol/securityBoundary.ts`

Do not create new dependencies on:

- broad `protocol/index.ts` / `runtime/index.ts` compatibility barrels
- current React Native global hubs
- MeshCore-specific bridge types
- radio-core implementation types from inside canonical BushMesh
- Security implementation/private-key provider details

## Hardware gates before release defaults

Real Heltec testing must still verify:

1. text-safe BushMesh messages survive end-to-end
2. raw bytes including `0x00` and `0x80`–`0xFF` survive MeshCore unchanged
3. actual payload ceilings match configured adapter MTUs
4. loss/out-of-order/duplicate fragment tests behave as expected
5. selective ACK causes only missing fragments to be resent
6. store-forward survives real disconnect/reconnect and application restart
7. reported RSSI/SNR values are suitable for routing metrics
8. emergency scheduling wins under congestion
9. long-running multi-node tests do not loop or grow state without bound
10. protected `B5 53` containers survive the final carrier byte-for-byte once raw binary is enabled

## Validation

GitHub Actions uses Node 22.13.0 and runs:

```text
npm ci
npm run lint
npx tsc --noEmit
npm test -- --runInBand
```

The software-level v1 contract should only be declared fully frozen when this exact branch head remains green. Hardware validation is a separate release gate and must not be faked.
