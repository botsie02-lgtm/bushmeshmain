# BushMesh multi-node convoy regression campaigns

Branch: `test/network-simulator-v1`

Protocol baseline: frozen `feature/bushmesh-lora-protocol` at
`67327e641b169ec94600a7b07188946058c067b7`.

This is a **test-only deterministic carrier and observation harness**.
It uses the frozen public `BushMeshDatagramRuntime`,
`BushMeshSecurityAdapter`, canonical convoy-wire encoder, and the
existing transport-neutral datagrams. It is **not** another protocol,
router, Security v1 implementation, radio adapter or convoy application state machine.

## How to run

```bash
npm ci
npx tsc -p tsconfig.network-simulator-v1.json --noEmit
npm test -- --runInBand __tests__/bushmeshNetworkSimulator.test.ts __tests__/bushmeshConvoyCampaigns.test.ts
```

The existing simulator regression suite remains in CI. New coverage
is in `__tests__/bushmeshConvoyCampaigns.test.ts`.
`throwConvoyCampaignFailure()` provides a deterministic JSON diagnostic:
scenario, seed, invariant failures, delivery/airtime/queue/position
report, node configuration, virtual-time timeline and the last 120
network events. No wall-clock sleeping or Heltec hardware is used.

## New validated scenario contracts

| Campaign | Virtual nodes | Regression invariant |
|---|---:|---|
| Fleet scaling | 2, 5, 12, 20 | All directed recipients accept the real group-protected convoy status; every peer view is fresh in the lossless case |
| Movement, separation and regroup | 8 | Synthetic distance disables links, no traffic crosses the split, held carrier datagram is delivered after regroup |
| GPS stale/loss/recovery | 3 | Fresh position becomes stale after virtual time, explicit location-unavailable clears it, a new sample returns fresh while ordinary radio remains usable |
| Asymmetric retries and duplicate/reordering chaos | 2 | Directed loss can differ; carrier retries honor public retry intent; real runtime dedup prevents inflated logical deliveries |
| Congestion, duty-cycle airtime and safety priority | 12 | Synthetic per-link duty-cycle occupancy, bounded queue drops and safety-class queue ordering are observable |
| Partition and healing | 5 | Deliberately deferred opaque datagram is held across a partition and drained on reconnect |
| Security adapter identity transition and member revocation | 3 | Receiver-provided Security adapter rejects retired session, old/unapproved rotated identities and revoked group sender, while an unaffected authorized member still delivers |
| Moving seeded chaos fleet | 20 | Reproducible split/heal, loss/duplication, peer disappearance, BLE/carrier interruption, GPS outage, retries, queue bounds and final fresh position |
| Reproducibility | 2 and 20 | Same seed produces identical report, metrics and complete event trace |
| Deliberately mismatched convoy identity | 2 | An accepted group packet with embedded node ID different from authenticated routing source is flagged by the test-only position audit, not silently applied |
| Fleet input limits | 1 and 21 rejected | Invalid fleet cardinality cannot create a partially initialized test topology |

The follow-on synthetic shared-channel/active Security stress suite is documented
in [NETWORK_SIMULATOR_SHARED_CHANNEL_STRESS.md](NETWORK_SIMULATOR_SHARED_CHANNEL_STRESS.md).
Its additional counters cover overlap, synthetic collision drops, sender queue
fairness/cooldown and carrier/partition/node recovery. The combined scoped
CI gate currently contains 43 deterministic regression tests. No production
RF, routing or incremental Security enrolment guarantee is implied.

The established ten deterministic baseline scenarios (including the 600-message
five-node soak, fragment-pending, protected direct/group containers and AAD
tampering) remain part of the same CI check.

## Mobility and observation model

`ConvoyMobilityHarness` owns virtual east/north metre coordinates, a
configurable synthetic distance threshold, and directed carrier-link
configurations. All 2–20 nodes are real instances of the frozen
`BushMeshDatagramRuntime`. `move()` and `moveGroup()` change
physical link reachability. They **do not** route or relay a
datagram: actual multi-hop forwarding remains protocol-owned.

