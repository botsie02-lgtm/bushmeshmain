# Wave 5 — native radio reliability (isolated implementation)

This branch preserves MeshCore NUS framing, the existing radio/session boundary,
the encrypted native outbox, channel settings, and the Australian regional profile.
No channel credentials, persisted radio history, keys or security contracts are
migrated or reset.

## Reliability changes

- `MeshCoreNativeBleRuntime.connect` may reuse GATT only when the **same**
  normalized Bluetooth target owns an active session. Switching addresses
  invalidates old writes, response buffers and characteristics, closes the old
  GATT, then attempts a fresh connection. Late callbacks from the old GATT are
  ignored.
- A 20-second connection setup watchdog covers connect/MTU/service-discovery/
  notification-enablement stalls. A 10-second write-callback watchdog prevents
  a hung GATT write from blocking all following writes indefinitely. Both are
  cancelled on successful progress/teardown and restart through the existing
  bounded 1–30-second reconnect backoff.
- Duplicate/stale GATT write callbacks are ignored. GATT write confirmation
  denotes **local Android GATT completion only**; it does not prove that MeshCore
  processed the command, that the RF packet was transmitted, or that a recipient
  received it.
- When the background worker times out waiting for a MeshCore command response,
  it records retry state via the existing encrypted outbox, invalidates protocol
  context and forces a fresh GATT epoch. A delayed response can no longer be
  attributed to the next command on the same connection.
- Existing native outbox priorities, `maxAttempts`, expiration, encryption,
  generation lease (background vs foreground), and no-invented-delivery-receipts
  semantics remain unchanged. A timeout may have transmitted: retries are
  *at least once*, not guaranteed RF de-duplication.

## Scope and known limitations

- Native `BushMeshRadioService` retains the sole native GATT owner; JS BLE-PLX
  remains a distinct compatibility path and its explicit native handoff must
  release BLE-PLX ownership first. This patch prevents stale native GATT reuse,
  but it does **not** create an OS-wide exclusive lock against unrelated apps.
- `ready` means MeshCore UART service/notifications are configured, not proof of
  ongoing RF connectivity. No fabricated SNR/RSSI, acknowledgements or delivery
  outcomes have been added. Existing genuine packet-level diagnostics remain
  available through the neutral inbound seam.
- Local GATT write success and a MeshCore PACKET_OK are separate milestones;
  neither proves recipient delivery. Background outbox completion currently
  records radio acceptance and removes accepted entries. It does not persist a
  per-recipient acknowledgement ledger; implementing that would require the
  canonical protocol/security owners.
- Device-specific BLE stack quirks and real current draw require hardware
  measurement. Timer/watchdog work is event-driven and does not introduce a
  continuous polling loop. Regional settings and private channel #4 must not
  be overwritten during reliability tests.

## Physical Heltec / LilyGo regression checklist

Test with real compatible firmware and a second radio when available:

1. Record current Australia (Narrow) frequency/profile, channel #4 name,
   channel-key fingerprint (never export or print secret), firmware and battery.
2. Scan and connect to a Heltec; query identity, battery and channel metadata.
   Confirm local BLE connection and send/receive on existing private channel #4.
3. Switch to a LilyGo while Heltec is still powered. Verify no stale responses
   or writes reach the old radio; repeat switch back.
4. Disable Bluetooth during connect, MTU negotiation and NUS setup. Restore it;
   verify bounded watchdog/reconnect and no duplicate sessions.
5. Force a radio reboot while the app is foregrounded and then while Android
   owns background radio. Observe health, recovery and unambiguous queue status.
6. Queue messages while disconnected; observe backpressure, max retries,
   expiration and explicit failure without claiming peer delivery.
7. Repeatedly Stop/start native Background Radio, navigate Device/BLE Tools,
   and return foreground. Confirm only one app-owned native GATT and no duplicate
   notification processing.
8. Test delayed PACKET_OK, missing notification/response and duplicate frames;
   verify no false delivery/acknowledgement or protocol-epoch reuse.
9. Check encrypted Radio History, existing contacts, channels and credentials
   survive stop/start, service restart and app restart.
10. Confirm AU radio profile and private channel #4 remain unchanged; compare
    battery drain over identical idle/drive traces with and without radio loss.

These are **manual checks not yet claimed passed**. CI runs deterministic tests
and Android compilation only; it does not replace physical RF validation.
