# BushMesh implementation status

Branch: `feature/bushmesh-lora-protocol`

This checklist distinguishes protocol/software implementation from live MeshCore/Heltec validation. A feature can be implemented and unit-tested here while still being considered experimental until it is exercised over real radios.

## Status legend

- **Implemented** — core software behavior exists and is covered by tests.
- **Mostly implemented** — primary behavior exists but still needs application lifecycle or persistence wiring.
- **Experimental** — prototype exists and is disabled from normal behavior.
- **Hardware pending** — software exists, but real Heltec/MeshCore behavior has not been validated.

## Original 28-item roadmap

1. **Persistent store-and-forward — Mostly implemented**
   - delivery queue snapshot/restore
   - generic async key/value storage adapter
   - persistent delivery runtime
   - TTL, attempts, retry timing and exponential backoff
   - automatic flush through a supplied sender when connectivity is available
   - remaining: bind the adapter to a concrete React Native persistent store

2. **Selective retransmission — Implemented**
   - fragment ACK bitmaps
   - automatic receiver ACK generation
   - automatic sender ACK application
   - resend only unacknowledged fragments
   - retry/backoff/attempt ceilings

3. **Message IDs and deduplication — Implemented**
   - uint32 message ID generator
   - source/message identity
   - bounded recent-message cache
   - duplicate suppression

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

8. **Distress packets — Mostly implemented / Hardware pending**
   - emergency category
   - location and battery
   - emergency priority
   - ACK requested
   - store-and-forward and larger TTL
   - remaining: field-tune repeated emergency transmission policy

9. **PING / node discovery — Implemented at protocol layer**
   - node hello
   - PING and explicit PONG
   - nonce tracking, timeout and RTT
   - node ID, role, protocol range and capabilities

10. **Capability negotiation — Implemented**
    - mutual capability intersection
    - text-safe vs experimental binary transport policy
    - fragmentation, selective ACK, store-forward, GPS delta, files and routing gates

11. **Compression negotiation — Mostly implemented**
    - semantic/dictionary/raw selection driven by peer capabilities
    - dictionary version match required
    - sensor-delta and compressed-binary capability bits
    - remaining: central selection policy for every telemetry/file data type

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
    - original intents plus wait, stop, continue, lost, safe, fire, flood, injury, low battery, fuel, recovery, blocked route, turn-around, food, tools, check-in, hold, meet, depart, delay and movement
    - typed destination/ETA/quantity parameters
    - intentionally conservative recognizer with lossless fallback

15. **Semantic voice pipeline interfaces — Implemented interface / STT-TTS pending**
    - transcript -> semantic recognizer
    - semantic/dictionary/raw fallback
    - decoded semantic -> natural text
    - actual microphone STT and speaker TTS remain application-layer work

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
    - field radio parameters/regulatory limits must be supplied by configuration

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
    - remaining: persist active transfer progress across application restart

24. **Small route/contact/config payloads — Implemented**
    - compact contact cards
    - first route point absolute, following points metre-delta encoded
    - compact numeric-key configuration bundles

25. **Fountain/erasure coding — Experimental**
    - XOR parity prototype recovers one missing chunk per parity group
    - deliberately not enabled in normal file transfer
    - fountain/Reed-Solomon coding remains future research

26. **Protocol fuzz testing — Implemented for current protocol surface**
    - malformed/random input
    - frame limits
    - malformed varints/fragments/tokens and CRC paths
    - decoders fail closed

27. **Protocol versioning — Mostly implemented**
    - protocol v1 wire bits
    - min/max version advertisement
    - capability negotiation
    - dictionary version negotiation
    - remaining: formal migration rules once a v2 format actually exists

28. **Developer/debug tooling — Implemented backend / UI pending**
    - packet HEX inspector
    - type/version/priority/compression inspection
    - payload size
    - fragment position
    - rendered text when possible
    - typed-packet identification
    - remaining: optional in-app developer/debug screen

## MeshCore integration status

The MeshCore bridge can now prepare frames according to a negotiated peer policy:

- text-safe `~BM1:` remains the default compatibility carrier
- raw binary requires mutual `BinaryTransport` support and an explicit experimental opt-in
- peer dictionary versions must match before dictionary compression is used
- oversized packets are fragmented only when the peer advertises fragmentation support
- otherwise the send preparation fails explicitly rather than silently sending an incompatible packet

## Hardware gates before release defaults

Do not treat raw binary, automatic routing, file transfer or erasure coding as release-ready until real Heltec testing verifies:

1. text-safe BushMesh messages survive end-to-end
2. raw bytes including `0x00` and `0x80`–`0xFF` survive MeshCore unchanged
3. actual payload ceilings match assumptions
4. loss/out-of-order/duplicate fragment tests behave as expected
5. selective ACK causes only missing fragments to be resent
6. store-forward survives real disconnect/reconnect and application restart
7. reported RSSI/SNR values are suitable for routing metrics
8. emergency scheduling wins under congestion
9. long-running multi-node tests do not loop or grow state without bound

## Current validation

GitHub Actions runs Node 22.13, `npm ci`, `npx tsc --noEmit`, and the complete Jest suite on the feature branch. The current protocol work should only be promoted toward `main` after these checks remain green and hardware validation has been completed.
