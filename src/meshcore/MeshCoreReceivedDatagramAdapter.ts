import {ReceivedDatagram, ReceivedDatagramSource} from '../radio/ReceivedDatagram';
import {MeshCoreChannelDataFrame} from './meshcoreChannelData';

export type MeshCoreReceivedDatagramMetadata = {
  receivedAtMs?: number;
  source?: ReceivedDatagramSource;
  radioIdentityRef?: string | null;
  transportDeviceId?: string | null;
  diagnosticLabel?: string | null;
};

/**
 * Converts MeshCore channel-data metadata into radio-core's neutral inbound
 * contract. This adapter deliberately does not inspect or classify payload bytes.
 */
export function meshCoreFrameToReceivedDatagram(
  frame: MeshCoreChannelDataFrame,
  metadata: MeshCoreReceivedDatagramMetadata = {},
): ReceivedDatagram {
  return {
    channelIndex: frame.channelIndex,
    dataType: frame.dataType,
    payload: Uint8Array.from(frame.payload),
    receivedAtMs:
      typeof metadata.receivedAtMs === 'number' &&
      Number.isFinite(metadata.receivedAtMs) &&
      metadata.receivedAtMs >= 0
        ? metadata.receivedAtMs
        : Date.now(),
    transport: 'meshcore',
    source: metadata.source ?? 'live',
    link: {
      snrDb: frame.snrDb,
      pathLength: frame.pathLength,
    },
    radioIdentityRef: metadata.radioIdentityRef ?? null,
    transportDeviceId: metadata.transportDeviceId ?? null,
    diagnosticLabel: metadata.diagnosticLabel ?? 'meshcore-channel-data',
  };
}
