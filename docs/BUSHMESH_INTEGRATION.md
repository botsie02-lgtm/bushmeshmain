# BushMesh Protocol v1 canonical integration contract

Branch: `feature/bushmesh-lora-protocol`

Status: **software-level Protocol v1 / Security v1 / radio integration contract frozen.** Hardware behavior remains separately gated.

BushMesh owns the application protocol/runtime. Radio-core owns hardware/radio lifecycle and transports already encoded opaque datagrams. Security v1 owns identities, trust, sessions, group keys, cryptography, nonces/replay and local rotation/revocation state. MeshCore is a compatibility carrier only.

## Canonical imports

Normal application integration:

```ts
import {
  BushMeshDatagramRuntime,
  BushMeshPacketType,
  BushMeshPriority,
} from '../src/bushmesh';
```

Firmware/protocol implementations use `src/bushmesh/protocol/public.ts`. Runtime/radio/security integrators use `src/bushmesh/runtime/public.ts`. Do not build new integrations against the broad `protocol/index.ts`, `runtime/index.ts` or current React Native compatibility hubs.

## Runtime seam

`BushMeshDatagramRuntime` has no radio `send()` method and imports neither radio-core nor MeshCore. It accepts injected:

- `BushMeshRuntimeClock`
- `BushMeshRuntimePersistence`
- `BushMeshTransportAvailabilityPort`
- `BushMeshSecurityAdapter`

It produces `BushMeshOutboundDatagram` and consumes `BushMeshInboundDatagram`.

Radio-core treats `payload` as opaque bytes. BushMesh owns payload classification, version checking, Security-container parsing, typed protocol decode and duplicate suppression.

## Payload classification

No carrier hint is required to distinguish protection state.

```text
B5 4D -> ordinary BushMesh v1 packet / Fragment wrapper
B5 53 01 01 -> protected direct container
B5 53 01 02 -> protected group/convoy container
B5 53 01 10..14 -> frozen Security v1 control container
```

Unknown magic, unknown kind or unsupported container version fails closed.

The former `securityProtected` carrier hint is not part of the canonical inbound interface.

## Outbound radio-core mapping

BushMesh `BushMeshOutboundDatagram` maps to radio-core `OutboundDatagramEnvelope` without importing that type:

| BushMesh | radio-core |
| --- | --- |
| `channelIndex` | `channelIndex` |
| `dataType` | `dataType` |
| `payload` | `payload` exactly; opaque bytes |
| `priority` | `priority` |
| `expiresAtMs` | `expiresAtMs` |
| `retryIntent.maxTransportAttempts` | `retryPolicy.maxAttempts` |
| session/group/identity association | integration-selected `identityRef` |
| `diagnostics.label` | `description` |
| `createdAtMs` | `createdAtMs` |

`dataType` is deliberately **carrier-specific integration metadata**. Protocol v1 assigns no universal numeric value. It must never be confused with the BushMesh packet type or the protected/plain discriminator.

For `retryIntent.mode === 'protocol-managed'`, radio-core normally makes one transport attempt. BushMesh protocol ACK/retransmission remains the protocol's responsibility; radio-core must not create a second independent reliability loop.

## Inbound radio-core mapping

Map carrier receive information to `BushMeshInboundDatagram`:

- `channelIndex`
- carrier-specific `dataType`
- opaque `payload`
- `receivedAtMs`
- transport/bearer identifier
- live/background-replay source
- optional RSSI/SNR/path length
- optional transport/radio identity references and diagnostic label
- optional `sourceNodeId` when the carrier already knows a BushMesh node ID

Radio-core must not parse `B5 4D`, `B5 53`, envelope fields, fragments, ACKs, routing or Security object layouts.

## Security v1 adapter contract

The final application provides `BushMeshSecurityAdapter`. It bridges to `foundation/security-identity-v1`; it does not own wire serialization.

### Outbound protected traffic

BushMesh supplies Security:

```text
plaintextWireBytes  // complete logical B5 4D packet
SecurityProtocolContext {
  protocolVersion,
  authenticatedHeader
}
routing            // logical source/destination/group selectors
association        // direct-session or group
trafficClass
```

Security v1 returns its transport-neutral object:

- direct: `EncryptedDirectMessage`
- group/convoy: `EncryptedGroupMessage`

BushMesh then serializes that object into the frozen `B5 53` container.

Security does not return final carrier bytes. BushMesh does not receive private keys.

### Inbound protected traffic

BushMesh parses the complete `B5 53` container, supplies its Security object + canonical AAD context to Security v1, receives plaintext `B5 4D` bytes only after Security succeeds, then recomputes AAD from the decrypted packet plus authenticated outer routing selectors.

Any mismatch is `security-failed`. There is no fallback to a weaker mode after authentication/replay/version failure.

## Final AAD v1

Exact bytes:

```text
42 4D 41 01
[protocolVersion:2 | packetType:6]
[priority:3 | compression:3 | ACK:1 | storeForward:1]
messageId VarUint
routingFlags u8
[sourceNodeId VarUint]
[destinationNodeId VarUint]
[groupId VarUint length + UTF-8]
```

Routing flags:

- bit 0 source node ID
- bit 1 destination node ID
- bit 2 group ID
- bits 3..7 invalid in v1

### Immutable identity decision

Logical router-visible source/destination/group identity **is authenticated** when exposed outside ciphertext. This prevents a relay/attacker from changing who a protected payload appears to be from, who it is logically addressed to, or which group it is routed as while retaining valid ciphertext.

Security v1 also authenticates Security-owned session/group/sender fields internally.

### Mutable fields deliberately excluded

- TTL
- hop/path length
- next hop / relay path
- RSSI/SNR
- carrier/channel implementation metadata
- retry attempt state
- local timestamps
- post-protection Fragment headers/CRC/index/count

