import React, {
  createContext, useContext, useLayoutEffect, useMemo, useState,
  useSyncExternalStore,
} from 'react';
import type {VoiceDestination} from '../../speech/VoiceAssistant';
import type {RadioConversationScope} from '../../screens/radioMessenger/messengerModel';
import {equalScope} from '../../screens/radioMessenger/messengerModel';
import {
  type VoiceOperationalInputs, type VoiceOperationalSnapshot,
  type RadioVoiceBinding, type ResolvedVoiceDestination,
  VoiceOperationalSessionController,
} from './voiceOperationalSession';

/**
 * Shell-owned provider. Integration will mount this ABOVE Drive, Radio and
 * Convoy once, not in a tab or a VoiceComposer component. Does not own audio.
 */
const VoiceOperationalContext = createContext<VoiceOperationalSessionController | null>(null);

export function VoiceOperationalProvider({
  inputs, children, controller: supplied,
}: {
  inputs: VoiceOperationalInputs;
  children: React.ReactNode;
  controller?: VoiceOperationalSessionController;
}): React.JSX.Element {
  const [internal] = useState(() => new VoiceOperationalSessionController(inputs));
  const controller = supplied ?? internal;
  useLayoutEffect(() => {
    controller.updateInputs(inputs);
  }, [controller, inputs]);

  return (
    <VoiceOperationalContext.Provider value={controller}>
      {children}
    </VoiceOperationalContext.Provider>
  );
}

export function useVoiceOperationalSession(): {
  controller: VoiceOperationalSessionController;
  snapshot: VoiceOperationalSnapshot;
} {
  const controller = useContext(VoiceOperationalContext);
  if (!controller) {
    throw new Error('useVoiceOperationalSession requires VoiceOperationalProvider');
  }
  const snapshot = useSyncExternalStore(
    controller.subscribe, controller.snapshot, controller.snapshot,
  );
  return useMemo(() => ({controller, snapshot}), [controller, snapshot]);
}

/**
 * Shell integration adapter for applicationVoice.cancel(true). Never owns or
 * creates VoiceAssistant; only reports the point where existing dialogue
 * must stop. The callback is integration-supplied and may be asynchronous.
 */
export function subscribeVoiceSafetyStop(
  controller: VoiceOperationalSessionController,
  onStop: () => void,
): () => void {
  let previous = controller.snapshot().session;
  return controller.subscribe(() => {
    const next = controller.snapshot().session;
    const shouldStop = previous?.status === 'active' &&
      (!next || next.status !== 'active' ||
        next.identity !== previous.identity ||
        (previous.handsFreeAuthorised && !next.handsFreeAuthorised));
    previous = next;
    if (shouldStop) onStop();
  });
}

export type VerifiedVoiceDestinationAdapter = Readonly<{
  /** Existing Radio verified-chat source of VoiceDestination; no new sender. */
  destination: VoiceDestination;
  /** Radio's exact, independently revalidated destination identity. */
  binding: RadioVoiceBinding;
  /** The exact scope used by the existing RadioScreen composer. */
  scope: RadioConversationScope;
}>;

/**
 * A guard around the existing VoiceAssistant destination. It never creates a
 * send function or parses incoming messages. No unverified channel fallback.
 *
 * IMPORTANT: the existing Radio send implementation must ALSO revalidate
 * source radio identity, incarnation and native session immediately before
 * submission. This wrapper is a second guard, not a substitute.
 */
export function bindVerifiedVoiceDestination(
  controller: VoiceOperationalSessionController,
  source: VerifiedVoiceDestinationAdapter,
): VoiceDestination | null {
  const session = controller.snapshot().session;
  if (!session || !controller.isCurrent(session.identity) ||
    !equalScope(session.destination.scope, source.scope) ||
    !equalScope(source.scope, source.binding.scope) ||
    session.destination.chatRecordRef !== source.binding.chatRecordRef ||
    session.destination.radioSessionEpoch !== source.binding.radioSessionEpoch ||
    source.binding.submissionAuthority !== 'verified-radio-chat' ||
    source.binding.state !== 'ready' ||
    !source.destination.isCurrent()) return null;

  const identity = session.identity;
  const capturedKey = session.destination.key;
  const origin = source.destination;
  const current = (): boolean => {
    const latest = controller.snapshot().session;
    return !!latest && latest.identity === identity &&
      latest.destination.key === capturedKey &&
      controller.isCurrent(identity) && origin.isCurrent();
  };

  return {
    key: JSON.stringify([identity, capturedKey, origin.key]),
    label: origin.label,
    isCurrent: current,
    draft: () => current() ? origin.draft() : '',
    editDraft: value => {if (current()) origin.editDraft(value);},
    send: origin.send
      ? (text, stillCurrent) => {
        if (!current() || !stillCurrent()) {
          return Promise.reject(new Error('Voice destination changed. Nothing sent.'));
        }
        return origin.send!(text, () => current() && stillCurrent());
      } : undefined,
    latest: () => current() ? origin.latest() : null,
    unread: () => current() ? origin.unread() : [],
    quick: () => current() ? origin.quick() : [],
    radio: () => current() ? origin.radio() : 'Voice destination unavailable.',
    localReading: origin.localReading
      ? async command => {
        if (!current()) return 'Voice destination unavailable.';
        const reading = await origin.localReading!(command);
        return current() ? reading : 'Voice destination unavailable.';
      } : undefined,
  };
}

/** Read-only descriptor for integration routing, not a send permission.
 * Never use this to construct a VoiceDestination without a real verified
 * Radio/Convoy-owned source and the guard above.
 */
export function currentVoiceRoute(
  controller: VoiceOperationalSessionController,
): ResolvedVoiceDestination | null {
  const session = controller.snapshot().session;
  return session && controller.isCurrent(session.identity)
    ? session.destination : null;
}
