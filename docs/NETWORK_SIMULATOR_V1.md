# BushMesh Deterministic Network Simulator v1

Branch: `test/network-simulator-v1`

Expanded 2–20 vehicle mobility, seeded chaos, Security-provider lifecycle and
position-freshness regression campaigns are documented in
[NETWORK_SIMULATOR_CONVOY_CAMPAIGNS.md](NETWORK_SIMULATOR_CONVOY_CAMPAIGNS.md).
The CI suite emits machine-readable deterministic campaign reports as a GitHub
Actions artifact in addition to full seed/timeline diagnostics on failure.

Protocol v1 regression baseline: `67327e641b169ec94600a7b07188946058c067b7`

Status: test/integration harness only. This branch does **not** implement a competing BushMesh protocol/runtime, security subsystem, radio lifecycle, or application state machine.

## Ownership and integration boundary

The simulator is intentionally built around the canonical public seams rather than importing implementation helpers.

- Protocol/runtime ownership remains `feature/bushmesh-lora-protocol`.
- Identity/trust/cryptography ownership remains `foundation/security-identity-v1`.
- Application/radio/hardware lifecycle ownership remains `foundation/radio-core-v1`.
- Simulator/chaos ownership is this branch only.

Each virtual node wraps the canonical `BushMeshDatagramRuntime` from `src/bushmesh/runtime/public.ts`. Outbound traffic is created by `BushMeshDatagramRuntime.prepareOutbound(...)`; the fake radio medium treats the resulting payload as opaque bytes. Delivery enters the destination through `BushMeshDatagramRuntime.acceptInbound(...)` with neutral carrier metadata including `sourceNodeId`, RSSI, SNR and path length.

Protocol packets used to drive scenarios are encoded through `src/bushmesh/protocol/public.ts`. The simulator does not duplicate the canonical codec, packet semantics, acknowledgement semantics, routing implementation, fragment reassembly or Security AAD rules.

Security-required scenarios use `FakeBushMeshSecurityAdapter`. It deliberately performs no cryptography. It consumes and returns the current transport-neutral Security adapter objects while the canonical BushMesh runtime remains responsible for B5 53 Security-container serialization, authenticated routing context and AAD validation. Real Security v1 providers can replace the fake adapter later without changing the virtual radio medium.

## Architecture

`DeterministicBushMeshNetworkSimulator`

- owns a seeded PRNG, virtual clock, virtual nodes, directed links, queues and scheduled carrier events;
- applies failures to the transport/network only;
- never edits packet fields or packet payload contents to manufacture a fault;
- records an event trace and metrics continuously;
- can produce a self-contained failure report with seed, node config, simulated timeline, recent trace and metric snapshot.

`VirtualBushMeshNode`

- owns one real canonical `BushMeshDatagramRuntime`;
- injects virtual time, in-memory runtime persistence, mutable carrier availability and optionally the fake Security adapter;
- supports restart against the same persistence store so dedup restoration is exercised through the real runtime public contract.

`VirtualBushMeshClock`

- implements `BushMeshRuntimeClock`;
- advances deterministically without wall-clock sleeps;
- lets long scenarios such as a 90-second disappearance complete immediately in CI.

Directed virtual links model an asymmetric fake radio. Per-link transmission queues are priority ordered according to the neutral outbound priority already assigned by the canonical runtime. Airtime occupancy is calculated from opaque payload byte length and configured link bitrate/overhead/duty-cycle; packet semantics remain untouched.

## Supported failure models

The current virtual medium supports:

- seeded random packet loss;
- packet duplication;
- base delay and jitter;
- delayed delivery/reordering;
- directed/asymmetric links;
- explicit network partitions and healing;
- node disappearance and rejoin;
- congestion and bounded transmit queues;
- bitrate limits, payload-size limits and queue byte limits;
- estimated airtime and duty-cycle occupancy;
- RSSI and SNR changes supplied only as inbound link metadata;
- GPS availability and staleness observation independent from radio connectivity;
- carrier disconnect and reconnect through the canonical availability port;
- transport retry attempts only when the canonical outbound retry intent explicitly permits transport retry;
- deferred transport work for scenarios that explicitly request store-if-unavailable behaviour;
- runtime restart with persisted dedup state.

## Metrics

The simulator currently records:

- logical datagrams attempted, delivered and failed;
- physical transmission attempts and transport retries;
- canonical runtime rejections and duplicate suppressions;
- canonical `fragment-pending` observations without counting incomplete fragments as logical deliveries;
- injected duplicate copies;
- total transmitted bytes;
- estimated airtime;
- end-to-end latency samples and SOS/emergency latency samples;
- queue depth/bytes, maxima and drop causes;
- physical topology/path changes and observation convergence time;
- deferred/store-and-forward recoveries;
- peer observation staleness and GPS-location staleness;
- carrier disconnect/reconnect events;
- RSSI/SNR quality changes;
- scenario-defined convergence delivery counters.