Routers may mutate these without invalidating end-to-end Security.

## Frozen Security v1 transport kinds

`B5 53 01 <kind>`:

| Kind | Security v1 object |
| --- | --- |
| `01` | `EncryptedDirectMessage` |
| `02` | `EncryptedGroupMessage` |
| `10` | `PairingProof` |
| `11` | `SessionOffer` |
| `12` | `SessionResponse` |
| `13` | `WrappedGroupKeyDistribution` |
| `14` | `IdentityRotationProof` |
| `15` | reserved/undefined; rejected by Protocol v1 |

The complete positional field encoding and size limits are specified in `BUSHMESH_PROTOCOL.md` and implemented by `src/bushmesh/protocol/securityWire.ts`.

### Revocation/session retirement decision

Security v1 intentionally defines peer revocation/session retirement as **local trust/session state**, not as a network authority message. Therefore Protocol v1 has no revocation-control wire object. A future fleet/authority revocation protocol requires a separately authenticated trust model and new versioned schema. Never reinterpret `Command`, `DeviceInfo` or reserved kind `0x15` as remote revocation in v1.

## Emergency/distress policy

Runtime default: `require-authentication`.

### Security context available

Use it. Direct/group Security protection is applied according to the intended recipient/group.

### Context temporarily unavailable

Default behavior is to **refuse unauthenticated send/accept** rather than silently weaken security.

A product that explicitly chooses availability over authenticity may configure `allow-unauthenticated-fallback`. In that mode it may deliberately send/accept an ordinary `B5 4D` Distress packet, but the runtime labels it `unauthenticated-emergency-fallback`. Such traffic proves neither sender identity nor group membership.

### Security operation fails

Authentication, downgrade, replay, counter rollback, revocation, expiration or other Security failure never triggers automatic fallback. A new explicit send decision is required.

This is intentionally conservative: emergency spoofing can cause serious harm, so unauthenticated reachability is an opt-in safety/product decision rather than an implicit protocol behavior.

## Protection / fragmentation / ACK ordering

Frozen v1 order:

```text
logical B5 4D packet
 -> canonical AAD
 -> Security v1 protect
 -> BushMesh B5 53 serialization
 -> optional BushMesh Fragment packets
 -> radio-core opaque transport

receive Fragment packets
 -> byte-level reassembly
 -> complete B5 4D or B5 53 datagram
 -> Security verification/decrypt if B5 53
 -> recompute/compare AAD
 -> typed decode/delivery
 -> whole-message delivery ACK if applicable
```

Selective fragment ACK confirms receipt of fragment bytes only. Fragment CRC is corruption detection only. Neither is proof of Security authentication or logical delivery.

`BushMeshDatagramFragmentReassembler` is the canonical byte-level reassembly primitive. A BushMesh integration must reassemble before handing the complete logical payload to security/decode dispatch; radio-core does not implement BushMesh fragmentation.

## Security control dispatch

Security control containers are signed/protected Security objects, not ordinary BushMesh application packets. `BushMeshDatagramRuntime.acceptInbound()` surfaces them as an accepted `kind: 'security-control'` result. The application then passes the decoded structural object to the matching Security v1 service:

- `PairingProof` -> pairing verification/trust UX
- `SessionOffer` -> direct session offer acceptance
- `SessionResponse` -> direct session finalization
- `WrappedGroupKeyDistribution` -> group key installation
- `IdentityRotationProof` -> trust rotation handling

BushMesh only validates deterministic wire structure. Security remains authoritative for cryptographic verification, freshness, replay and trust.

## Protocol version/downgrade rules

- Protocol envelope version is 1 for the frozen contract.
- Security-container version is 1.
- Each Security-control body schema is 1.
- Unsupported versions are rejected, never interpreted as v1.
- Unknown/trailing v1 fields are rejected; v1 is fixed positional, not extensible TLV.
- Signed Security handshake version negotiation remains Security-owned.
- `capabilityPolicy.ts` detects loss of previously accepted protocol capabilities as a downgrade signal; Security/trust policy decides whether explicit re-pair/reconfiguration makes the change legitimate.

## Public modules another branch must use

Application:

- `src/bushmesh/index.ts`

Protocol/firmware:

- `src/bushmesh/protocol/public.ts`
- `src/bushmesh/protocol/securityWire.ts`
- `src/bushmesh/protocol/securityBoundary.ts`
- `src/bushmesh/protocol/packetTypes.ts`
- `src/bushmesh/protocol/versioning.ts`

Runtime integration:

- `src/bushmesh/runtime/public.ts`
- `src/bushmesh/runtime/integration.ts`
- `src/bushmesh/runtime/BushMeshDatagramRuntime.ts`

Do not integrate against MeshCore bridge types or broad compatibility barrels.

## Golden-vector authority

Firmware cross-implementation vectors live in:

- `__tests__/bushmeshGoldenVectors.test.ts`
- `__tests__/bushmeshSecurityWireV1.test.ts`

Any firmware or alternate runtime claiming Protocol v1 compatibility should reproduce those bytes exactly.

## Hardware-pending only

The software contract is frozen without pretending to know hardware behavior. Still pending real Heltecs:

- raw binary preservation including NUL/high-bit bytes
- actual carrier MTU/payload ceilings
- real RF loss/reordering and selective retransmission behavior
- reported RSSI/SNR/path semantics
- congestion/ACK interactions across multiple radios
- emergency pre-emption under actual radio scheduling
- long-duration routing/store-forward behavior

Text-safe MeshCore carriage remains a compatibility path until raw binary is proven on hardware. None of these hardware measurements may silently change Protocol v1 bytes; a wire-breaking change requires a future version.
