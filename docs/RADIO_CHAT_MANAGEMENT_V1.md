# Radio chat management — messenger integration (v2 preferences)

## Scope
This module manages real MeshCore shared channels. No Security v2 activation,
remote administration, verified membership, or new radio transport. No changes
to RadioScreen, AppShell, carrier selection or the Radio History store.

## Integration contract

Mount `useChatManagement()` once in the messenger owner. Pass its controller
to `ChatManagementDialog` and optionally `ChatInboxControls` from
`src/radio/chatManagement/`. Both inbox and room menus open the same dialog
with a full current configuration object, not only a slot.

```tsx
const management = useChatManagement();
const [selection, setSelection] = useState<ChatManagementSelection | null>(null);
// In the inbox: use selectChats(management.chats, management.preferences,
// query, showArchived, management.sort) or render ChatInboxControls.
// For both inbox and chat-room three-dot actions:
setSelection({kind: 'settings', chat: currentVerifiedConfiguration});
// For create/join (capture radio identity when opening):
if (management.radio) setSelection({kind: 'create', radio: management.radio});
// Dialog:
<ChatManagementDialog
  controller={management}
  selection={selection}
  onClose={() => setSelection(null)}
  onProvisioned={openVerifiedConversation}
  onLeft={closeMatchingConversation}
/>
```

- `refresh()`: explicit firmware read after startup sync; no channel writes.
  A successful refresh gives full configuration refs and restores protected
  preferences. Refresh when entering the messenger and after legacy Device
  channel edits, once `radioBusy` is false. It is not safe to invent refs from
  slot/name metadata. The inbox controls also expose manual refresh.
- `onProvisioned(chat)`: called only after firmware verification and preference
  reload. Use navigation-only ViewedConversationContext (kind meshcore-channel,
  channelIndex String(chat.slot)); retain the full chat.id alongside the viewed
  slot. Do not change active carrier as a side effect of opening a chat.
- `onLeft(chat)`: clear viewed conversation only if its full id matches.
- `update(chat, {unread: false})`: explicit local mark read, e.g. when opening a
  currently verified room. Mark unread manually via settings or when a future
  configuration-scoped ingress supplies an exact chat ID. Do not infer unread
  status from legacy slot-only history.
- `selectChats`: local name/alias search, archive filter, pinned-first sorting.
  `defaultChatPreferences` provides unknown/imported defaults; spread it
  when constructing preferences in callers rather than duplicating fields.
  `management.sort` / `changeSort('name' | 'unread' | 'slot')` stores an
  app-local inbox sort choice in the same encrypted snapshot. Pinned entries
  always precede other entries. `management.capacity` is nullable until
  refreshed. No message content search until history can establish provenance.
- `ChatSettingsPage` is the sectioned page body used by the full-screen
  `ChatManagementDialog`; it can also be mounted by the messenger in its own
  safe-area/scroll container. `ChatAvatar` and `ChatAvatarPicker` are reusable.
  Pass `name`, `avatarColor`, `avatarIcon` explicitly or use the default
  preferences for imported channels. Existing dialog callbacks are unchanged.
- `provision(radio, {name, secretHex?, personalisation?})` accepts optional
  `{description, avatarColor, avatarIcon}`. The secure preference commit
  follows firmware verification. The full-screen join UI validates an invitation,
  clears its displayed text, and requires a separate confirm press.
- An operation marked partial means a command might have succeeded. Re-read
  the current radio and inspect the slot before retrying. Duplicate name or
  duplicate private key on the same radio is deliberately refused. This
  conservative policy avoids ambiguous duplicate conversations.

## Persistence and provenance

Android's existing BushMeshPersistence AES-GCM encrypted storage has a dedicated
chat preferences slot, Keystore alias and AAD. A distinct Android Keystore
HMAC-SHA256 key derives a local opaque ID from radio BLE address, full MeshCore
public key, slot, channel name and actual 16-byte carrier credential. The PSK is
not in the preference snapshot or a regular UI model. No unprotected fallback.
This is a configuration reference, not cryptographic verification of the radio's
claimed public key or authenticated owner. Exact configuration restored
externally with identical key/name/slot cannot be distinguished from the
original instance; no claim of current network creator/administrator is made.

Only successful verified local create writes creator provenance. Joining
explicitly records origin "joined"; existing/imported channels default to
"unknown". Version 1 snapshots decode without writing or changing IDs. A
legacy true creator becomes "created"; legacy false cannot distinguish imported
from joined and becomes "unknown". New writes use schema v2 with bounded
description, six allowed avatar colours, six icon choices, and optional
global inbox sort. The AES/HMAC aliases and AAD are unchanged.
Missing aliases with an existing snapshot fail closed: no replacement key
or preference reset is generated. On a new installation, HMAC identity is
preflighted before a firmware write. Keystore protection is not a claim that
the radio itself authenticates ownership.
Preference writes are serialized, validated and committed before local state is
published. A failed save after a successful firmware mutation is not a rollback:
refresh the radio and do not retry blindly. Keystore loss makes preferences
unavailable; no automatic destructive reset.

## Safety and unsupported capabilities

The new service operations reuse provisionMeshCoreChannel, clearMeshCoreChannel
and existing MeshCore provisioning ports. Only first empty slots are allowed,
and the write wrapper checks emptiness again just before the firmware command.
Clear and share re-read and compare the full configuration ID. Operations capture
the active command port, radio identity and lifecycle epoch and check across
awaits. External firmware changes between read and write cannot be made atomic
without firmware compare-and-set support. Disconnect remains available.

