# Radio Messaging Settings v1

Base: `261a12ce05f8ab7c70ae6c37cba03d32cf2c1361`.

## UI and integration contract

- The Radio tab's shell replaces the shared brand/convoy header and permanent
  two-line carrier notice, Android Auto banner, radio speech banner, PTT panel
  and healthy history banner with a compact 52 dp minimum-height Radio header.
  The Settings target is at least 48 dp high. History recovery/storage warnings
  remain visible in the compact header when necessary.
- Settings is a Radio subdestination, not a sixth tab. The header Back action
  and Android hardware Back close settings only. Other tabs retain their
  existing layout and navigation. Leaving Radio unmounts both settings and
  messenger; returning to Radio opens the messenger, not settings.
- Within the Radio tab the messenger stays mounted but is hidden from touch,
  layout and accessibility while settings is open, preserving drafts and
  future chat-room state. The settings screen itself unmounts on Back; the
  existing PTT cleanup cancels active local recognition.
- The messenger and chat-management workers can use
  `useRadioMessagingNavigation()` from
  `src/app/shell/RadioMessagingNavigation.ts` to call
  `openMessagingSettings()` or `closeMessagingSettings()`. The shell supplies
  the context inside the Radio tab. No carrier, membership, or viewed
  conversation selection is changed by these callbacks.
- The supplied base still has the legacy carrier-oriented `RadioScreen`.
  This branch intentionally does not change it; the dedicated inbox/room
  worker owns that replacement. Its existing carrier-specific warning and
  detailed diagnostics remain intact until integration.

## Safety and runtime

AppProviders, RadioConnectionProvider, RadioSessionProvider, CarMessagingProvider,
SpeechProvider, native inbox and speech bridges are unchanged. Relocating controls
does not enable a microphone, toggle a speech preference, change BLE ownership,
grant notifications, or alter background location. The system notification
settings link opens OS app settings only on a user tap.

The existing auto-read control remains global local speech, separate from
conversation mute and critical alerts. Replay is explicit and can be audible
to people nearby. The PTT panel remains in settings, including its existing
hold/review/explicit-submit workflow; no chat composer microphone was added.
Metadata-only runtime diagnostics distinguish GATT callbacks and matched
responses from delivery, and do not display secrets or message payloads.

## Verification and real screen capture

Automated navigation tests assert the old banner stack is absent from Radio,
its controls exist once in settings, Back preserves the mounted messenger,
leaving Radio unmounts the settings controls, and metadata diagnostics update.

Real screenshots are not available from a JS test renderer. To capture the
before/after on the same S22+ or emulator, use identical font scaling, resolution,
display density, notification/speech support and connection/history state:

1. Build/install the exact base commit, open Radio, dismiss the keyboard, and
   capture `adb shell screencap -p /sdcard/radio-before.png` followed by
   `adb pull /sdcard/radio-before.png`.
2. Build/install this feature branch over the same installation (do not clear
   data), open Radio and capture `radio-after.png` the same way.
3. Open Settings and capture `radio-settings.png`; verify all relocated
   controls, then Back and confirm the draft and conversation are retained.
4. Compare the vertical pixel coordinate of the top of RadioScreen between
   the two screenshots at identical screen size and calculate the recovered
   viewport height. Do not claim a pixel gain until measured.
5. Check background radio, native incoming messages, car notifications and
   speech preferences before and after navigation. Use no live radio keys
   or sensitive text in shared screenshots.

This is a capture protocol, not a claim of a performed device/emulator test.
