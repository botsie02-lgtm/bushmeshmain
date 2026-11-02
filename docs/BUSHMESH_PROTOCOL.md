# BushMesh Protocol v1 — Frozen Software Wire Contract

Branch: `feature/bushmesh-lora-protocol`

Status: **BushMesh Protocol v1 software wire contract frozen.** The byte encodings in this document are the contract for the application runtime, Security v1 integration and future firmware. Real Heltec/MeshCore raw-binary behavior is still hardware-pending and is not inferred from software tests.

BushMesh owns packet formats, fragmentation, protocol reliability, routing semantics, Security-container framing and typed dispatch. Radio-core owns hardware/radio lifecycle and transports opaque datagrams. Security v1 owns identity, trust, cryptography, sessions, group keys, nonce/replay state, rotation validation and local revocation state. MeshCore is a compatibility carrier only.

## 1. Datagram discriminators

A receiver identifies BushMesh from the payload bytes, not from a carrier-specific `dataType`.

### Ordinary BushMesh

```text
B5 4D
```

followed by the v1 compact envelope.

### BushMesh Security container

```text
B5 53 01 <kind>
```

where `01` is the Security-container schema version.

This makes these cases unambiguous without asking radio-core or MeshCore to parse BushMesh:

- `B5 4D` — ordinary BushMesh packet or Fragment wrapper.
- `B5 53 01 01` — protected direct traffic.
- `B5 53 01 02` — protected group/convoy traffic.
- `B5 53 01 10..14` — Security v1 control objects.
- any other prefix — not a canonical BushMesh v1 datagram.

`dataType` is **carrier/integration metadata**, not a BushMesh packet ID and not a protected/plain discriminator. Each carrier adapter may map a suitable numeric value, but the mapping must not alter these payload bytes.

## 2. Ordinary BushMesh envelope

After `B5 4D`:

```text
byte 0: [version:2][packet type:6]
byte 1: [priority:3][compression:3][ACK requested:1][store/forward:1]
message ID: unsigned VarUint, uint32 range
optional TTL: 1 byte when store/forward is set
payload: remaining bytes
```

Protocol version is **1**. The two-bit envelope can represent versions 0..3; v1 implementations accept only versions explicitly supported by their version policy.

Unsigned VarUint is base-128 little-endian continuation encoding and is limited to five bytes / uint32. Signed compact integers use ZigZag then VarUint.

### Packet allocation

`src/bushmesh/protocol/packetTypes.ts` is authoritative.

| ID | v1 meaning |
| --- | --- |
| `0x01` | Message |
| `0x02` | Location |
| `0x03` | Distress |
| `0x04` | Weather — reserved, schema undefined |
| `0x05` | Telemetry (`Battery` is source-only legacy alias) |
| `0x06` | DeviceInfo / discovery hello |
| `0x07` | Ping/Pong |
| `0x08` | Route advertisement |
| `0x09` | File transfer |
| `0x0A` | Command |
| `0x0B` | Fragment |
| `0x0C` | ACK |
| `0x0D` | Sync |
| `0x0E` | Routed payload |
| `0x0F` | Convoy |

Weather remaining reserved does not block Protocol v1 freeze.

### ACK multiplexing

Packet `0x0C` has exactly two v1 schemas:

- compression `Raw (0)` — selective fragment ACK bitmap;
- compression `Command (4)` — whole-message delivery ACK.

Fragment ACK means fragment bytes were received. Whole-message delivery ACK must only be emitted after the complete logical datagram has passed reassembly, Security verification where required, decoding and delivery policy.

## 3. Security-container v1

Maximum encoded container size: **4096 bytes**.

Top-level layout is fixed positional binary:

```text
B5 53
containerVersion: u8 = 1
kind: u8
routingFlags: u8
[sourceNodeId: VarUint]       if flags bit 0
[destinationNodeId: VarUint]  if flags bit 1
[groupId: VarUint length + UTF-8] if flags bit 2
authenticatedHeaderLength: VarUint
authenticatedHeader bytes
bodyLength: VarUint
body bytes
```