Invitation sharing requires confirmation, warns about shared-key access and
hands a versioned `BUSHMESH-CHAT-1:` base64 payload containing only the carrier
name and non-zero 16-byte private key to the OS share sheet deliberately.
Base64 is not encryption; recipients and clipboard/share destinations may
retain credentials. Import validates a bounded canonical payload, strict UTF-8
channel name and key, and supports the previous human-readable name/key
format. It rejects convoy invitations (which have a different contract).
The UI does not include credentials in review, normal settings or previews. No automatic reveal, copy, or key rotation. No plaintext key
display in normal settings. OS share previews and recipient apps are outside
BushMesh's screenshot/storage controls.

Archive is reversible and local only. Leave clears only one verified firmware
slot; other radios and encrypted message history are unchanged. Existing legacy
Radio History is slot/name scoped and lacks a reliable configuration ID; do not
offer per-chat export, deletion, automatic unread counts, or history reassignment.
Mute is unavailable until native notifications can route by actual configuration.
Verified remote roles, member removal, global deletion, remote channel change,
remote role assignment and policy controls remain unavailable pending Security v2.

## Validation
`__tests__/chatPreferences.test.ts` tests persistence restart, provenance,
serialization, malformed data and projection. The existing radio-service suite
adds occupied-slot, stale credential, reconnect, read-back and targeted leave
cases. Android physical testing should cover two radios, process restart,
same-slot key replacement, full slots, failed writes and explicit invitation
sharing. No claim of field verification is made by this branch.


## QR invitation investigation
The pinned branch package manifest has React Native, safe-area context,
buffer and BLE, but no QR encoder or camera scanner. Do not implement an
unreviewed camera permission or embed credentials in a remote QR generator.
A future reviewed offline encoder/scanner should consume the same bounded
invite format, explicitly display a credential-sharing warning, validate
before joining, avoid analytics, screenshots and clipboard automation, and
be tested in airplane mode. No QR control is presented until that exists.

## Exact notification and history integration dependency

- `BushMeshCarNotifications.postIncoming(channelIndex, channelName, ...)`
  derives Android notification IDs and reply/read pending intents from the slot;
  it cannot distinguish a reused slot with a different PSK/radio. The native
  receive path and actions must carry a verified configuration reference captured
  at ingress; use an opaque identifier and revalidate before replying. The
  native notification service must read durable mute policies itself, including
  timed expiration, even when JS is not running. Never expose a PSK in intent
  extras, notification metadata, or a notification channel ID.
- `RadioMessageSpeechBridge` consumes the newest legacy received message and
  global `radioMessagesEnabled`; it needs the same captured configuration ID
  and a configuration-aware ordinary-text policy. `SpeechAlertBridge` is the
  separate critical-alert path and must remain independent of chat mute/auto-read.
- `BushMeshChannelMessage` and `messageSnapshot.ts` v1 only persist channel
  index/name. The messenger and integration workers must own a single versioned
  encrypted history migration: capture full configuration identity at actual
  ingress and outbound acceptance, not by looking up the slot retrospectively.
  Existing messages without identity remain explicitly unscoped; never assign
  them to a new configuration or export/delete them through a scoped selector.
  Add selective deletion with atomic encrypted snapshot commit and a scoped
  export contract with explicit confirmation and destination privacy. Add
  configuration-aware search and unread tracking only after this exists.
- Future `ChatAdministration` is a discriminated model for verified owner,
  administrator or participant and capability names; the MeshCore provider
  remains `{status: 'unavailable'}`. A future authenticated provider must
  independently authorize each operation. Local creator or possession of
  the shared key never grants network authority.

## Physical device acceptance (requires integrated messenger build)
- [ ] On Galaxy S22+, open New chat; choose a UTF-8 name, avatar and description,
  review, create and verify the radio's first free slot.
- [ ] On a second phone/radio, paste the shared invite, verify that no write
  occurs until Confirm and join; exchange genuine MeshCore messages.
- [ ] Join with manual name/key and with a legacy invite; malformed, zero-key
  and convoy invites fail without writes. Confirm duplicate name/key cannot
  create another slot.
- [ ] Fill the radio slots and verify the full-capacity message; no overwrites.
- [ ] Open the same settings from inbox and room, edit nickname/description,
  change avatar, toggle pin/archive/unread, sort and search by name/alias.
- [ ] Force-stop and relaunch, reconnect, refresh, verify all local preferences
  and sort return. Switch radios and back; preferences stay independent.
- [ ] Change a slot credential externally without changing its name; refresh
  and verify no preferences/creator claim transfer. Stale leave/share fails.
- [ ] Disconnect during create, join, clear and share; confirm uncertain results
  require refresh. No silent retry or automatic credential exposure.
- [ ] Cancel share and leave confirmations; verify no credential reveal or
  firmware modification. Confirm leave affects one slot only, history remains.
- [ ] Verify global speech and critical-alert behaviour unchanged. No false
  individual notification mute, authenticated member roles or history controls.
- [ ] Review portrait/landscape, Android back and keyboard, safe-area, outdoor
  contrast and touch sizes. Do not capture invitations or keys in screenshots.

The Jest tests simulate persistence failure and connection changes. Only real
hardware/Android testing establishes actual Keystore and firmware behaviour.
