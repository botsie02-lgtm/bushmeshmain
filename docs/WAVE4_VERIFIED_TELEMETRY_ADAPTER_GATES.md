# Wave 4 verified convoy telemetry — integrated library only, NOT activated

**Source:** `feature/verified-convoy-telemetry-v1` @ `49f0ac35fffb59a9a9c7598e7533297b4ebe9f9a`  
**Status:** Pure reusable, independently unit-tested contract/coordinator files. **No live send, receive subscription, map projection, GPS reader, or verified Drive roster is mounted.** No public contacts or carrier PSK may be a trusted member.

## Live adapter boundary, explicit dependency and fail-closed policy

| Port / dependency | Real production source required | Current Wave 4 disposition |
|---|---|---|
| `VerifiedTelemetryAuthority.resolveActiveRoster()` | Protected Security v1/v2 identity and current group key/epoch, approved signed membership/role roster and active convoy | **UNAVAILABLE.** No production resolver, no synthetic roster |
| Node binding `nodeId → deviceId+fingerprint` | Independent authenticated collision-checked canonical Protocol sourceNodeId mapping and current trust pins | **UNAVAILABLE** in frozen V1 group record; reject known contact/node guesses |
| `subscribeInvalidations()` | Security trust, identity rotation, membership revocation, epoch and active-convoy change notifications, plus revalidation on every operation | **UNAVAILABLE**, do not rely on UI events |
| `ProtectedConvoyRuntimePort` | Existing `BushMeshV1RuntimeService` accepted protected-group ingress/prepareAndQueue; *not* raw carrier frames | Library never instantiated by App/Radio/Map |
| `TelemetrySequencePort.next()` | Durable monotonic Protocol v1 32-bit convoy sequence + message ID across restart | **UNAVAILABLE.** Security v1 nonce counter is not the protocol sequence allocator |
| `TelemetryAirtimePort.allowProtectedPosition()` | Actual transport air-time/duty-cycle reservation, queue congestion, secured framing overhead | **UNAVAILABLE**; cadence alone is insufficient |
| `AndroidTelemetryFix` | Existing `LocationSessionProvider.latestFix` from genuine native Android GPS, with source, age and quality checked | No new GPS service or auto tracking; unmounted |
| `ProtectedTelemetryCheckpointStore` | Optional authenticated crash-durable private location snapshot rechecked against current roster, epoch and identity | **UNAVAILABLE**; no persisted remote positions, restart requires fresh authenticated receptions |
| ConvoyMap projection | Only `project().mapMembers` for the *same* independently verified active `convoyId` after actual group epoch/trust check | **NOT MOUNTED**; MapScreen keeps explicit empty authorized member list |
| Versioned packet authorization | Exact accepted canonical protected-group container, AAD, embedded node equals authenticated route source, sender identity, epoch, current roster | Library boundary tests only, no device-verified cryptographic proof |

The source has conservative local suppression: native fix not older than 30 s (future ≤5 s), accuracy ≤100 m; ≥30 s sends, 180 s heartbeat, 50 m movement/30° heading threshold and six locally queued updates per 10 minutes. These are policy limits, **not** a certified LoRa airtime/duty-cycle budget. The only positive publish result is `queued-locally`, **not a receiver ACK or delivery receipt**.

**Known protocol limitation:** Frozen Protocol v1 Convoy wire lacks original GNSS fix timestamp. The sender can check fix age, but a recipient cannot independently prove source sample age through delayed forwarding. Do not claim end-to-end position freshness until a reviewed additive encoding exists.

**Staging choice:** Import source files/tests unmodified; create **no instance** of `VerifiedConvoyTelemetry` in AppShell, MapScreen, Radio, background services or GPS context. No default `VerifiedTelemetryAuthority`, sequence allocator, airtime adapter or runtime subscription exists. The provider cannot send without all required dependencies and must not be represented as live. Only after full security/identity/node-binding and actual receipt tests may a separately approved change wire it.
