import {BushMeshChannel} from '../state/BushMeshContext';
import {ActiveConvoyCarrierProfile} from './carrierCredentials';

/** Only derived from channels freshly read from the connected MeshCore node.
 * Never invent an enrollment id, PSK, or write a channel on recovery.
 */
export function recoverMeshCoreCarrierProfile(
  channels: BushMeshChannel[],
  activeSlot: string | null,
): ActiveConvoyCarrierProfile | null {
  const privateChannels = channels.filter(channel =>
    channel.channelName && channel.channelName !== 'Empty' &&
    channel.secret === 'Configured (redacted)' &&
    Number.isInteger(Number(channel.channelIndex)) &&
    Number(channel.channelIndex) >= 0,
  );
  const chosen = privateChannels.find(channel => channel.channelIndex === activeSlot) ??
    privateChannels[0];
  if (!chosen) return null;
  return {
    convoyId: '',
    convoyName: 'Configured MeshCore channel',
    channelName: chosen.channelName,
    channelIndex: Number(chosen.channelIndex),
    origin: 'recovered',
  };
}
