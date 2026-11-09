# BushMesh Wave 1 staging — integration and acceptance

This staging branch starts **exactly** at radio baseline
`75f1ff50380ea4d32a4659c512f2cc52291ca08d`. It is never merged into
`main` or used to rewrite `integration/bushmesh-v1` by this task.

## Source merge heads

- Device & Settings: `b76f5752a6eb56809d2c93a2c267234e6bca2b07`
- Offline Convoy Map: `59e361718d89e7533ffc2fbbf657146948897860`
- App Shell: `f1b114c29ac98e91ee00a198d1f2587c0c153536`

All three descend from `e8ab74b522ca288ac017d9fb9d20636395e24fc8`.
Each was merged using an explicit two-parent Git commit. Device and Map had
no file-level overlap with current radio integration. On staging, Map required
a JSX heading-style parser correction, one hook-dependency lint fix and one
unused-import fix. Shell's `App.tsx` conflict was **manually reconciled**.

## App and radio lifetime

The five tabs are Drive, Radio, Convoy, Contacts, Device. Drive exposes Map
and legacy Drive tools, while GPS and offline pack preferences remain
reachable through Device.

The shell's `App.tsx` maintains the existing `AppProviders` **outside** the
tab-specific shell. `AppProviders` is unchanged, and retains its application
lifetime `NativeChannelMessageBridge`, encrypted Radio History owner,
`RadioConnectionProvider`, native Android Background Radio lifecycle, and
other services. Changing tabs does not remount BLE or lose the receive inbox.

Do not change the radio integration's native ownership, MeshCore command
queue, channel `0x03` / `PACKET_OK 0x00` acceptance, `0x83` live notification
drain with `CMD_SYNC_NEXT_MESSAGE`, standard `0x08`/V3 `0x11` decoding,
encrypted inbound history/deduplication, or direct-message delivery semantics.
Recovered carrier credentials are still **read from an already configured
MeshCore slot**, with a sensitive explicit reveal. Radio -> Carrier Details
now routes to Convoy tools regardless of ephemeral Create/Join state.

## Explicit capability boundaries

- **Membership is not inferred from radio possession.** The active-convoy
  directory has no authenticated Security v1-backed source in this staging
  task. It deliberately presents no authorised memberships until a real
  integrated provider is supplied. A public contact, channel name, MeshCore
  carrier PSK, invite or legacy radio-received position is *not* a valid
  convoy membership proof. The Drive map receives the validated active
  convoy ID but an **empty authorised-member position array** until such a
  source is verified. The map can still show local/self GPS; this is not an
  authorised multi-vehicle roster.
- **Offline map tile rendering is not yet available.** Native map-pack code
  downloads and verifies PMTiles/MBTiles archives, but does not decode tiles.
  The optional contract is `NativeModules.BushMeshOfflineTiles.readTileBase64`
  in `src/maps/nativeOfflineTileSource.ts`. It must enforce local verified
  pack access, format/version, bounded decompression and validated tile
  coordinates, and return a local image. Until implemented and field tested,
  the map shows a position plot and explicitly reports missing tile reader;
  a downloaded archive alone never means a rendered offline basemap.
- **Region profiles require conscious application.** Device suggestions
  are versioned; a profile selection alone never writes frequency, BW,
  SF/CR or TX power. Only the established MeshCore write/readback API may
  apply a complete profile after explicit preview and verification. Presets
  are not regulatory authorisation or an automatic GPS-derived RF choice.
- **Active convoy selection restore** requires the optional native
  `BushMeshActiveConvoyStore`, not yet supplied. With no authenticated
  directory or native selection store, the default is no active convoy and
  navigation selection is session-only.
- **Physical RF behavior is not CI-verified.** A clean Gradle/Jest result
  cannot substitute for Heltec/LilyGo/Galaxy S22+ tests.

## Physical validation before promoting to the tested integration branch

1. Install the staging APK on Galaxy S22+, preserving the existing app data
   and private configured carrier. Verify Background Radio remains ACTIVE and
   no parallel JS-GATT owner opens.
2. Verify both radios retain their *already configured* Australia (Narrow)
   frequency, BW, SF, CR, channel name and private PSK. Do not reconfigure
   those values as a troubleshooting shortcut.
3. On existing private channel #4, BushMesh sends an A->B channel message.
   BushMesh says RADIO ACCEPTED on `PACKET_OK (0x00)`; separately confirm
   actual LilyGo receipt.
4. Without BLE reconnect, send B->A from LilyGo. Confirm 0x83 notification,
   serialized `0x0A` reads, standard/V3 receive and *one* visible inbound
   entry on channel #4 in BushMesh Radio History. Repeat with several
   consecutive sends, tab switching, app backgrounding and restart.
5. After app restart, Radio -> Carrier Details -> Convoy tools ->
   REVEAL CARRIER PSK still reads the original private channel explicitly,
   without creating/joining a new convoy or changing the secret.
6. Navigate all five tabs. Verify Map under Drive, GPS and regional settings
   under Device, working contact and radio history screens and the legacy
   driver view.
7. Test Device presets with non-writing preview, verified readback and
   encrypted preferences persistence. Confirm region selection does not
   silently alter the already working hardware profile.
8. Confirm no public radio device or carrier-only member appears as an
   authorised convoy member. Drive's map can show self position but should
   not falsely invent member positions.
9. Test map pack download/verification and recovery. Confirm the map
   honestly labels the absent native reader, and never pretends to display
   an unavailable basemap.
10. Check BLE reconnect, interrupted radio command, queue replay and
    radio history deduplication while switching tabs.

Only promote after those tests, separately from this staging merge. A
successful software build alone is **not** physical acceptance.
