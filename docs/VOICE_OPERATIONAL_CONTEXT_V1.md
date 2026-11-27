# BushMesh — shared operational voice context v1

Repository: botsie02-lgtm/bushmeshmain  
Branch: feature/voice-operational-context-v1  
Exact base: a58f99e4fdae74c52378b63783aec27e95dc69d0

## Ownership

This is an isolated application-level context implementation in
\`src/app/voiceContext/\`, with tests and a dedicated validation workflow.
No main or integration merge. No changes to VoiceAssistant.ts,
applicationVoice.ts, VoiceComposerControls.tsx, native speech, RadioScreen,
AppShell, App.tsx, AppProviders, background radio, Security v1, convoy
membership or channel provisioning. No microphone requests, transmissions,
recordings, location-disclosure operations or key installation.

The existing \`applicationVoice\` singleton and \`VoiceAssistant\` remain
the **only** speech command/dialogue engine. This project adds no assistant.

## Five distinct references

1. **Viewed conversation:** the existing \`ViewedConversationContext\`
   ref, used for screen navigation only. A viewed MeshCore channel is not
   verified or approved for voice sending.
2. **Explicit voice selection:** a separate in-memory
   \`VoiceSelectedConversation\`: either a complete Radio scope or a convoy
   ID. \`selectExplicit()\` is an application UI action; never call it
   automatically because of tab changes, incoming text or selected convoy.
3. **Active operational convoy:** only \`checkedMembership()\`-verified
   Security v1 \`AuthorizedConvoyMembership\` for the current local identity.
   The membershipRecordRef is the current Security epoch reference.
4. **Verified convoy–Radio link:** future read-only
   \`VerifiedConvoyRadioLink\` tying convoy ID, local identity,
   membershipRecordRef, opaque linkRecordRef and an exact full Radio
   \`RadioConversationScope\`. Its source must be an authoritative
   Security v1 enrolment/relationship service, not a shared PSK, invite,
   discovered MeshCore contact or matching slot/name.
5. **Authorised hands-free destination:** an immutable
   \`VoiceSessionSnapshot\` copied from an explicitly selected and freshly
   resolved destination, with an independently authorised hands-free grant.
   Default is not granted. No native wake detector is assumed installed.

None of the above silently substitutes for another.

## Destination resolution

\`resolveVoiceDestination(selection, inputs)\` is pure and fail-closed.

For a Radio target, it requires a full, valid scope
\`{radioId, channelGeneration, channelIndex, channelName}\` and **exactly
one** current \`RadioVoiceBinding\` carrying the protected chat
configuration ID and matching **numeric** \`getChatSessionEpoch()\`.
Binding state must be ready and the production adapter must attest
\`submissionAuthority: 'verified-radio-chat'\`.

The adapter \`verifiedRadioBindingsFromChatManagement\` accepts only
the currently connected radio, a ready verified configuration catalogue,
a matching radio observation epoch and protected persisted chat
configuration identity/positive incarnation. Retired, mismatched,
ambiguous or stale entries are excluded.

This is NOT a new firmware verification operation. The existing
\`RadioConnection.sendVerifiedChat\` remains responsible for reading the
actual radio configuration immediately before sending and running its
final voice-session guard. A reported companion BLE connection alone
cannot become a verified voice destination.

For a convoy target, it requires a current Security v1 membership
**and** exactly one verified convoy–Radio link with the same convoy,
local identity and membershipRecordRef. The link's Radio scope must
also resolve to the same current verified Radio binding. Missing,
ambiguous, revoked, pending or epoch-mismatched links are unavailable.

The resolver never calls a provisioning service, creates a group,
changes the carrier, enables Security v2/W1 or installs a member.

## Session lifecycle

\`VoiceOperationalSessionController\` provides:

- \`selectExplicit()\`: select a voice-only target, separately from the
  viewed conversation and operational convoy.
- \`activateExplicit()\`: creates a frozen, unique session identity and
  full destination snapshot, without initiating speech or transmission.
- \`authoriseHandsFreeExplicit()\`: second independent explicit user
  action, only possible with a real native wake-detector readiness/owner
  attestation supplied by a future specialist adapter.
- \`revokeHandsFree()\`, \`suspendSession()\`, \`resumeExplicit()\`,
  \`invalidateSecurity()\`, \`conversationRemoved()\` and
  \`deactivateExplicit()\`.
- \`updateInputs()\`: revalidates on relevant radio ID/session/config
  epoch changes, selected convoy, Security epoch, link changes, native
  detector ownership, app lifecycle and selected tab. A manual session
  suspends on leaving the tab. A separately authorised hands-free session
  can remain active across tab switches, but never changes the bound target.
  Background/inactive lifecycle invalidates the session.
- A suspended session requires **explicit resume** and receives a fresh
  identity. An invalidated session cannot resume without explicitly
  reselecting the voice target. Removing a conversation clears selection.
- \`snapshot()\` / \`subscribe()\` expose stable testable readiness,
  typed reasons, selection, navigation context and frozen session
  snapshots. Readiness is never equivalent to permission to transmit.

Active voice destination identity includes radio ID, channel incarnation,
protected chat ID, radio session epoch, and if convoy-bound, verified
membership and relationship record references. No raw private keys or PSKs.

## Native wake admission is deliberately dormant

\`admitNativeWakeEvent()\` returns only an admission decision. It **never**
parses commands, turns on the microphone, triggers a VoiceAssistant run
or transmits a packet. The caller must be a future trusted native event
adapter; an untrusted inbound radio message must NEVER call this API.

It requires: an active explicit voice session; a second explicit
hands-free authorisation; a supported native wake detector with matching
owner; exact session identity and revision; a fresh timestamp within the
session, and a unique non-replayed event ID. Replayed, stale, foreign,
suspended, cancelled or background events are rejected. Event replay
tracking is bounded and suspends rather than evicting old IDs.

These are application admission checks, not proof that a source actually
came from Android. Future native work must independently validate event
origin/ownership before calling this function. Because no native detector
is wired by this branch, the default \`nativeWake\` input is
\`{supported:false,detectorOwnerRef:null}\` and all wake events are denied.

Received radio text may be read as *content* by VoiceAssistant but must
never be fed into \`parseVoiceCommand\` as a voice command. The new context
does not process incoming text at all.

## Minimal future shell and Radio integration

When the integration worker is ready:

1. Mount \`VoiceOperationalProvider\` **once above the five-tab AppShell**
   and below the existing ViewedConversation and ActiveOperationalConvoy
   providers, preserving the app-lifetime BLE, GPS, and speech owners.
   Do not remount it when Radio, Drive or Convoy changes screens.
2. Supply \`captureVoiceOperationalInputs()\` with
   \`useViewedConversation().viewedConversation\`,
   \`useActiveOperationalConvoy()\`, the actual selected tab from AppShell,
   \`AppState\` foreground state, and live
   \`RadioConnection.getChatSessionEpoch()\`. Today the shell owns the
   tab state privately; the shell owner must expose it via read-only
   context/callback or move the voice provider to a stable component with
   access to tab state. This branch deliberately does not edit AppShell.
3. Reuse Radio's **existing** verified chat management catalogue and its
   loaded source revision rather than mounting another chat-management
   owner. Feed \`verifiedRadioBindingsFromChatManagement()\` from those
   proven records; preserve exact protected configuration ID,
   incarnation, radio ID and numeric session epoch. Do not derive a
   voice binding from \`BushMeshContext.channels\`.
4. Wire an explicit UI gesture in future Radio/Drive/Convoy to
   \`controller.selectExplicit({kind:'radio',scope})\`, or only for genuine
   authorised convoy links,
   \`controller.selectExplicit({kind:'convoy',convoyId})\`, then
   \`controller.activateExplicit()\`. An operational convoy selection
   alone must **not** select or activate a voice destination.
5. Pass the **same** already-verified \`VoiceAssistant.VoiceDestination\`
   source to \`bindVerifiedVoiceDestination(controller,{scope,binding,
   destination})\`. That adapter wraps its \`isCurrent\`, read/dictation
   and verified \`send\` callbacks with the application voice session
   identity. Use the resulting destination with the existing
   \`applicationVoice\` and its regular confirmation process. Do not
   invent a send callback if the underlying verified Radio send is absent.
6. Wire \`subscribeVoiceSafetyStop(controller, () =>
   applicationVoice.cancel(true))\` at the integration owner so suspended,
   invalidated or cancelled sessions terminate the current dialogue.
   Unsubscribe when the application-level bridge unmounts.
7. RadioScreen currently constructs its VoiceDestination within the
   Radio tab and its \`isCurrent()\` depends on tab visibility. For
   **future** authorised cross-tab hands-free operation, the owning Radio
   integration worker must move its verified destination source/guard to
   a shared, app-lifetime adapter with the **same**
   \`sendVerifiedChat\` firmware/current-config/final-guard contract.
   Do not bypass its checks by setting tabVisible to true off-screen.
8. The future convoy creation/join worker must atomically create or link
   the corresponding Radio conversation **only after the real membership
   and radio configuration are verified**. It must publish a verified
   convoy–Radio link with the correct Security epoch and revoke/invalidate
   it on removal, epoch change or channel replacement. Until then
   \`convoyLinks: []\` and convoy voice is unavailable.
9. A later native wake specialist may supply a genuine lifecycle/owner
   attestation and validated native event port, then wire accepted events
   to the **existing** VoiceAssistant only after rechecking admission
   and foreground/hands-free policy. This branch adds no microphone,
   hotword model or audio listener.

The example variable names above describe future app adapters, not
functions already wired or activated on the current branch.

## Validation and safety

Deterministic Jest suites cover:
- Viewed vs explicitly selected voice conversation vs operational convoy.
- Manual and hands-free tab changes with immutable frozen destinations.
- Radio swaps, channel incarnation/epoch mismatches and stale sessions.
- Membership record epoch, identity, revoked state, missing/duplicate links.
- Conversation removal, user cancellation, explicit resume and reselect.
- Native wake owner identity, time window, replay, suspension and default deny.
- Received-message command injection rejection.
- Bridging to the existing VoiceDestination, including asynchronous
  pre-transmit guard and shared React context.
- No assumption of live microphone, actual wake-word availability or radio
  transport delivery.

The branch workflow runs the full Jest suite, TypeScript, ESLint,
simulator compilation, map fixture tests, Android debug compilation and
native JVM tests. It uploads an isolated debug APK only (never installs it
on a device). The source base passed application CI; dedicated **Android
voice lifecycle instrumentation** has NOT been certified by this feature
unless a separate Android instrumentation workflow proves it. A successful
assembleDebug/JVM job does not establish physical wake-word behaviour.

No Security v2, W1, operational enrolment, automatic location disclosure
or device installation is activated.