These metrics distinguish a *logical* BushMesh datagram from one or more *physical* radio attempts/copies/fragments so retry, duplication or fragmentation chaos does not appear as successful logical amplification.

## Initial deterministic scenarios

The CI suite implements the requested initial scenarios:

1. Three-node convoy A-B-C where B disappears for 90 seconds and rejoins.
2. 35% seeded random packet loss.
3. Network partition followed by healing.
4. A node loses GPS while remaining radio-connected.
5. Link/path quality changes while traffic is active.
6. Congestion with ordinary traffic followed by an SOS, verifying priority queue behaviour.
7. Duplicate and delayed packet storm, including protected direct traffic through the fake Security adapter, authenticated source/destination routing context and real canonical runtime dedup.
8. Store-and-forward/deferred transport through a temporarily unreachable destination.
9. Node restart with persisted canonical runtime dedup state.
10. A 600-message, five-node seeded soak with loss, duplication, jitter, reordering, topology changes, carrier interruption and bounded-queue/amplification invariants.

Additional CI checks verify exact same-seed metric/trace reproducibility, asymmetric links, payload limits, expiry while queued, carrier reconnect recovery, changing RSSI/SNR while a link is actively transmitting without stranding queued work, canonical protected fragment reassembly with `fragment-pending`, finalized direct/group Security-container behavior, and fail-closed AAD validation after authenticated routing metadata is tampered.

## Frozen Protocol v1 maintenance result

The simulator was synchronized from the previous protocol baseline `878c20ebec3aa11ec1f72605d3d9e20c41699a64` to the final software-level Protocol v1 freeze at `67327e641b169ec94600a7b07188946058c067b7`.

The frozen runtime now owns fragment reassembly inside `BushMeshDatagramRuntime.acceptInbound(...)` and publicly exposes `BushMeshInboundFragmentPending`. The simulator treats that result as an incomplete logical delivery, records it separately, and waits for the canonical runtime to return an accepted logical datagram before incrementing delivery/latency metrics.

A protected direct datagram is fragmented only after the canonical runtime has serialized its B5 53 Security container. The regression test sends those ordinary B5 4D fragment wrappers through the fake radio; intermediate receives return `fragment-pending`, and the completed reassembly is then unprotected and AAD-validated by the canonical runtime. This confirms the simulator is not performing a parallel fragment or Security implementation.

The fake Security regression coverage now exercises finalized direct and group protected containers. A separate tamper case changes serialized authenticated routing metadata while retaining the original authenticated header and protected object; the frozen runtime rejects the datagram with `security-failed`, confirming fail-closed AAD behavior through the test provider boundary.

The simulator CI also includes a scoped TypeScript contract gate covering the canonical protocol/runtime public surface and simulator integration. On the frozen Protocol v1 head it passes, followed by 17/17 deterministic Jest tests including the long seeded soak and exact same-seed trace/metric replay.

## Reproducing a failure

Every scenario has a fixed default seed and may also be called with another integer seed. `throwScenarioFailure(...)` includes the full `SimulatorFailureReport` in the Jest failure text. The report contains:

- seed;
- simulated time of failure;
- virtual node configuration;
- explicit topology/carrier/GPS timeline events;
- recent important packet/event trace;
- metrics snapshot.

Re-run the named scenario with that seed to replay the same random decisions and virtual timeline.

## Canonical runtime contract gaps exposed by simulator work

No workaround is implemented here for these gaps because doing so would create competing protocol/runtime behaviour.

### 1. Stable public runtime has no routing engine/control surface

`BushMeshDatagramRuntime` exposes neutral datagram preparation/acceptance, Security, dedup, persistence, fragment reassembly and carrier availability. Its stable facade currently exposes no canonical route table, route-change event, route convergence state, forwarding callback, relay/store queue, or routing-loop diagnostic surface.

Therefore `routeChanges` and `routeConvergenceSamplesMs` in this simulator currently describe **physical virtual-medium reachability/path observations only**. Scenario 5 deliberately proves the alternate transport topology exists; it does not claim that the canonical BushMesh routing algorithm selected or forwarded over that path.

A future protocol/runtime integration should expose a stable test/integration observation surface if CI is expected to assert canonical route convergence and routing-loop freedom end to end.

### 2. Stable public runtime has no convoy application-state convergence surface

