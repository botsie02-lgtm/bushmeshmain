# BushMesh deterministic shared-channel and Security-boundary stress

Branch: `test/network-simulator-v1`  
Frozen Protocol v1 baseline: `67327e641b169ec94600a7b07188946058c067b7`

## Scope and explicit non-claims

This branch extends a **test-only synthetic virtual radio medium**. No change
was made to the canonical Protocol v1, Security v1, application radio runtime,
carrier adapter or protocol routing. Tests require no device, GPS, firmware or
radio hardware and use a virtual clock and fixed pseudorandom seeds.

The shared-channel mode is **opt-in** via
`DeterministicBushMeshNetworkSimulator.configureSharedChannel({enabled: true, captureMarginDb})`
before transmitting traffic. The original baseline simulator tests use their
unchanged directed-link mode, preserving previous deterministic results.

### Synthetic shared-channel assumptions

- Each simulated vehicle can occupy one outbound virtual transmitter at a time.
  Its queued packets are selected by canonical outbound priority, then FIFO
  packet ID across destination links. This is harness scheduling, **not** a
  BushMesh MAC algorithm.
- Actual airtime uses configured payload size, bitrate and overhead.
  The sending vehicle remains busy during the **additional**
  `airtime / dutyCycle` cooldown. The collision window includes only
  actual airtime, **not** the subsequent cooldown.
- Two frames on the same `channelIndex` collide when their airtime windows
  overlap and an intervening directed radio link says the other transmitter
  can be heard by the recipient. A receiver transmitting at the same time
  is treated as half-duplex. Transmissions on different channel indices
  do not interfere.
- By default both mutually audible overlapping frames fail. A nonnegative
  `captureMarginDb` enables a synthetic, static signal-difference capture
  rule using the configured RSSI at each receiver. It is not calibrated or
  probabilistic capture and **does not** model LoRa modem behavior.
- Directed virtual links have their own configured RSSI and are not a
  real shared regulatory duty-cycle accounting authority. This model omits
  modulation spreading-factor orthogonality, preamble timing, CAD/LBT,
  hidden-node carrier sense, collision recovery coding, adjacent-channel
  interference, power control and empirical antenna/terrain loss.
- Physical broadcast to several receivers is represented as separately
  scheduled **carrier-leg copies** of an opaque datagram. A sending
  vehicle serializes these copies; this is intentionally **not**
  a faithful one-transmission-to-many RF broadcast implementation.
- Collided transport attempts may retry only when the frozen public
  outbound `BushMeshRetryIntent` expressly requests transport retry.
  The retry and queue arbitration remain test-harness mechanics.

New diagnostics: `channelOverlaps`, `droppedCollision`,
`senderContentions`, `maxQueueWaitMs`, `dutyCycleHoldMs` and
`transmissionsBySender`. These are all synthetic quantities.

## Deterministic stress campaigns

| Scenario | Nodes | Main invariant |
|---|---:|---|
| Simultaneous 11-sender contention to one receiver | 12 | Overlapping airtime causes collision drops; every sender obtains virtual transmission turns and bounded queues drain |
| RSSI capture and separate channel index | 4 | The stronger signal survives the same-channel overlap; transmissions with different channel indices do not collide |
| Shared-sender FIFO and safety queue fairness | 8 | Only one transmitter per vehicle, no traffic loss without an interferer, high-priority message immediately follows in-flight ordinary traffic, duty-cycle wait applies |
| Leader isolation, relay disappearance and regrouping | 8 | The synthetic physical path splits and heals, deferred opaque carrier legs drain when individually reconnected; no automatic multi-hop forwarding is claimed |
| Extreme delay and position reorder | 2 | Newer authenticated location becomes visible first, old accepted sequence is ignored by test-only view, last known fix eventually becomes stale |
| Active group epoch, replay, forgery and revocation | 4 | Injected Security adapter denies stale/unavailable epochs, reused fake counter, revoked member and foreign sender-source binding; unaffected authorized member retains service |
| Extended moving/partitioned contention soak | 20 | 401 carrier-leg attempts per seed, 10 traffic epochs, synthetic collisions, retry, position freshness, GPS/carrier/node/partition changes, and bounded drains |
| Fixed-seed reproducibility | 20 | Report, metrics and complete virtual event trace match across two runs with identical seed |
| Invalid shared-channel settings | 2 | Invalid capture margin and mid-transmission reconfiguration are rejected |

The extended soak uses **three fixed seeds**:
`0x55a71ee1`, `0x55a71ee2`, and `0x55a71ee3`.
The deterministic replay regression separately uses `0x51d0c0de`.
All tests run via the same scoped TypeScript gate and existing
`__tests__/bushmeshConvoyCampaigns.test.ts` suite.

## How to run

```bash
npm ci
npx tsc -p tsconfig.network-simulator-v1.json --noEmit
npm test -- --runInBand __tests__/bushmeshNetworkSimulator.test.ts __tests__/bushmeshConvoyCampaigns.test.ts
```

The test suite writes
`artifacts/network-simulator/convoy-regressions.json`. CI uploads this
report even after test failures, when the test runner reaches its
`afterAll` hook. Each scenario records seed, virtual-node count,
message attempted/accepted/failed, duplicates, security rejections,
collision losses, queue peaks/drops, airtime/cooldown/contentions,
per-peer position freshness, detected unauthorized identity changes
and carrier/partition/node reconnection. A failure includes seed,
source configuration, the event timeline and recent trace.

Do **not** compare these statistics to real LoRa link performance
unless calibrated with hardware measurements.

## Security boundary and integration contract limitations

`SecurityDecisionTestAdapter` delegates the same frozen
`BushMeshSecurityAdapter.protect/unprotect` boundary already used by
the simulator. The harness injects policy decisions for approved
sender IDs, source bindings, accepted group epochs and fake
monotonically increasing counters. It does **not** implement or prove
cryptographic replay windows, group key distribution, secure
incremental enrolment, encrypted authorized key updates, signed
identity rotation, or proof of membership. Those require the
production Security owner/provider.

In a deliberately malformed test, the frozen datagram runtime
accepts a group-protected convoy wire object with a different
embedded `nodeId` from the authenticated logical routing
`sourceNodeId`. The **test-only convoy observation ledger** flags
the mismatch and refuses to mutate peer position state. The owner
of production convoy-state integration must enforce that association
before applying an authenticated update. The test confirms the
boundary is observable; it does **not** claim production UI acceptance
or successful real-world identity forgery.

The fake provider also tests that a high-water counter decision can
reject a repeated or extremely reordered fake counter. Real
Security v1 may employ a bounded replay window instead. Tests that
require real key epoch changes or key distribution must be run with
the **actual Security owner implementation**, not this fake provider.

The frozen public `BushMeshDatagramRuntime` does not expose a
canonical route-forwarding/relay queue or authoritative convoy member
state. A physical multi-hop path discovered by the virtual medium
therefore **does not cause automatic application packet forwarding**.
The relay test asserts this explicitly. Held traffic is an opaque,
simulator carrier-level store-if-unavailable option, not production
store-and-forward delivery, relay selection or queue expiry.
No replacement protocol or router was introduced.

## Physical hardware validation still required

Actual LoRa shared-medium collisions, capture thresholds, airtime
and channel occupancy; legal regional limitations; RF loss and hidden
terminals; modem timing, BLE carrier interruption, firmware buffering,
vehicle motion and GPS staleness; and production Security provider
behavior remain outside synthetic coverage.

The fixed-seed stress suite is a deterministic regression safety
net and an integration-observation aid, **not a certification of
secure enrolment, multi-hop operation or physical RF readiness**.