Real `encodeBushMeshConvoyWire()` creates each status.
`prepareOutbound()` protects it with the fake group Security adapter
and constructs the canonical B5 53 container.
`acceptInbound()` performs the real frozen runtime decode,
Security dispatch and dedup. Test-only inbound observers inspect only
public results and never modify packets or runtime internals.

The test observation ledger records the sending virtual timestamp,
the canonical accepted `messageId`, the embedded convoy sequence,
authenticated routing source, and the accepted position/unavailable
flag. **Position freshness is an external diagnostic projection**:
`fresh`, `stale`, `unavailable`, or `never-seen`.
It is deliberately not a production peer-location cache or
authoritative convoy application state. Older accepted sequences
cannot overwrite a newer observed sequence; mismatches between the
accepted authenticated source and embedded convoy node ID are recorded
as unexpected state changes.

## Regression report fields

`ConvoyRegressionReport` exposes:

- `seed`, `nodeCount`, `simulatedAtMs`
- `delivery`: attempted, accepted, failed, delivery ratio,
  duplicate suppressions, runtime rejections, transport retries,
  harness deferred recoveries and average simulated latency
- `queue`: peak/current queue depth, peak queued bytes,
  congestion/expiry/unavailable drop counters
- `airtime`: physical transmission attempts, synthetic airtime
  milliseconds, transmitted bytes
- `positionFreshness`: peer-by-peer views, aggregate
  fresh/stale/unavailable/never-seen counts, older-sequence
  suppression and unexpected accepted state changes

These reports explicitly distinguish successful **logical protocol
delivery** from carrier retries and injected duplicate copies.
The 20-vehicle seeded campaign also checks pending scheduler work and
queue bounds before completing.

## Security lifecycle test limitations

`SecurityDecisionTestAdapter` uses the **existing frozen**
`BushMeshSecurityAdapter.protect/unprotect` interface and delegates
test encoding/decoding to the existing `FakeBushMeshSecurityAdapter`.
A test changes the provider's allowed session IDs and group sender
identity set to model decisions that a real Security v1 trust,
revocation or rotation provider would make.

This does **not** implement identity verification, cryptography, keys,
a Security trust manager, signed rotation proof, or authoritative group
membership. It proves that when an injected Security provider rejects
a retired or revoked object, the **canonical runtime** fails closed
with `security-failed` instead of accepting it or silently
downgrading to plaintext. Real Security v1 provider lifecycle tests
must run in the owning Security branch/integration.

## Boundaries and hardware limitations

- Carrier links are directed and distance-gated, with synthetic
  RSSI/SNR. They are not empirical LoRa signal propagation,
  collision/capture, channel contention, hidden-node or interference
  models. Airtime/duty-cycle scheduling is currently **per directed
  virtual link** rather than shared across a real RF channel.
- Store-if-unavailable is a **test harness holding an already-created
  opaque datagram**, not canonical store-and-forward/relay policy.
  Retry metrics cover explicit `transport-retry` intent, not
  a production acknowledgement/resend engine.
- No production convoy membership or peer GPS-location cache is
  exposed on the frozen stable runtime facade; position freshness
  and topology observations are deliberately test-only.
- The model does not implement actual routing/forwarding, onboard GPS
  fixes, BLE firmware queues, native app background lifecycle or
  production Android/iOS Security providers.
- Heltec field tests are still required for channel collisions,
  measured time-on-air and regional duty cycle, antenna effects,
  distance/terrain, packet loss, GPS reception, BLE interruptions,
  power/reset behavior and moving convoy topology.

Failures in these simulated transport contracts are inexpensive to
reproduce from a seed, but the deterministic pass is **not proof of
end-to-end RF or physical convoy readiness**.
