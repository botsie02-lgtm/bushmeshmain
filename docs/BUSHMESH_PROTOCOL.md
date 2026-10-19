# BushMesh LoRa Protocol (experimental v1)

This document describes the experimental BushMesh application-layer wire protocol implemented on `feature/bushmesh-lora-protocol`.

The protocol is designed to sit above MeshCore/LoRa transport. MeshCore remains responsible for the radio/BLE transport; BushMesh adds compact application messages, compression, fragmentation, delivery state, synchronisation, routing hints and file-transfer semantics.

## Status

Protocol version: **1**

The code is experimental until real Heltec-to-Heltec testing confirms that the selected MeshCore transport preserves the expected payload bytes. The text-safe Base64url carrier is the compatibility path. Raw-binary MeshCore channel payloads are implemented but should not become the default until hardware testing verifies arbitrary bytes, including `0x00` and values above `0x7F`, survive unchanged.

## Wire magic and envelope

Every raw BushMesh wire frame starts with:

```text
B5 4D
```

This is followed by the compact BushMesh envelope:

```text
byte 0: [version:2][packet type:6]
byte 1: [priority:3][compression:3][ACK requested:1][store/forward:1]
message ID: unsigned varint
optional TTL: 1 byte (only when store/forward is set)
payload: remaining bytes
```

Message IDs are uint32 values encoded as varints. Signed small values use ZigZag + varint encoding.

## Packet types

Current packet IDs:

| ID | Packet |
| --- | --- |
| `0x01` | Message |
| `0x02` | Location |
| `0x03` | Distress |
| `0x04` | Weather |
| `0x05` | Battery / compact telemetry |
| `0x06` | Device info / node hello |
| `0x07` | Ping |
| `0x08` | Route advertisement |
| `0x09` | File |
| `0x0A` | Command |
| `0x0B` | Fragment |
| `0x0C` | ACK |
| `0x0D` | Sync |

## Priorities

Lower numeric values are scheduled first:

```text
0 Emergency
1 Direct message
2 Location
3 Telemetry
4 Background
```

The delivery queue preserves FIFO order inside one priority.

## Compression profiles

```text
0 RAW
1 TEXT_DICTIONARY
2 SENSOR_DELTA
3 GPS
4 COMMAND
5 CBOR (reserved)
6 COMPRESSED_BINARY
7 SEMANTIC
```

Text messages use the smallest safe representation available:

```text
known unambiguous intent -> semantic codeword (only if smaller)
otherwise -> BushMesh dictionary (only if smaller)
otherwise -> raw UTF-8
```

All dictionary/semantic paths have a lossless raw fallback.

## Text-safe MeshCore carrier

Until binary payload preservation is confirmed on hardware, BushMesh frames can be carried as text:

```text
~BM1:<base64url wire frame>
```

The receiver detects the prefix and reconstructs the binary BushMesh wire frame before decoding it.

## Semantic messages

Initial intent IDs include:

```text
YES
NO
HELP
RETURNING
ARRIVED
NEED_WATER
VEHICLE_PROBLEM
MEDICAL
```

Optional semantic parameters currently include destination, ETA minutes and quantity. Example:

```text
RETURNING + CAMP + ETA 20
```

can reconstruct as:

```text
Returning to camp. ETA approximately 20 minutes.
```

## Location

Absolute location uses 24-bit latitude + 24-bit longitude plus a flag byte, with optional battery percentage. Precision is selectable:

```text
00 ~1 km
01 ~100 m
10 ~10 m
11 ~1 m
```

A location without battery is 7 bytes; with battery it is 8 bytes.

Stateful location updates periodically send an absolute anchor and use signed north/east metre deltas in between. A large jump or configured anchor interval forces another absolute position.

## Distress

Distress payloads have a dedicated category and optional compact GPS/battery. Categories include general, medical, injury, fire, lost, vehicle, need-water and flood.

Typed distress wire frames are automatically:

- emergency priority
- ACK requested
- store-and-forward enabled
- given a larger default hop TTL than background traffic

A distress payload carrying type + ~1 m GPS + battery is approximately 9 bytes before the outer BushMesh envelope.

## Fragmentation and selective ACK

Large BushMesh wire messages can be fragmented. Each fragment carries:

```text
message ID (varint)
fragment index (varint)
fragment count (varint)
CRC-16
fragment data
```

Reassembly accepts out-of-order fragments and ignores duplicates. ACKs use bitmaps so the sender retries only missing fragments.

The retransmission engine tracks attempts per fragment and applies exponential backoff with an attempt ceiling.

## Deduplication and controlled forwarding

Messages are identified by:

```text
(source node ID, message ID)
```

