# Wave 4 genuine convoy join and position share: two-phone/two-radio acceptance

**Status:** TEST PLAN / NOT EXECUTED. No production join can be accepted until the formal Security v2 gate is signed off and the exact provider/transaction/source SHAs are reviewed.

## Required rig and prerequisites

- **Phone A:** Samsung Galaxy S22+, exact Wave 4 APK/build SHA recorded, connected to **Heltec A** through the existing Background Radio owner.
- **Phone B:** independent Android handset (record actual model, Android API, provider capability and APK SHA), connected to **LilyGo B** via its own Background Radio connection.
- **Radios:** same verified Australia (Narrow) MeshCore profile and unchanged **private channel #4** PSK, matching compatible firmware; record identifiers and packet-acceptance diagnostics without exposing secrets.
- The two phones must have separately generated, independently persistent Security v1 Ed25519/X25519 identities; never reuse private keys or fabricate peers. Verify displayed identity fingerprints out of band (QR/voice comparison, not public contact discovery).
- Preserve Wave 3 S22+ app data, installed real Melbourne OSM pack (`melbourne-cbd-osm-roads-v1`/`bbbike-20261109` unless separately updated), encrypted history, radio permissions and manual GPS settings. Install upgrades in place; **no uninstall/wipe or PSK rotation**.
- Use an authorized, isolated physical test environment, record timestamps and transaction IDs only in redacted logs. Keep the phones stationary/parked for safety-control tests. No evidence of the below is claimed in advance.
- Stop immediately if either provider reports unsupported exact keys, missing protected storage, unreviewed authority root, invalid group nonce/replay state or absent live directory. Pre-security Wave 4 UI must remain view-only/unavailable.

## Tests in order; block upon a failed gate

| ID | Procedure | Expected evidence / pass criterion |
|---|---|---|
| P0 | On both phones record OS, firmware, source/build SHA, KeyInfo security level per key, algorithm probe and provider restart | Real Ed25519/X25519 raw 32-byte keys, valid signatures/agreements, stable opaque handles, no unverified StrongBox claim |
| P1 | Re-run baseline connectivity A↔Heltec and B↔LilyGo, Australia Narrow #4 | Bidirectional ordinary channel messages, one visible receipt per message, encrypted history persistent, no provider teardown |
| P2 | Before authenticated trust or membership, attempt discovery/cross-phone actions | Both UIs show **no authorized convoy membership**, no verified remote position or send-enabled Drive quick action from PSK/contact alone |
| P3 | Perform genuine pairing and out-of-band fingerprint confirmation; create authenticated direct session | Both real identities, current epochs, trust records and replay-protected sessions match signed transcripts and canonical AAD; reboot preserves exact trust |
| P4 | A creates new convoy with an independently verifiable signed owner genesis/role chain; B requests join through a protected direct session | Request identifies real B device/fingerprint, A owner, group/convoy and nonce; no membership on B or UI until approved and installed |
| P5 | A explicitly approves with active owner/admin role; Security v2 prepares and commits one atomic new roster/key epoch | Durable epoch strictly increases, digest binds complete roster and B; A keeps access, B cannot read earlier epoch |
| P6 | A sends signed, peer-specific new epoch distribution; B verifies and installs, then signs post-install ACK | Group, identities, transaction, digest, epoch, wrapped ciphertext and direct-session AAD verified; local commit distinguished from B installed/ACK |
| P7 | After B authenticated installation, check both live verified directories and refresh/restart both phones | Membership appears only when independently revalidated on each phone, with correct roster/roles, no public-contact promotion |
| P8 | Start GPS by explicit manual controls on both phones; exchange protected position updates | Remote map shows only real roster authorized member and correct source/embedded node ID, group/epoch, freshness and carrier binding; no fabricated location |
| P9 | Turn off cellular/Wi-Fi, force-close/restart one then both apps, keep LoRa as specified | Revalidate unchanged identities, group epoch/nonce high-water, local MBTiles imagery, radio history, no replay or stale UI permissions |
| P10 | Simulate B disconnect and delayed delivery, then reconnect; repeat/duplicate frame and ACK | Pending remains pending until authenticated install; idempotent transaction/ACK, no duplicate member, no falsely global convergence |
| P11 | A revokes B, advances epoch and sends updated authorized epoch; partition B then reconnect | B never receives current key or authenticated remote location after revoke; old captured ciphertext rejected; stale B UI invalidated |
| P12 | Force-stop after prepare, during commit/recipient install/ACK where deterministic fault injection allows, then restart | Old complete or new complete state, never partial roster/secret/high-water, no duplicated epoch or unauthorized UI success |
| P13 | Negative: forged owner/admin, swapped fingerprints, changed embedded position node ID, stale timestamp/epoch, wrong AAD/group, replayed invite/ACK | Fail closed without state mutation. Inject through a controlled test harness; don't transmit spoof frames into public traffic |
| P14 | Check Drive STOP/HELP/HAZARD/REGROUP while authorization absent/revoked, and when no authorized transmit capability exists | Local non-transmitting previews, no history send or automatic distress/position claim; any eventual authorized transmit needs separate reviewed acceptance |
| P15 | S22+ map regression: real Melbourne roads, six visible tiles if same viewport, VIEW PACK without CBD GPS, force-close in airplane mode | Real local image pixels after restart; no HTTP fallback; existing tile SHA/receipt preserved |
| P16 | Background Radio Stop → BLE Tools two-way → disconnect → reconnect Background Radio **three times** on A and B as supported | Exactly one native BLE owner per phone, clean stops, correct bidirectional channel messaging, no radio-history or GPS loss |
| P17 | Check all five tabs, Device GPS diagnostics and safe export | Navigation loops absent; GPS remains manually controlled; diagnostics export excludes precise coordinates by default |
| P18 | Repeat relevant tests after security identity rotation/trust revocation, wrong-signer and missing native key | Revoked/stale sessions and send rights invalidated; trust recovered only through signed approved rotation/re-pairing |

The two-phone rig covers owner + first admitted peer, not fully multi-party convergence, admin delegation and removal in a group of 3+ real active devices. That additional proof needs either a third physical phone/radio or an explicitly qualified hardware emulator plus **separate** seeded multi-node partition/chaos simulation; do not claim 3+ real-device membership from two phones.

## Simulator and transactional fault-injection matrix

Run baseline deterministic simulator and, once delivered, new security tests with fixed seeds for packet loss, duplication, delay/reorder, partitions, asymmetric radio links, carrier disconnect/rejoin, congestion, replay/nonce collision, group leader loss, stale member rejoin, simultaneous approvals, crash before/after CAS and ACK, identity swap, forged embedded node and stale GPS. Assert state convergence only after authenticated recipient installs and required acknowledgements. Record seeds and exact source commit. Simulator tests cannot establish hardware-backed keys or physical RF range.

## Report requirements / exit decision

Per ID record PASS / FAIL / BLOCKED / NOT RUN, exact build and feature source commit SHAs, timestamps, phones/Android API, radio firmware/channel confirmation (not PSK), test seed, public fingerprints only when safe to share, encrypted transaction/ACK type and sanitized logs, screenshots, real map ID/hash and physical owner-handoff results. Separate **local commit**, **delivered**, **installed**, **acknowledged** and **converged** states. Do not record plaintext group secrets, raw private keys, exact trip coordinates or personal chat content.

**Acceptance cannot start until production Android Security v1 provider, formally approved Security v2 transaction protocol, genuine live directory and native tests all pass.** A passing Wave 4 CI run alone is never production readiness, cryptographic sign-off or physical hardware validation.
