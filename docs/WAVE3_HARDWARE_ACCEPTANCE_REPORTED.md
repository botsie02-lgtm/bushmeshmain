# Wave 3 physical acceptance — owner-reported hardware evidence

**Report recorded:** 10 November 2026 (Australia/Melbourne)  
**Exact tested code reference / protected Wave 4 rollback:** `ca3388e54deafbe5e6bc854c1a145873a1508d01`  
**Repository:** `botsie02-lgtm/bushmeshmain`  
**Test device:** Samsung Galaxy S22+  
**Radio hardware:** Heltec A and LilyGo B  
**Environment:** Australia (Narrow) MeshCore profile, the pre-existing private channel #4, unchanged PSK  
**Evidence class:** **USER-REPORTED PHYSICAL TESTS**, not independently observed, instrumented or performed by GitHub Actions/CI. This record does not invent test timestamps, firmware revisions, Android build IDs, logs or independent measurements.

## Reported PASS checks

| Area | User-reported result | Scope of observed acceptance |
|---|---|---|
| Genuine Melbourne map import | PASS | Real OSM MBTiles selected through Android import; expected SHA-256 verification |
| Geographic raster imagery | PASS | Actual Melbourne road graphics rendered, not a synthetic region or manifest-only catalog |
| Visible map tile decode | PASS | All **six visible** map tiles loaded on the S22+ |
| Map camera | PASS | VIEW PACK worked to show installed Melbourne coverage |
| No external network | PASS | Airplane mode with Wi-Fi and mobile data disabled |
| Process restart | PASS | Real local map still rendered after force-close and restart while offline |
| Background Radio | PASS | Galaxy S22+ connected to Heltec A |
| LoRa messaging | PASS | Bidirectional Heltec/LilyGo private-channel traffic |
| Message history | PASS | Encrypted Radio History persisted |
| Radio cleanup | PASS | Background Radio stopped cleanly |
| BLE Tools | PASS | Independent two-way BLE Tools connection |
| Native BLE ownership | PASS | Three complete Background Radio Stop → BLE Tools → disconnect → Background Radio handoff cycles |
| Drive | PASS | Navigation worked across tested routes |
| GPS diagnostics | PASS | New diagnostic presentation worked |

**Reported failures:** None in the checks above. The report does not assert unperformed stress, compatibility or security tests.

## Distinctions that must survive Wave 4

- Physical pixels in offline mode now qualify the **Wave 3 Melbourne road-raster acceptance** previously marked blocked in the Wave 3 pre-test checklist. The earlier `docs/WAVE3_UNIFIED_HARDWARE_ACCEPTANCE.md` was a *pretest plan*; this dated report is later reported evidence. Do not silently edit historical CI or pre-test claims.
- The sample raster is an actual OSM roads pack; this does **not** establish terrain, hillshade, complete national coverage, every zoom or every pack format.
- Channel #4 communication is **not** a Security v1/v2 verified convoy membership, identity proof, authenticated location, signed owner/admin authorization or epoch-key install. No production-authenticated convoy join was reported.
- The existing live `ActiveOperationalConvoyProvider` defaults to `unavailableConvoyDirectory`. Security v3 incremental joining remains disabled; Drive quick actions remain local non-transmitting previews when authorization is absent.
- Protect installed radio profile, private PSK, encrypted history, verified map catalog and GPS preferences. No uninstall, data wipe or PSK rotation as part of the Wave 4 integration preflight.
- **Rollback:** preserve this exact SHA and do not modify the Wave 3, Wave 2, Wave 1, legacy integration or main branch tips.

## Evidence to collect when repeating the acceptance

Record APK commit SHA, app build variant, Android version, phone/radio firmware, pack identifier and SHA-256, selected zoom/region, on-device screen capture showing six decoded geographic tiles, airplane mode controls, force-close/restart, bidirectional message receipts, encrypted-history restore, clean Stop and each of three ownership cycles. Redact channel PSK, exact personal GPS coordinates, device-private identifiers and message content. This evidence is **not supplied in this report**.

**Wave 3 status: user-reported physical acceptance PASSED for the listed cases.**  
**Wave 4 status: NOT hardware tested, NOT production authenticated and NOT production ready.**