A bounded TTL cache prevents repeated delivery/rebroadcast of the same identity.

Controlled flooding behavior:

- locally originated messages are not reflected back
- duplicate messages are dropped
- destination messages are delivered and not forwarded further
- broadcast messages may be delivered locally and forwarded once
- TTL is decremented at each forwarding decision
- deterministic jitter reduces simultaneous rebroadcast collisions

## Node discovery and capabilities

Node hello frames advertise:

- node ID
- protocol min/max version
- role (handheld/router/vehicle/base/sensor)
- optional battery
- capability bitmask

Capabilities currently include dictionary text, semantic messages, fragmentation, selective ACK, store-and-forward, Bloom sync, GPS delta, raw-binary transport, file transfer, link routing and voice-text pipeline support.

Two nodes use the intersection of their capability masks. This provides a clean fallback path for older/less-capable peers.

## Neighbor/link metrics

The neighbor table tracks and smooths:

- RSSI
- SNR
- hop count
- last seen time
- battery when known

Neighbor scoring uses link quality, hop cost, freshness and battery as inputs. The weights are intentionally software-configurable and are not claimed to be optimal until real field data is collected.

## Routing

The routing table can retain multiple candidates per destination. Route selection accounts for:

- link score
- hop count
- route age
- expiry
- excluded/failed next hops

Compact route advertisements carry destination, uint32 sequence, hop count and path quality. A wrap-aware route-sequence tracker suppresses stale/replayed advertisements.

This is routing infrastructure, not yet a claim that BushMesh has a field-proven routing protocol. Real radio measurements should determine final route metrics and advertisement cadence.

## Store and forward

The priority queue supports:

- message deduplication
- expiry
- next-attempt time
- retry limits
- acknowledgements
- snapshots

A generic async key/value adapter can save/restore snapshots. The adapter is intentionally not tied to a particular React Native storage package yet.

## Opportunistic sync

Sync summaries combine:

- a contiguous message watermark
- a compact Bloom filter of known message IDs

Bloom filters may have false positives by design; they must never be treated as an authoritative proof that a remote peer has every item. The protocol uses them as an airtime-saving summary.

## File transfer

File primitives currently include:

```text
FILE_START
FILE_CHUNK
FILE_ACK
FILE_END
FILE_RESUME_REQUEST
```

Features:

- configurable chunk size
- content-type ID
- optional UTF-8 file name
- CRC-16 per chunk
- CRC-32 whole-file verification
- out-of-order chunk acceptance
- duplicate suppression
- selective ACK windows up to 64 chunks
- resume from first missing chunk
- sender-side ACK state to avoid retransmitting chunks already confirmed

The current implementation is suitable for small text/config/routes/contact cards and other modest data. File-size/airtime policy should be enforced by the application before large transfers are enabled over LoRa.

## Airtime budgeting

The protocol includes a configurable LoRa time-on-air estimator using spreading factor, bandwidth, coding rate, preamble/header/CRC and low-data-rate optimisation parameters.

A rolling airtime budget can reserve capacity for emergency traffic. It deliberately contains no hard-coded legal duty-cycle assumption; regional regulations and actual radio configuration must be supplied by the application/device configuration.

## Defensive decoding

The frame inspector has configurable limits for:

- maximum wire-frame bytes
- maximum payload bytes
- maximum TTL
- accepted protocol versions

Malformed/random radio input should fail closed without escaping decoder exceptions. Deterministic fuzz tests exercise this boundary.

## Voice pipeline

The protocol supports the intended voice architecture without transmitting audio:

```text
speech
 -> local STT
 -> semantic detection / dictionary / UTF-8 fallback
 -> LoRa text/binary packet
 -> decode
 -> local TTS
```

STT/TTS engines are not yet integrated. That work belongs above the wire protocol and should remain optional/offline-capable.

## Hardware validation checklist

Before enabling raw BushMesh transport by default, test at least two real devices and verify:

1. Text-safe `~BM1:` messages survive end-to-end.
2. Raw binary channel payloads preserve `0x00`, `0x80-0xFF` and non-UTF-8 sequences.
3. The real MeshCore payload ceiling matches the application's assumed limit.
4. Multi-fragment messages survive loss, duplication and out-of-order delivery.
5. Selective ACKs cause only missing fragments to be resent.
6. GPS deltas recover after periodic absolute anchors.
7. Store-and-forward survives disconnect/reconnect and app restart.
8. RSSI/SNR values exposed by firmware correspond to the metrics used by routing.
9. Distress traffic wins scheduler/airtime priority under congestion.
10. Long-running tests do not create forwarding loops or unbounded state.

Until those checks pass, binary transport, automatic routing and file transfer should be considered experimental features rather than release defaults.
