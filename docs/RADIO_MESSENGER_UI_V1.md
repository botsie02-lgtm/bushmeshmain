# BushMesh Radio Messenger UI v1 — staging handoff

Repository: botsie02-lgtm/bushmeshmain
Feature branch: feature/radio-messenger-ui-v1
Exact source base: 261a12ce05f8ab7c70ae6c37cba03d32cf2c1361

## Ownership

New production React Native UI lives in src/screens/RadioScreen.tsx
and src/screens/radioMessenger/. Tests live under __tests__/ with an
isolated feature CI workflow. No changes to AppShell, global speech/PTT,
background radio ownership, native MeshCore, GPS, Security, Protocol,
map engine, provisioners, encrypted persistence or integration/main.

The UI consumes useBushMesh, useRadioConnection, useRadioSession, and
useViewedConversation. It does not implement a new messaging backend.

## User experience

- A compact Chats inbox with status dot, searchable channel cards, avatars,
  genuine message preview and time, per-row three-dot menus, optional
  authoritative unread counts, activity sorting and session-local pins.
- Dedicated chat rooms with back button, settings/menu, left and right
  message bubbles, date separators, actual recorded timestamps, generic
  incoming sender labels, inverted virtualized FlatList, and a fixed
  keyboard-safe composer. No PTT in the composer.
- Per-conversation unsent drafts are held independently in mounted UI state.
  No plaintext draft is written to unprotected persistence.
- Exact 133 UTF-8 byte payload validation, including multi-byte emoji.
- Existing MeshCore sendChannelMessage and addLocalChannelMessage remain
  the only outbound commands/storage path. A resolved send is radio-accepted,
  NOT peer-delivered; genuine matching ACK is still required for confirmation.
- Timeout, disconnect, BLE write failure and unknown acceptance prohibit an
  automatic retry. The user must explicitly acknowledge duplicate-send risk
  before manual re-submission.
- Native inbound/outbound diagnostic counters remain available behind a
  deliberate settings/technical drawer, not a large permanent banner.

## Critical legacy history provenance limitation

BushMeshMessageSnapshotV1 persists channelIndex and channelName, but no
durable radio device ID or channel-configuration incarnation. A slot reused
by a different radio/channel cannot be correlated safely.

Accordingly:
1. Snapshot messages already present when RadioScreen mounts or restores
   are quarantined unless individually provided with trusted provenance.
2. The separate read-only Unattributed history screen still shows every
   ambiguous encrypted historical record, recorded slot/name, local time,
   direction, text and delivery state, without merging them into a chat.
   No history data is destroyed or re-keyed by this screen.
3. New messages observed in this mounted UI session, while the connected
   radio address and enumerated channel match, receive a short-lived
   session observation scope. These observations are explicitly not durable
   security/ownership evidence. They do not automatically restore to chats
   on process restart or carry over to a different radio/channel generation.
4. A radio address change, disconnect/reconnect or channel enumeration
   replacement creates a new ephemeral generation. Previous scopes never
   silently reattach to a reused slot.
5. A production history worker may supply trustedScopes, containing
   radioId, channelGeneration, channelIndex and channelName, with an
   independent per-message verifiedMessageOwnership map of the same fields.
   The worker MUST persist those identifiers at ingestion; reconstructing
   them from a present slot/name, contacts or PSK is forbidden.
6. Distinct radio/config generations occupying the same slot are rendered
   as distinct conversations, not blended.
7. The current BushMeshChannelMessage has no trustworthy sender field.
   The UI labels incoming senders unavailable, not a fake peer identity.

Unread badges are only shown for externally supplied authoritative
unreadCounts keyed by conversationKey(scope). onConversationRead only fires
when such a provider reports actual unread messages. No local guesswork,
fake presence, group roster or delivery receipt.

## Exact external integration props

    <RadioScreen
      onOpenCarrierDetails={openExistingCarrierSetup}
      onCreateChat={openExistingCreateChannel}
      onJoinChat={openExistingJoinChannel}
      onOpenChatSettings={scope => showChannelSettings(scope)}
      onOpenConversationMenu={scope => notifyRowMenuOpened(scope)}
      onOpenMessagingSettings={openRadioPreferences}
      trustedScopes={verifiedScopedChannelDirectory}
      verifiedMessageOwnership={authoritativeMessageProvenance}
      unreadCounts={authoritativeUnreadCounts}
      onConversationRead={(scope, messageId) => markProvenMessageRead(scope, messageId)}
    />

All identifiers above are STAGING PLACEHOLDERS, not globals or active
providers in this feature branch. Callbacks are optional. Create/join
default to the existing onOpenCarrierDetails, if supplied. The UI never
calls createPrivateChannel or joinPrivateChannel itself.

ViewedConversationContext contains only the navigation reference
{kind:'meshcore-channel',channelIndex}. The messenger captures the current
session scope separately. Immediately before send, it checks connected
radio address, enumeration slot/name, channel generation, existing handler
and 133 UTF-8 byte limit, then calls sendChannelMessage(index,text).
It never invokes setActiveChannelIndex or changes ActiveOperationalConvoy,
so opening a room does not silently redirect background location sharing.

## AppShell worker handoff: currently unavoidable chrome

AppShell presently mounts its own two-line carrier status notice,
SecureDataStatusBanner, CarMessagingStatusBanner, RadioSpeechStatusBanner,
and global SpeechPttPanel ABOVE RadioScreen. This feature owns neither
AppShell nor global speech controls and therefore DOES NOT remove them.

To give Radio the intended full-screen messenger viewport, the AppShell
worker must collapse/move those legacy banners and global speech controls
to a reachable details/Device destination and mount the new RadioScreen
as the flex:1 content below the five-tab shell. Preserve services, radio
ownership and functionality; do not remove them. The messenger itself
already has no large permanent diagnostics or PTT composer.

Until that owning worker changes the mount, those top-level banners will
still occupy room above the new inbox. Do not claim otherwise.

## Full validation

Branch CI runs npm ci, all Jest tests, tsc --noEmit, npm run lint,
network simulator TypeScript compile, map Python fixture tests,
Android assembleDebug and native :app:testDebugUnitTest, with a downloadable
debug APK and SHA256SUMS as GitHub Actions artifacts. No adb install or
device deployment is performed. The original Galaxy S22+ is untouched.

Additional manual validation belongs on a SEPARATE test installation:
- Small display and large text, real Android keyboard, 48dp+ chat controls.
- Live radio disconnected/reconnected; background carrier stays unchanged.
- Two channels, separate drafts, search/pins/menus and correct send slot.
- 133 vs 134 ASCII bytes, 33 vs 34 four-byte emoji, one-byte over-limit.
- New inbound radio packets, early restoration and unread provider injection.
- Native PACKET_OK vs true peer ACK and uncertain acceptance without retry.
- Different radio or reused channel slot never inherits unscoped messages.
- Old encrypted history remains readable only in its quarantined review.
- Accessibility and outdoor visibility checks using real device screenshots.

Screenshots: GitHub CI has no Android emulator screenshot capture here.
An APK build is not a screenshot or proof of a physical UI field test.
