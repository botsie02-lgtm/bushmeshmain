import type {BushMeshChannelMessage} from '../../state/BushMeshContext';
import type {ChatPreferenceSnapshot} from './chatPreferences';

/** Only a durable association to the same protected configuration incarnation
 * can apply a per-conversation speech override. Never match by slot or name alone. */
export function permitsAssociatedRadioSpeech(message: BushMeshChannelMessage, entries: ChatPreferenceSnapshot): boolean {
  const owner = message.conversation;
  if (message.direction !== 'received' || owner?.provenance !== 'local-observation') return true;
  const match = /^config:([1-9][0-9]*):([a-f0-9]{64})$/.exec(owner.channelGeneration);
  if (!match) return true;
  const p = entries[match[2]];
  const c = p?.configuration;
  if (!c || c.id !== match[2] || c.radio !== owner.radioId || String(c.slot) !== owner.channelIndex ||
      c.name !== owner.channelName || p.incarnation !== Number(match[1])) return true;
  return p.autoRead !== false;
}
