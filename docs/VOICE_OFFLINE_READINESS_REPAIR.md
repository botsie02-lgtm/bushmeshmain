# Offline voice readiness repair

Base: a58f99e4fdae74c52378b63783aec27e95dc69d0. This is a specialist branch, not an integration approval.

## Contract

Recognizer presence is not proof of installed speech resources. Android API 33+ supports a provider-specific recognition support query, reporting installed, pending and downloadable languages for the requested intent. Unknown is not installed or unsupported. Android API 31–32 can attempt strictly on-device recognition, but cannot use these support/download APIs. API 33 has a download request without progress; API 34+ can report progress, completion, scheduling or failure. The provider may not implement these APIs. A download callback is not an installed-readiness verdict; refresh the inventory after every outcome. Stopping observation or leaving foreground does not guarantee the provider stops downloading. Never download automatically or create a network recognizer.

Recognition language is persisted in the existing native preference store. en-AU is the initial preference; the user chooses English alternatives. Existing TTS output selection is retained. A local test uses the shared finite dialogue, with no send port. No transcript is persisted by the setup panel. Existing native ownership, foreground, permission and generation fences remain authoritative.

## Galaxy S22+ physical acceptance (Android 16)

Use an isolated field-test APK from this exact branch only after application and Android gates pass. Park safely.
1. Open Radio > Messaging settings > Voice assistant readiness. Note selected locale, recognizer availability, installed/pending/downloadable inventory, and independent TTS status. Capture a screenshot without private messages.
2. With internet temporarily enabled, explicitly request en-AU only if desired and offered. Approve any Android prompt; note outcome and refresh. If en-AU is not supported or cannot be installed, explicitly select a reported installed English alternative and refresh. Do not assume provider success means installed.
3. Enable airplane mode, turn Wi-Fi off, and verify no cellular data. Use Test offline recognition, allow microphone permission if needed, and say "BushMesh offline speech test". Confirm an editable transcript, no outgoing message, no audio continuing after completion, and working TTS.
4. Repeat with another phrase, cancel mid-turn, and leave settings while listening. Verify no stale transcript or lingering microphone.
5. Open a verified radio chat with an existing draft. Tap Dictate and hold-to-talk; verify selected locale, draft append and no automatic send. Test Command with "radio check" and spoken cancellation. Only test confirmed transmission with the user's explicit consent and a verified destination.
6. Revoke microphone permission and retry; then grant again and retry. Verify separate error messages. Change language explicitly and verify all recognition modes after restart. Test a missing model if safe to do so.
7. Record provider, Android build, selected locale, observed inventory, exact error, transcript success and test conditions. An emulator pass proves lifecycle/bridge behavior only, not model availability or accuracy.

## Limits

Provider inventory may be incomplete and download callbacks may not be implemented. Unknown readiness remains visibly unknown; a successful offline recognition test is separate evidence. No wake-word training or persistent microphone service is in scope. No keyboard or RadioChatRoom layout changes. The composer setup action provides navigation instructions rather than forcing navigation during a conversation.
