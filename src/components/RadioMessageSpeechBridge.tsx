import {useEffect, useRef} from 'react';

import {nativeSpeech} from '../native/NativeSpeech';
import {useBushMesh} from '../state/BushMeshContext';
import {useSpeech} from '../state/SpeechContext';
import {chatPreferenceStore} from '../radio/chatManagement/chatPreferences';
import {permitsAssociatedRadioSpeech} from '../radio/chatManagement/radioSpeechPolicy';

function speechForRadioMessage(channelName: string, text: string): string {
  const cleanChannel = channelName.trim() || 'radio channel';
  const cleanText = text.trim();
  return `Bushmesh, ${cleanChannel}. ${cleanText}`;
}

/** Restore history silently, process each newly persisted receive once. Ordinary
 * speech is queued; critical alerts keep their independent priority policy. */
export function RadioMessageSpeechBridge(): null {
  const {channelMessages, messagePersistenceStatus} = useBushMesh();
  const {radioMessagesEnabled, runtimeState} = useSpeech();
  const seen = useRef<Set<string> | null>(null);
  const alive = useRef(true);
  const enabled = useRef(false);
  const speechQueue = useRef(Promise.resolve());
  enabled.current = radioMessagesEnabled && runtimeState === 'ready';
  useEffect(() => {
    alive.current = true;
    return () => {alive.current = false;};
  }, []);

  useEffect(() => {
    if (messagePersistenceStatus !== 'ready' && messagePersistenceStatus !== 'unsupported') return;
    const received = channelMessages.filter(message => message.direction === 'received');
    if (!seen.current) {
      seen.current = new Set(received.map(message => message.id));
      return;
    }
    const newMessages = received.filter(message => !seen.current!.has(message.id)).reverse();
    for (const message of newMessages) {
      seen.current.add(message.id);
      if (!enabled.current) continue;
      speechQueue.current = speechQueue.current.then(async () => {
        if (!alive.current || !enabled.current) return;
        if (message.conversation?.provenance === 'local-observation') {
          // A storage error cannot safely establish that the user permits
          // speaking this associated message aloud; retain it in history.
          const entries = await chatPreferenceStore.load();
          if (!permitsAssociatedRadioSpeech(message, entries)) return;
        }
        if (!alive.current || !enabled.current) return;
        await nativeSpeech.speak(speechForRadioMessage(message.channelName, message.text), false);
      }).catch(() => undefined);
    }
  }, [messagePersistenceStatus, channelMessages, radioMessagesEnabled, runtimeState]);
  return null;
}
