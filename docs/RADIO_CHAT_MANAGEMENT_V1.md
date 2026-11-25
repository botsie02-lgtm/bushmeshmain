# Radio chat management v1 — messenger integration

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
// query, showArchived) or render ChatInboxControls.
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
  `defaultChatPreferences` provides unknown/imported defaults. No message content
  search until the history schema can establish channel provenance.

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
explicitly records non-creator. Existing/imported channels have no creator claim.
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
hands the name/key to the OS share sheet deliberately; recipient apps may retain
the credential. No automatic reveal, copy, or key rotation. No plaintext key
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