Routing flag bits 3..7 are invalid in v1. Unknown kinds, unsupported container versions, malformed lengths or trailing bytes are rejected. V1 is positional and does **not** skip unknown fields. Any compatible extension requiring extra fields uses a new object/container schema version.

### Kind IDs

| Kind | Meaning |
| --- | --- |
| `0x01` | `EncryptedDirectMessage` container |
| `0x02` | `EncryptedGroupMessage` container |
| `0x10` | `PairingProof` |
| `0x11` | `SessionOffer` |
| `0x12` | `SessionResponse` |
| `0x13` | `WrappedGroupKeyDistribution` |
| `0x14` | `IdentityRotationProof` |
| `0x15` | reserved for a future authority-defined revocation/retirement protocol; **undefined/rejected in v1** |

Security control objects (`0x10..0x14`) use `routingFlags = 0` and authenticated-header length `0`. Their signatures/encrypted contents already bind the Security-owned fields. They are never hidden inside ordinary `Command` or `DeviceInfo` packets.

## 4. Canonical primitive serialization for Security objects

All multi-byte fixed integers are **big-endian**.

- schema/version selector: `u8`
- Security version: `u8`, range `1..255`
- protocol version: `u8`, range `1..3`
- epochs: `u32 BE`
- timestamps: `u64 BE`, non-negative integer milliseconds supplied by Security v1
- Security replay counters: `u64 BE`; Security's decimal counter string is converted exactly to this integer
- identifiers/text: canonical UTF-8 prefixed with VarUint byte length
- generic byte strings: VarUint byte length followed by exact bytes
- Ed25519/X25519 public keys: raw fixed 32 bytes
- SHA-256 identity fingerprints: raw fixed 32 bytes
- Ed25519 signatures: raw fixed 64 bytes
- handshake nonces: raw fixed 32 bytes
- sender nonce prefixes: raw fixed 4 bytes
- ciphertext: raw bytes decoded from canonical unpadded base64url, length-prefixed
- optional timestamp (`rotatedAt`) in `DeviceIdentity`: one presence byte `0`/`1`, then `u64 BE` only when present
- version lists: `count u8` followed by `count` one-byte versions; count `1..8`, duplicates rejected

Maximums:

- container: 4096 bytes
- authenticated protocol header: 256 bytes
- protected ciphertext: 3072 bytes
- identifier/string: 160 UTF-8 bytes unless a stricter field limit applies
- device/session/handshake IDs in the v1 codecs: 64 UTF-8 bytes
- pairing challenge: 16..64 bytes
- supported version list: 1..8 entries

Base64url values supplied by Security objects must be canonical, unpadded `[A-Za-z0-9_-]*`. The protocol serializes them as raw bytes and reconstructs canonical base64url on decode.

## 5. Security control object schemas

Every body begins with body schema version `01`.

### DeviceIdentity

```text
identityVersion u8 = 1
deviceId string
signingPublicKey raw32
agreementPublicKey raw32
fingerprint raw32
keyEpoch u32 BE
createdAt u64 BE
rotatedAtPresent u8 (0/1)
[rotatedAt u64 BE]
```

Private keys/handles are never protocol objects.

### PairingProof (`kind 0x10`)

```text
schema 01
DeviceIdentity
challenge byte-string (16..64)
supportedSecurityVersions
supportedProtocolVersions
issuedAt u64 BE
signature raw64
```

### SessionOffer (`kind 0x11`)

```text
schema 01
handshakeId string
initiator DeviceIdentity
responderDeviceId string
ephemeralAgreementPublicKey raw32
nonce raw32
sendNoncePrefix raw4
supportedSecurityVersions
supportedProtocolVersions
issuedAt u64 BE
signature raw64
```

### SessionResponse (`kind 0x12`)

