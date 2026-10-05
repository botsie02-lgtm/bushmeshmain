import {
  BUSHMESH_MESHCORE_DEV_DATA_TYPE,
  BushMeshMessageType,
  DecodedBushMeshPosition,
  decodeBushMeshPosition,
} from './protocol';
import {MeshCoreChannelDataFrame} from '../meshcore/meshcoreChannelData';

export type BushMeshInboundMessage =
  | {
      type: BushMeshMessageType.Position;
      channelIndex: number;
      snrDb: number;
      pathLength: number;
      position: DecodedBushMeshPosition;
    };

/**
 * Converts an application-owned MeshCore datagram into a BushMesh domain
 * message. Unknown data types and future BushMesh message types are ignored so
 * other applications can coexist on the same MeshCore channels.
 */
export function decodeBushMeshMeshCoreFrame(
  frame: MeshCoreChannelDataFrame,
): BushMeshInboundMessage | null {
  if (frame.dataType !== BUSHMESH_MESHCORE_DEV_DATA_TYPE) {
    return null;
  }

  if (frame.payload.length < 2) {
    return null;
  }

  switch (frame.payload[1]) {
    case BushMeshMessageType.Position:
      return {
        type: BushMeshMessageType.Position,
        channelIndex: frame.channelIndex,
        snrDb: frame.snrDb,
        pathLength: frame.pathLength,
        position: decodeBushMeshPosition(frame.payload),
      };

    default:
      return null;
  }
}
