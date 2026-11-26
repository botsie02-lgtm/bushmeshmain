# Radio redesign integration v1

## Source lock
- Base: 261a12ce05f8ab7c70ae6c37cba03d32cf2c1361
- Messenger: 93461551cf4879f2cd453a102276ccc9335421d6 (CI 45722944650 passed)
- Management: 75c1cc89b65541d94489f79a65488ece605790d6 (CI 45722151094 passed)
- Settings: 30bb176c4f52ae20b8b7ccb9d4dc47857d3ee029 (CI 45721024423 passed; separate screenshot run 45721024533 failed)
- Exact source merge: 1d433670da151a9023eb57c3de194e70c16b7711

## Integration contracts
RadioScreen mounts a single chat management controller from AppShell. The inbox and room share the protected configuration identity for local preferences only. An ephemeral observed generation binds live UI rooms; reconnect or a changed configuration invalidates the send binding. Firmware readback and send use the existing guarded radio service, not another BLE owner. A rejected preflight leaves the draft untouched and does not claim a radio submission. Ambiguous post-submission failures require manual acknowledgement, never automatic retry. The messaging settings screen retains existing service providers and keeps the Radio subtree mounted.

Inbound session previews and unread counts require an actual application inbox observation with the current verified radio session, not merely a late history row. They are not authenticated sender evidence or durable ownership proof. The firmware queue may contain older packets and does not expose a channel-key generation. History across process restart, radio replacement and unverifiable configuration changes remains separately readable, not attributed by slot. Identical restored configurations and changes made externally without a detectable readback remain limitations. Per-chat mute, history export/deletion and authenticated administration are not available. Manual unread/preferences are encrypted; automatic counts are session-only. Security v2 and W1 remain disabled.

## Installation and provenance
CI builds the normal debug APK and runs native JVM tests, then builds a debug-signed release variant with `-PradioRedesignFieldTest`. It must have application ID `com.bushmeshmain.radioredesign`, label BushMesh Radio Test, and embedded `assets/index.android.bundle`. CI checks package metadata, signing, SHA-256 and exact source ancestry. Use only that artifact after combined CI passes. The existing `com.bushmeshmain` install is not overwritten or uninstalled. Separate Android application data/Keystore means no automatic transfer of radio pairing, encrypted history, preferences or offline maps. Configure the test app separately, import the trusted map archive, and stop Background Radio in the original app before connecting the test app. Do not use both apps concurrently with one companion. Debug signing is for field testing only; not a production release.

Build from an exact checkout with Node 22.13.0/JDK 17 and the repository's Android toolchain:
```sh
npm ci
npm test -- --runInBand
npx tsc --noEmit
npm run lint
cd android
./gradlew assembleDebug :app:testDebugUnitTest --no-daemon
./gradlew :app:assembleRelease -PradioRedesignFieldTest --no-daemon
```

## Physical acceptance — not yet performed
- Install alongside existing BushMesh; verify both package IDs and original app data intact. Stop original background radio before test connection. Disable test app location sharing unless explicitly testing it.
- Launch offline without Metro; verify all five tabs, no duplicated Radio header, usable inbox and global settings.
- Pair Heltec then LilyGo separately, verify native BLE ownership and original radio settings unchanged. Review channel capacity and public/private entries.
- Open each chat, send unique text to two different channels and verify on a second radio. Confirm active convoy carrier and location-sharing configuration do not change.
- Receive genuine messages, check preview, timestamps, read/unread; replay duplicate and inspect no duplicate visible message. Background queued or legacy unscoped records must not appear as proven history.
- Verify independent drafts, settings navigation/back, keyboard and composer, accepted vs confirmed vs uncertain status; disconnect during submit and verify no automatic retry.
- Create and join on two radios; malformed invitation, duplicate key/name, full slots, and firmware readback failure must not overwrite existing configuration. Verify avatar, description, nickname, pin, archive and manual unread.
- Confirm sharing warning, cancelled leave has no mutation, confirmed leave clears selected slot only, history retained. Verify local creator is not authenticated administrator.
- Replace key while keeping name/slot; refresh and verify no inherited settings/history; try sending through stale room and confirm no submission. Disconnect/reconnect and change radios, inspect quarantine and read-only access.
- Verify global speech, PTT, Android Auto, notification permissions, diagnostics, location privacy, GPS fix, offline Melbourne map, Drive/Convoy/Contacts/Device. Verify Security v2/W1 gates remain off.
- Test outdoor readability, large text and accessibility. Record device/firmware versions, exact APK checksum and evidence. CI alone is not physical acceptance.