```text
schema 01
handshakeId string
responder DeviceIdentity
initiatorDeviceId string
ephemeralAgreementPublicKey raw32
nonce raw32
sendNoncePrefix raw4
selectedSecurityVersion u8
selectedProtocolVersion u8
issuedAt u64 BE
signature raw64
```

Security v1 remains responsible for verifying that the selected versions are the highest permitted mutually supported versions and for rejecting downgrade attempts.

### WrappedGroupKeyDistribution (`kind 0x13`)

```text
schema/distributionVersion 01
groupId string
epoch u32 BE
senderDeviceId string
senderFingerprint raw32
recipientDeviceId string
recipientFingerprint raw32
securityVersion u8
protocolVersion u8
sessionId string
encryptedPayloadLength VarUint
nested EncryptedDirectMessage body
```

The outer `sessionId` must exactly match the nested direct encrypted object. Actual group-key material remains inside Security v1 ciphertext.

### IdentityRotationProof (`kind 0x14`)

```text
schema 01
previousFingerprint raw32
nextIdentity DeviceIdentity
rotatedAt u64 BE
signature raw64
```

`nextIdentity.rotatedAt` must equal proof `rotatedAt`.

### Revocation / session retirement

There is **no network revocation object in BushMesh Protocol v1**. Security v1 defines peer revocation and session retirement as local trust/session state. `0x15` is reserved but rejected by a v1 decoder. An authority/fleet revocation protocol requires an explicit future trust model and versioned schema; v1 must never accept an unauthenticated remote revocation command.

## 6. Protected payload bodies

### Protected direct (`kind 0x01`)

Outer routing requirements:

- source node ID required
- destination node ID required
- group ID forbidden
- authenticated header required

Body:

```text
schema 01
securityVersion u8
protocolVersion u8
sessionId string
keyEpoch u32 BE
counter u64 BE
ciphertext byte-string (minimum 16-byte GCM tag, maximum 3072 bytes)
```

### Protected group/convoy (`kind 0x02`)

Outer routing requirements:

- source node ID required
- group ID required
- destination node ID forbidden
- authenticated header required
- outer `groupId` must equal Security object's `groupId`

Body:

```text
schema 01
securityVersion u8
protocolVersion u8
groupId string
epoch u32 BE
senderDeviceId string
counter u64 BE
ciphertext byte-string
```

## 7. Security AAD v1 — final

Canonical BushMesh protocol AAD is:

```text
42 4D 41 01
[protocolVersion:2 | packetType:6]
[priority:3 | compression:3 | ackRequested:1 | storeAndForward:1]
messageId VarUint
routingFlags u8
[sourceNodeId VarUint]
[destinationNodeId VarUint]
[groupId VarUint length + UTF-8]
```

The logical source/destination/group selector is included whenever exposed outside ciphertext because changing it can alter end-to-end delivery/authorization semantics.

The following remain outside end-to-end AAD because legitimate forwarding/transport changes them:

- TTL
- hop/path length
- next hop/relay path
- RSSI/SNR
- carrier/channel implementation details
- transport retry count/state
- receive timestamp
- fragment index/count and fragment CRC generated after protection

Security v1 additionally authenticates its own session/group version, key epoch, nonce counter, session/group ID and sender identity as defined by Security v1. Protocol routing IDs may intentionally overlap with Security-owned IDs because router-visible selectors must themselves be tamper-evident.

## 8. Emergency/distress Security policy

Default Protocol v1 policy is **`require-authentication`**.

- If a suitable direct/group security context is available, Distress is protected normally.
- If the selected context temporarily fails or Security verification fails, the runtime **must not automatically downgrade** to plaintext.
- If the product has explicitly enabled `allow-unauthenticated-fallback`, the application may deliberately prepare/send the ordinary `B5 4D` Distress packet without protection when no suitable context is available.
- A receiver using strict policy rejects unauthenticated Distress.
- A receiver explicitly configured to allow fallback may accept it but must mark it unauthenticated; it must not treat identity/group membership as verified.

Trade-off: allowing fallback can preserve emergency reachability when trust/key state is unavailable, but permits spoofing. The explicit opt-in prevents a cryptographic failure from silently becoming an unauthenticated success.