The canonical datagram facade does not expose convoy membership/status state or a convergence event. Scenario 1 therefore tests transport disappearance/rejoin, deferred delivery and a scenario-level delivery convergence counter. It does not invent a convoy state engine.

Full convoy-state convergence testing requires the canonical protocol/runtime and radio-core application integration to expose the appropriate public application-facing ports.

### 3. Stable public runtime has no canonical location-state expiry surface

The simulator can independently model GPS loss/staleness and prove datagram delivery remains connected, but it cannot currently assert the canonical peer-location cache expiration because that state is not on the stable runtime facade. `staleLocationExpiries` is therefore a virtual sensor/state observation metric, not a claim about a hidden runtime cache.

### 4. Store-and-forward ownership needs a canonical public integration hook

The wire envelope can mark store-and-forward intent, while the stable datagram runtime itself does not expose a store/relay queue API. The simulator's `storeIfUnavailable` option is explicitly a **virtual transport harness behaviour** used to hold an already-created opaque datagram while the fake carrier is unavailable. It does not reinterpret the packet or claim to implement the canonical store-and-forward algorithm.

To test canonical store-and-forward policy, expiry, relay selection and recovery end to end, the protocol/runtime needs to expose its production store/forward integration surface publicly.

### 5. Retry metrics are limited to transport retry intent

The public outbound contract exposes `BushMeshRetryIntent`, so the simulator can count transport attempts and enforce `maxTransportAttempts`. Protocol-managed acknowledgement/retry scheduling is not exposed as a stable runtime observation/control port here, so `transportRetries` must not be read as the total future protocol retry count.

### 6. Previously observed canonical runtime TypeScript defects are resolved upstream

The earlier simulator maintenance pass exposed protocol-owned TypeScript narrowing failures in `BushMeshDatagramRuntime.ts`: direct/group protected-message members were accessed without sufficient narrowing, and a general decoded Security container was assigned to a Security-control-only type.

Those errors no longer reproduce at frozen Protocol v1 SHA `67327e641b169ec94600a7b07188946058c067b7`. The frozen runtime explicitly narrows protected direct/group containers before association-specific access and uses a Security-control type guard before returning control containers. The simulator-scoped TypeScript gate now passes without modifying canonical protocol/runtime source.

The earlier missing `setTimeout`/`clearTimeout` diagnostics were caused by the experimental narrowed simulator tsconfig omitting timer globals, not by the canonical runtime contract. The maintained simulator typecheck includes the correct standard library globals.

No new canonical runtime behavioral bug was found in this frozen-head maintenance pass. The remaining items above are public observation/integration gaps, not simulator workarounds.

## Simulator harness defects found and fixed during soak/maintenance development

The deterministic tests caught three simulator-only issues, all fixed on this branch:

- unconfigured directed links were initially treated as default connected links during physical path observation, accidentally creating an implicit full mesh;
- updating RSSI/SNR while a link was busy initially replaced the link-state object, so the scheduled completion mutated the old object and could strand queued work behind a permanently-busy replacement. Link configuration is now mutated in place and has a focused regression test;
- after the frozen runtime introduced public `fragment-pending`, the simulator initially treated that non-final result as a delivered datagram. It now records fragment-pending separately and only counts the completed canonical reassembly as one logical delivery.

These were harness bugs, not canonical BushMesh runtime bugs.

## Areas that still require physical Heltec testing

The deterministic simulator is intentionally unable to establish real RF or device behaviour. Physical Heltec validation is still required for:

- actual LoRa packet error rates versus distance, terrain, foliage, vehicle bodies and antenna placement;
- real RSSI/SNR distributions and whether hardware-reported values match simulator assumptions;
- measured time-on-air for the selected radio profiles, preamble/coding/spreading-factor/bandwidth settings and real payload framing overhead;
- regional duty-cycle/legal constraints and radio firmware enforcement;
- collisions, capture effect, hidden-node behaviour, near/far behaviour and channel activity under concurrent transmitters;
- BLE/USB phone-to-Heltec disconnect/reconnect timing and buffering behaviour;
- firmware payload limits, fragmentation boundaries and device-side queue limits;
- device reset/brownout behaviour and persistence across actual power loss;
- GPS cold/warm start, stale fixes, tunnel/canyon/forest loss and recovery;
- battery, thermal and sustained-transmit behaviour;
- real convoy movement and RF topology changes at road speed;
- timing interactions between phone background execution, BLE lifecycle and radio firmware;
- production Security provider behaviour on Android/iOS when integrated with real devices.

The simulator should be used to make deterministic correctness failures cheap and reproducible before those physical tests, not as a substitute for RF/hardware validation.
