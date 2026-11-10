# Wave 4 Galaxy S22+ regression checklist — independent of Wave 4 feature approval

**Baseline exact rollback:** `ca3388e54deafbe5e6bc854c1a145873a1508d01`  
**Evidence classification:** Wave 3 acceptance was **user-reported**, see `docs/WAVE3_HARDWARE_ACCEPTANCE_REPORTED.md`. **Wave 4 on-device acceptance NOT EXECUTED.**

Do not uninstall or wipe the working BushMesh app; do not clear encrypted history, map catalogs, private channel PSK or GPS preferences. Capture APK build SHA and variant before installing any Wave 4 staging APK over the existing application. The separate Android Security field-test package is a *different* application ID and must NEVER replace `com.bushmeshmain`.

| Gate | Real device procedure | Pass / evidence needed |
|---|---|---|
| R01 | Samsung S22+ current firmware/version; connect Background Radio to Heltec A | Existing Australia (Narrow) profile, private channel #4 and unchanged PSK; normal BLE connectivity |
| R02 | LilyGo B ↔ Heltec A both directions, ordinary private-channel messages | Actual bidirectional radio receipts; no new auto-telemetry frames |
| R03 | Force close/reopen app, inspect encrypted Radio History | Previously existing messages persist; no clear/reset |
| R04 | Stop Background Radio, connect BLE Tools both ways, disconnect, return Background Radio; repeat ×3 | No simultaneous native BLE owners; clean Stop and reconnection |
| R05 | Review true `melbourne-cbd-osm-roads-v1` manifest/sha and locally imported pack | SHA-256 `2801b85fff3eb42dca50179a6c729a523ae239258112cfe96f2ca7201689fb70`; real road pixels, six visible map tiles in same viewport |
| R06 | Use VIEW PACK with GPS unavailable/outside Melbourne | Camera moves to reviewed CBD bounds, offline tile imagery visible |
| R07 | Switch airplane mode ON, Wi-Fi/cellular OFF; force-close then restart | Genuine Melbourne road tiles still render without network; no HTTP fallback |
| R08 | Drive → ConvoyMap / map packs / GPS diagnostics / Radio / Convoy and back | Five existing top-level tabs unchanged, working navigation and existing Drive views |
| R09 | Device GPS preferences and diagnostic quality reset/export | Manual GPS owner unchanged; measured fix intervals vs request hints distinct, no coordinates in export by default |
| R10 | Convoy → View unavailable secure enrolment → return to selector/carrier tools | New preview visible, all real create/invite/join/approve/remove controls disabled, no carrier traffic or fabricated membership |
| R11 | Inspect ConvoyMap and Drive while no production authenticated directory exists | No verified remote member marker/roster/alerts or authorized STOP/HELP/HAZARD/REGROUP transmission |
| R12 | Inspect log/radio traffic after UI transitions and background service restart | No automatic `VerifiedConvoyTelemetry.publish()`, no new group packets, no unauthorized position sharing |
| R13 | Test any future Android production security build **only** under isolated app id `com.bushmeshmain.securityfieldtest` | Galaxy S22+ original `com.bushmeshmain` data and Keystore namespace untouched |
| R14 | Compare exact post-test app/radio state with Wave 3 owner-reported baseline | Record PASS/FAIL/NOT RUN and redacted evidence, restore only by explicit approved rollback |

No user-reported Wave 4 physical results are asserted here. A green GitHub Actions APK run is compiler/static validation, not BLE/LoRa or production security certification. For genuine join and location sharing, execute `docs/WAVE4_TWO_PHONE_TWO_RADIO_ACCEPTANCE.md` only after formally approved Security v2 and production Android identity.
