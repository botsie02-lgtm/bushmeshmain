# Wave 2 physical field report — user-reported acceptance

**Recorded:** 2026-11-09 (date this report was received; exact field-test timestamp not supplied)  
**Repository:** botsie02-lgtm/bushmeshmain  
**Tested commit / protected rollback anchor:** `9956ef244881c79a64e582a08136eceb0a90dce5`  
**Hardware reported:** physical Samsung Galaxy S22+, Heltec A, LilyGo B  
**Scope:** Wave 2 staging physical checks reported by the tester, not independently executed by CI or this coordinator.

| # | Physical check | Reported result |
|---|---|---|
| 1 | Five-tab navigation | PASS |
| 2 | Drive dashboard | PASS |
| 3 | GPS preferences and manual GPS operation | PASS |
| 4 | Android-native Background Radio outgoing message received by LilyGo B | PASS |
| 5 | Background Radio incoming messages and Radio History | PASS |
| 6 | Background Radio Stop; BLE Tools ownership handoff; three repeated cycles | PASS |
| 7 | Unauthorised Drive quick actions remain non-transmitting | PASS |
| 8 | Actual offline basemap rendering | **BLOCKED**, not failed or passed: trusted raster map-pack provisioning was unavailable |

**Reported outcome:** Seven completed checks passed, with **no reported hardware failures**. Offline basemap rendering was **not tested**; the Wave 2 software build and native reader fixture results do not prove that actual map pixels render offline.

## Protection and carry-forward

- Keep this exact SHA available as the physical rollback baseline. Wave 3 must begin from it without rewriting Wave 2 staging history.
- Do not clear application data or regenerate channel credentials during Wave 3 field testing.
- Preserve Heltec A / LilyGo B carrier interoperability, existing private channel #4 and its PSK, MeshCore Australia (Narrow), BLE ownership exclusivity, native outgoing GATT and `PACKET_OK (0x00)`, inbound `0x83` handling, encrypted Radio History, and shutdown/reconnect cleanup.
- Passing these seven checks does **not** authorize authenticated convoy membership, verified remote positions, admin grants, or real Drive quick actions.
- Wave 3 hardware validation is a **new** requirement. The Wave 2 result must not be silently promoted into a Wave 3 pass.

See `docs/WAVE3_ANDROID_RASTER_ACCEPTANCE.md` for the previously blocked map test, and `docs/WAVE3_INTEGRATION_PLAN.md` for merge gates.
