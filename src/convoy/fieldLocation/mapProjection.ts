import type {UnverifiedChannelRemotePosition} from './ChannelFieldLocationSession';
import type {FieldChannelPosition} from '../../maps/fieldChannelPositionAdapter';
import {isValidMapCoordinate} from '../../maps/convoyMapModel';

/** Distinct diagnostics-only projection. Never returns verified member or route types. */
export function projectExplicitChannelMarkers(
  markers: readonly UnverifiedChannelRemotePosition[],
  nowMs: number,
): FieldChannelPosition[] {
  if (!Number.isFinite(nowMs)) return [];
  return markers.filter(m =>
    m.kind === 'UNVERIFIED CHANNEL POSITION' &&
    m.sourceAuthentication === 'none-channel-key-only' &&
    m.transportSourceDeviceId === null &&
    m.expiresAtMs > nowMs && Number.isFinite(m.receivedAtMs) &&
    m.receivedAtMs <= nowMs + 5_000 && isValidMapCoordinate(m),
  ).slice(0, 20).map(m => ({
    id: 'channel-field:' + m.channelIndex + ':' + m.claimedSession,
    label: 'CHANNEL · ' + m.claimedLabel,
    coordinate: {latitude: m.latitude, longitude: m.longitude},
    receivedAtMs: m.receivedAtMs,
    accuracyMeters: null,
    simulated: false,
    trust: 'unverified-channel',
  }));
}
