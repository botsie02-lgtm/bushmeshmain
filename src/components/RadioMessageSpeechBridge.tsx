import {useEffect, useMemo, useRef} from 'react';

import {nativeSpeech} from '../native/NativeSpeech';
import {useBushMesh} from '../state/BushMeshContext';
import {useSpeech} from '../state/SpeechContext';

function speechForRadioMessage(channelName: string, text: string): string {
  const cleanChannel = channelName.trim() || 'radio channel';
  const cleanText = text.trim();
  return `Bushmesh, ${cleanChannel}. ${cleanText}`;
}

/**
 * Optional read-aloud for ordinary incoming radio text.
 *
 * Historical messages restored from encrypted storage are silently baselined.
 * New chatter is queued behind existing TTS; critical safety alerts use
 * QUEUE_FLUSH elsewhere and therefore always retain higher speech priority.
 */
export function RadioMessageSpeechBridge(): null {
  const {channelMessages, messagePersistenceStatus} = useBushMesh();
  const {radioMessagesEnabled, runtimeState} = useSpeech();
  const initializedRef = useRef(false);
  const lastObservedIdRef = useRef<string | null>(null);

  const newestReceived = useMemo(
    () => channelMessages.find(message => message.direction === 'received') ?? null,
    [channelMessages],
  );

  useEffect(() => {
    const historyReady =
      messagePersistenceStatus === 'ready' ||
      messagePersistenceStatus === 'unsupported';
    if (!historyReady) {
      return;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      lastObservedIdRef.current = newestReceived?.id ?? null;
      return;
    }

    if (!newestReceived || newestReceived.id === lastObservedIdRef.current) {
      return;
    }

    // Advance even when auto-read is muted/unavailable. Enabling speech later
    // must never cause old unread history to play unexpectedly.
    lastObservedIdRef.current = newestReceived.id;

    if (!radioMessagesEnabled || runtimeState !== 'ready') {
      return;
    }

    nativeSpeech
      .speak(
        speechForRadioMessage(
          newestReceived.channelName,
          newestReceived.text,
        ),
        false,
      )
      .catch(() => {
        // Visible/persisted radio history remains authoritative if TTS fails.
      });
  }, [
    messagePersistenceStatus,
    newestReceived,
    radioMessagesEnabled,
    runtimeState,
  ]);

  return null;
}
