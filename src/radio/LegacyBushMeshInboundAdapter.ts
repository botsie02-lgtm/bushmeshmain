import {
  BUSHMESH_SECURITY_WIRE_MAGIC,
  BUSHMESH_WIRE_MAGIC,
} from '../bushmesh/protocol/public';
import {
  BUSHMESH_FORMATION_MESSAGE_TYPE,
  DecodedBushMeshFormationShare,
  decodeBushMeshFormationShare,
} from '../bushmesh/formationProtocol';
import {publishBushMeshInboundMessage} from '../bushmesh/inboundBus';
import {
  BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE,
  DecodedBushMeshPositionRequest,
  decodeBushMeshPositionRequest,
} from '../bushmesh/positionRequestProtocol';
import {
  BUSHMESH_MESHCORE_DEV_DATA_TYPE,
  BushMeshMessageType,
  DecodedBushMeshPosition,
  DecodedBushMeshQuickAction,
  decodeBushMeshPosition,
  decodeBushMeshQuickAction,
} from '../bushmesh/legacyProtocol';
import {
  ReceivedDatagram,
  subscribeReceivedDatagrams,
} from './ReceivedDatagram';

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
    }
  | {
      type: typeof BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE;
      channelIndex: number;
      snrDb: number;
      pathLength: number;
      request: DecodedBushMeshPositionRequest;
    };

function isCanonicalBushMeshDatagram(payload: Uint8Array): boolean {
  return (
    payload.length >= 2 &&
    payload[0] === BUSHMESH_WIRE_MAGIC[0] &&
    (payload[1] === BUSHMESH_WIRE_MAGIC[1] ||
      payload[1] === BUSHMESH_SECURITY_WIRE_MAGIC[1])
  );
}

/**
 * Temporary compatibility boundary for the pre-canonical BushMesh packet set.
 * The generic radio lifecycle only publishes ReceivedDatagram. This adapter is
 * the only inbound radio-core surface that should understand these packet bytes.
 * Canonical B5 4D/B5 53 traffic is explicitly excluded so the migration paths
 * cannot both deliver the same application event.
 */
export class LegacyBushMeshInboundAdapter {
  consume(datagram: ReceivedDatagram): BushMeshInboundMessage | null {
    if (datagram.dataType !== BUSHMESH_MESHCORE_DEV_DATA_TYPE) {
      return null;
    }
    if (datagram.payload.length < 2 || isCanonicalBushMeshDatagram(datagram.payload)) {
      return null;
    }

    const snrDb = datagram.link?.snrDb ?? 0;
    const pathLength = datagram.link?.pathLength ?? 0xff;
    let message: BushMeshInboundMessage | null = null;

    switch (datagram.payload[1]) {
      case BushMeshMessageType.Position:
        message = {
          type: BushMeshMessageType.Position,
          channelIndex: datagram.channelIndex,
          snrDb,
          pathLength,
          position: decodeBushMeshPosition(datagram.payload),
        };
        break;
      case BushMeshMessageType.QuickAction:
        message = {
          type: BushMeshMessageType.QuickAction,
          channelIndex: datagram.channelIndex,
          snrDb,
          pathLength,
          action: decodeBushMeshQuickAction(datagram.payload),
        };
        break;
      case BUSHMESH_FORMATION_MESSAGE_TYPE:
        message = {
          type: BUSHMESH_FORMATION_MESSAGE_TYPE,
          channelIndex: datagram.channelIndex,
          snrDb,
          pathLength,
          formation: decodeBushMeshFormationShare(datagram.payload),
        };
        break;
      case BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE:
        message = {
          type: BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE,
          channelIndex: datagram.channelIndex,
          snrDb,
          pathLength,
          request: decodeBushMeshPositionRequest(datagram.payload),
        };
        break;
      default:
        return null;
    }

    publishBushMeshInboundMessage(message, {
      receivedAtMs: datagram.receivedAtMs,
      source: datagram.source,
    });
    return message;
  }
}

export const legacyBushMeshInboundAdapter = new LegacyBushMeshInboundAdapter();

export function subscribeLegacyBushMeshInboundCompatibility(): () => void {
  return subscribeReceivedDatagrams(datagram => {
    legacyBushMeshInboundAdapter.consume(datagram);
  });
}
