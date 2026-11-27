import type {ViewedConversationRef} from '../activeContext/ViewedConversationContext';
import type {ActiveOperationalConvoyContextValue} from '../activeContext/ActiveOperationalConvoyContext';
import {checkedMembership} from '../activeContext/operationalConvoy';
import type {
  ChatConfiguration, ChatPreferenceSnapshot,
} from '../../radio/chatManagement/chatPreferences';
import type {
  HostLifecycle, RadioVoiceBinding, VerifiedConvoyRadioLink,
  VoiceOperationalInputs, VoiceTab,
} from './voiceOperationalSession';

/** Read-only adapter from the existing radio chat-management readback.
 * IMPORTANT: "ready" means the current protected configuration catalogue is
 * usable; the existing sendVerifiedChat must STILL verify firmware and guard
 * the voice session immediately before submitting any packet.
 */
export function verifiedRadioBindingsFromChatManagement(input: {
  radioId: string | null;
  radioSessionEpoch: number | null;
  catalogReady: boolean;
  radioConnected: boolean;
  observationCurrent: boolean;
  chats: readonly ChatConfiguration[];
  preferences: ChatPreferenceSnapshot;
}): RadioVoiceBinding[] {
  if (!input.catalogReady || !input.radioConnected || !input.observationCurrent ||
    !input.radioId || input.radioSessionEpoch === null ||
    !Number.isSafeInteger(input.radioSessionEpoch) ||
    input.radioSessionEpoch < 0) return [];

  return input.chats.flatMap(chat => {
    const preference = input.preferences[chat.id];
    const incarnation = preference?.incarnation ?? 1;
    const stored = preference?.configuration;
    // Never fall back to channel name/slot or trust a retired/reconfigured
    // local profile. chat.id is the protected configuration ID.
    if (!/^[a-f0-9]{64}$/i.test(chat.id) ||
      chat.radio !== input.radioId ||
      !Number.isInteger(chat.slot) || chat.slot < 0 || chat.slot > 7 ||
      !chat.name.trim() ||
      !Number.isSafeInteger(incarnation) || incarnation < 1 ||
      !preference || preference.retired ||
      !stored || stored.id !== chat.id ||
      stored.radio !== chat.radio ||
      stored.slot !== chat.slot || stored.name !== chat.name) return [];
    return [{
      scope: {
        radioId: chat.radio,
        channelGeneration: 'config:' + incarnation + ':' + chat.id,
        channelIndex: String(chat.slot),
        channelName: chat.name,
      },
      chatRecordRef: chat.id,
      radioSessionEpoch: input.radioSessionEpoch!,
      submissionAuthority: 'verified-radio-chat' as const,
      state: 'ready' as const,
    }];
  });
}

/** Shell capture only. No implicit voice selection, group linking,
 * membership creation, read receipts or location disclosure.
 */
export function captureVoiceOperationalInputs(input: {
  viewedConversation: ViewedConversationRef | null;
  active: Pick<ActiveOperationalConvoyContextValue,
    'activeConvoy' | 'localIdentityRef' | 'status'>;
  selectedTab: VoiceTab;
  lifecycle: HostLifecycle;
  radioSessionEpoch: number | null;
  radioBindings?: readonly RadioVoiceBinding[];
  convoyLinks?: readonly VerifiedConvoyRadioLink[];
  nativeWake?: VoiceOperationalInputs['nativeWake'];
}): VoiceOperationalInputs {
  const identity = input.active.localIdentityRef;
  const membership = input.active.status === 'ready' && identity &&
    input.active.activeConvoy
    ? checkedMembership(input.active.activeConvoy,
      input.active.activeConvoy.convoyId, identity) : null;
  return {
    viewedConversation: input.viewedConversation,
    activeConvoy: membership,
    localIdentityRef: identity,
    selectedTab: input.selectedTab,
    lifecycle: input.lifecycle,
    radioSessionEpoch: input.radioSessionEpoch,
    radioBindings: input.radioBindings ?? [],
    convoyLinks: input.convoyLinks ?? [],
    nativeWake: input.nativeWake ?? {supported: false, detectorOwnerRef: null},
  };
}
