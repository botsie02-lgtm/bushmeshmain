import {AppState} from 'react-native';
import {nativeSpeech} from '../native/NativeSpeech';
import type {DictationDestination} from './VoiceComposerControls';

export type RadioSpeechDestination = DictationDestination & {
  latest: () => string | null;
  unread: () => readonly string[];
};

// Read-aloud only. Retire the application command/hold-to-talk adapters,
// without changing the shared native finite recognition or TTS APIs.
let active: {key: string} | null = null;
let last: {key: string; text: string} | null = null;
let cancelling = false;

async function readText(text: string, destination: RadioSpeechDestination) {
  if (active || cancelling || !destination.isCurrent() || AppState.currentState !== 'active' || !text.trim()) return;
  const token = {key: destination.key};
  active = token;
  try {
    if (await nativeSpeech.speakOrdinaryAndWait(text) && active === token && !cancelling && destination.isCurrent()) {
      last = {key: destination.key, text};
    }
  } finally {
    if (active === token) active = null;
  }
}

async function cancelDestination(key: string) {
  if (last?.key === key) last = null;
  if (active?.key !== key || cancelling) return;
  const token = active;
  cancelling = true;
  try {await nativeSpeech.stopOrdinary();}
  finally {
    if (active === token) active = null;
    cancelling = false;
  }
}

export const applicationVoice = {
  readText,
  async readSelection(kind: 'unread' | 'repeat', destination: RadioSpeechDestination) {
    const values = kind === 'unread' ? destination.unread().slice(0, 10) :
      last?.key === destination.key ? [last.text] : [];
    if (values.length) await readText(values.join('. Next message. '), destination);
  },
  cancelDestination,
};

AppState.addEventListener('change', state => {
  if (state === 'background') {
    last = null;
    if (active) cancelDestination(active.key).catch(() => undefined);
  }
});
