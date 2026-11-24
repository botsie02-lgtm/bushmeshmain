# Wave 5 integration and physical acceptance — staging only

Base: 37ded9fa36de2a14970b522a4e9fd1e677534dc2. Protected user-reported Wave 3 baseline: ca3388e54deafbe5e6bc854c1a145873a1508d01.

## Source ledger
All eight listed worker runs succeeded on their exact source commits. Six operational sources are descendants of the exact Wave 4 base and are recorded as two-parent merges. Security v2 native transactions (43d279dc0ae7f9a06c8f866244ee9dcf58069511; run 45302643141) and W1 research (5396f4a4a2b1485614f2a4218cbad361f223d322; run 45301294465) diverge from Wave 3 and remain **excluded** from operational staging. Neither hardware rollback resistance nor a production provider is established.

| Source | Worker CI | Integration merge |
|---|---|---|
| Radio 2a8dde135526cf630ec8c49d421909aae971310a | 45300459663 | b201bd6af96233d35826340f46c2b35f87c7355d |
| GPS 98cb43f6416b4ec87155eca46e5ace43826bc9b6 | 45301708362 | a62631c7b58a3f5a41f75005aef8f93d06d8202f |
| Maps f6e17b28b2719b75c3d035d4d49d04976f75dd5c | 45301710849 | 3c97eb35e8eb38aa096026cf8e9ab6b3d5c0060d |
| Field location 78463faacf586c0c33eecb171a30fa1c21e07322 | 45301616532 | f8d4c48c704cea1c780e1c419a084978914b2d17 |
| Field UI f5acfaad6722cc74fd751d4fc959cf2a05448d1e | 45302503288 | c8e2cfd45645db808657caf76e7e1f4e1d85450d |
| Simulator 3974a0782b642c03d8ca3f3f05fd793bc061a345 | 45301530868 | 64bbb0d29add401fb2fc7faaf62bc6d779f0726f |

MapScreen was the only overlapping operational file. Preserve map trail/route projections, separate radio diagnostic layer, UI navigation and confirmation before map clear. No native map reader/storage/PSK schema changes. The separate channel-only UI is mounted only under Drive > Map. It starts OFF; explicit current private-channel consent and label required; Android GPS must already be started. Scope checks bind the current radio address/owner and channel slot/name (redacted channel metadata cannot prove an out-of-band same-slot rekey). Background or screen departure stops the session; no automatic reconnection restart. Local cadence/airtime estimates are session-scoped, not regulatory certification. Coordinate text may remain in ordinary encrypted Radio History. This does not grant membership, authorize routing, or certify sender identity. The verified production runtime remains unmounted.

## Real device sequence — ALL NOT RUN
1. Record exact APK source commit, SHA-256, debug-key signature compatibility, Android model/API/firmware and both radio firmware versions. Never uninstall, clear, migrate or reset com.bushmeshmain; stop if signature mismatch. Preserve existing installation, private channel #4, Australia (Narrow), encrypted history, tracks and Melbourne map catalog.
2. Two phones, one Heltec and one LilyGo, stationary/safe location. Confirm both use existing compatible private channel and AU configuration without revealing keys. Send unique text A→B and B→A; inspect actual peer receipt, not just PACKET_OK.
3. Stop native Background Radio and recover via BLE Tools; repeat three cycles, switch radio target, Bluetooth off/on, radio power cycle; verify one app-owned BLE session and no stale responses. Record recovery and queue disposition.
4. Manually start real Android GPS on each. Confirm fresh fix, native measured callback counts and stale/error/speed/course behavior; stop or obstruct GPS; recover. No auto GPS start or field sharing. Confirm track/GPX and retained distance after restart.
5. Drive > Map: default sharing OFF and no verified remote roster. Only after reading privacy warning, enter different labels, consent and start on both phones. Enable RADIO DIAG deliberately. Confirm actual incoming structured text and unverified map markers, expiry, no fabricated authenticated membership. Stop sharing, switch screen/channel/radio, background, reconnect; verify no new sends without fresh consent. Already-submitted commands cannot be recalled.
6. In airplane mode with Wi-Fi/mobile data off (Bluetooth manually enabled only when needed for radio tests), use VIEW PACK on the independently imported genuine Melbourne raster. Pan/zoom, RETRY TILES if needed, verify offline pixels, attribution and persisted trails, then force-stop/relaunch; no online fallback.
7. Inspect encrypted Radio History after restart; compare ordinary messages and existing settings. Do not clear map or history. Verify STOP/HELP/HAZARD/REGROUP remain non-transmitting without authorization; Convoy enrolment unavailable and verified map members empty. No W1 or Security v2 runtime.
8. Record PASS/FAIL/NOT RUN per step, actual time, device/radio build, redacted observations, and screenshots without secrets or unnecessary precise location. Any unintended broadcast, BLE dual ownership, data loss, false membership, or inability to recover is a stop-test condition.

Worker plans remain in docs/WAVE5_*; automated regression and Node benchmark outcomes are not real RF/GPS/rendering/power tests. Staging APK is debug-key signed, not production-certified. Do not claim physical Wave 5 acceptance until operator reports observed results.

## Staging privacy hardening

The inherited LocationSessionProvider previously queued raw legacy position frames after GPS acquisition if a raw link was ready and could answer unauthenticated legacy position requests. Both disclosure paths are explicitly disabled in this staging branch, even with a ready raw link. Local GPS fix, tracks, GPX, native measurements, ordinary channel messages, and the pure legacy planner contracts are preserved. Only explicit channel field-test consent may submit new position text. No migration or reset was performed. A future approved authenticated runtime must replace, not merely enable, the legacy gate.