Convoy/group operational traffic has no such default fallback: Protocol v1 requires group protection for canonical Convoy traffic.

## 9. Protection and fragmentation order — final

Order is fixed:

1. construct the complete ordinary logical `B5 4D` BushMesh packet;
2. construct canonical protocol AAD from immutable logical metadata;
3. Security v1 encrypts/authenticates the complete ordinary packet payload object;
4. BushMesh serializes the Security object into one complete `B5 53` container;
5. **only now**, if carrier MTU requires it, BushMesh fragments the final `B5 53` bytes into ordinary `Fragment (0x0B)` packets;
6. receiver reassembles all fragment bytes into the complete original `B5 53` container;
7. Security v1 replay/authentication/decryption runs on the complete protected object;
8. BushMesh recomputes canonical AAD from decrypted ordinary bytes plus authenticated outer logical routing selectors;
9. typed decoding/delivery occurs;
10. whole-message delivery ACK, if used, may be produced only after successful steps 6..9.

Fragment headers, fragment CRC and selective fragment ACKs are outside the Security v1 end-to-end AAD. Their purpose is transport reconstruction, not cryptographic authenticity. Tampering that changes protected content is detected after complete reassembly by Security v1.

## 10. `dataType` and carrier integration

Protocol v1 assigns **no universal numeric `dataType` value**.

`dataType` is carrier-specific metadata mapped through an adapter to radio-core's neutral datagram envelope. Radio-core forwards `payload` opaquely. A carrier may use one dataType for all BushMesh bytes or separate local values if needed, but BushMesh receivers still classify the payload exclusively from `B5 4D` / `B5 53`.

MeshCore constants therefore never become BushMesh protocol constants.

## 11. Capability/version behavior

- ordinary protocol version is negotiated from the signed/advertised supported protocol range;
- Security v1 handshake signs supported Security/protocol lists and selected versions;
- capability loss after a previously accepted peer policy is surfaced as a downgrade signal;
- protected body protocol version must equal the decrypted BushMesh envelope version;
- Security container version other than 1 is rejected;
- Security body schema version other than 1 is rejected;
- unknown Security container kinds are rejected;
- no v1 parser skips trailing/unknown positional fields.

## 12. Golden vectors

Firmware-facing deterministic vectors are maintained in:

- `__tests__/bushmeshGoldenVectors.test.ts`
- `__tests__/bushmeshSecurityWireV1.test.ts`

They freeze ordinary envelopes, discovery, ACKs, canonical AAD, protected direct/group containers, pairing/session objects, wrapped group-key distribution and identity rotation.

## 13. Existing protocol modules

Protocol v1 also freezes the existing schemas/codecs for:

- compact location + GPS delta
- telemetry
- distress
- discovery/PING/PONG/capabilities
- route advertisements/routed payloads
- fragmentation/selective fragment ACK
- delivery ACK
- sync summaries/range requests
- convoy status/commands
- file transfer
- semantic/dictionary/raw text selection

Experimental XOR erasure coding remains experimental and is not part of the required Protocol v1 interoperability contract.

## 14. Hardware-pending validation

Software freeze does **not** claim the following without real devices:

1. MeshCore/Heltec preserves raw `B5 4D` / `B5 53` binary bytes including `0x00` and `0x80..0xFF`.
2. Real payload/MTU ceilings match configured carrier values.
3. Loss/out-of-order fragment behavior matches expectations under RF conditions.
4. RSSI/SNR/path metadata exposed by hardware is reliable enough for routing decisions.
5. Multi-node congestion/ACK behavior is acceptable.
6. Emergency priority actually pre-empts bulk traffic with real radio scheduling.
7. Long-running store-forward/routing does not exhibit hardware/firmware-specific loops.

The text-safe MeshCore carrier remains a compatibility adapter path until raw-binary hardware validation succeeds. These hardware gates do not change the frozen BushMesh Protocol v1 byte contract.
