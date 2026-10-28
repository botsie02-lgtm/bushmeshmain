import {
  BUSHMESH_MESHCORE_DEV_DATA_TYPE,
  BushMeshMessageType,
  DecodedBushMeshPosition,
  DecodedBushMeshQuickAction,
  decodeBushMeshPosition,
  decodeBushMeshQuickAction,
} from './protocol';
import {
  BUSHMESH_FORMATION_MESSAGE_TYPE,
  DecodedBushMeshFormationShare,
  decodeBushMeshFormationShare,
} from './formationProtocol';
import {
  BushMeshInboundMetadata,
  publishBushMeshInboundMessage,
} from './inboundBus';
import {MeshCoreChannelDataFrame} from '../meshcore/meshcoreChannelData';

export type BushMeshInboundMessage =
  | {
      type: BushMeshMessageType.Position;
      channelIndex: number;
      snrDb: number;
      pathLength: number;
      position: DecodedBushMeshPosition;
    }
  | {
      type: BushMeshMessageType.QuickAction;
      channelIndex: number;
      snrDb: number;
      pathLength: number;
      action: DecodedBushMeshQuickAction;
    }
  | {
      type: typeof BUSHMESH_FORMATION_MESSAGE_TYPE;
      channelIndex: number;
      snrDb: number;
      pathLength: number;
      formation: DecodedBushMeshFormationShare;
    };

/**
 * Converts an application-owned MeshCore datagram into a BushMesh domain
 * message. Unknown data types and future BushMesh message types are ignored so
 * other applications can coexist on the same MeshCore channels.
 *
 * Optional transport metadata is forwarded to domain subscribers. This is used
 * by Android background-inbox replay to preserve the time a frame was actually
 * heard rather than making old traffic look fresh when JS returns.
 */
export function decodeBushMeshMeshCoreFrame(
  frame: MeshCoreChannelDataFrame,
  metadata?: Partial<BushMeshInboundMetadata>,
): BushMeshInboundMessage | null {
  if (frame.dataType !== BUSHMESH_MESHCORE_DEV_DATA_TYPE) {
    return null;
  }

  if (frame.payload.length < 2) {
    return null;
  }

  let message: BushMeshInboundMessage | null = null;

  switch (frame.payload[1]) {
    case BushMeshMessageType.Position:
      message = {
        type: BushMeshMessageType.Position,
        channelIndex: frame.channelIndex,
        snrDb: frame.snrDb,
        pathLength: frame.pathLength,
        position: decodeBushMeshPosition(frame.payload),
      };
      break;

    case BushMeshMessageType.QuickAction:
      message = {
        type: BushMeshMessageType.QuickAction,
        channelIndex: frame.channelIndex,
        snrDb: frame.snrDb,
        pathLength: frame.pathLength,
        action: decodeBushMeshQuickAction(frame.payload),
      };
      break;

    case BUSHMESH_FORMATION_MESSAGE_TYPE:
      message = {
        type: BUSHMESH_FORMATION_MESSAGE_TYPE,
        channelIndex: frame.channelIndex,
        snrDb: frame.snrDb,
        pathLength: frame.pathLength,
        formation: decodeBushMeshFormationShare(frame.payload),
      };
      break;

    default:
      return null;
  }

  publishBushMeshInboundMessage(message, metadata);
  return message;
}
