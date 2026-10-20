import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
} from './codec';
import {
  BushMeshControlCommand,
  BushMeshConvoyAction,
  BushMeshConvoyActionControl,
  encodeControlPacket,
} from './controlPackets';
import {encodeBushMeshWire} from './transport';

export function isUrgentBushMeshConvoyAction(
  action: BushMeshConvoyAction | number,
): boolean {
  return (
    action === BushMeshConvoyAction.Hold ||
    action === BushMeshConvoyAction.TurnAround ||
    action === BushMeshConvoyAction.Obstacle ||
    action === BushMeshConvoyAction.Recovery
  );
}

/**
 * Convoy actions are short-lived operational instructions. They request an ACK
 * but are deliberately not store-and-forward packets: replaying an old HOLD or
 * TURN AROUND after reconnect could be unsafe. Urgent actions get emergency
 * scheduling so they jump ahead of routine location/telemetry traffic.
 */
export function encodeBushMeshConvoyCommandWire(
  command: BushMeshConvoyActionControl,
  messageId: number,
): number[] {
  if (command.command !== BushMeshControlCommand.ConvoyAction) {
    throw new Error('Expected a BushMesh convoy action command.');
  }

  return encodeBushMeshWire({
    type: BushMeshPacketType.Command,
    priority: isUrgentBushMeshConvoyAction(command.action)
      ? BushMeshPriority.Emergency
      : BushMeshPriority.DirectMessage,
    compression: BushMeshCompressionProfile.Command,
    messageId,
    ackRequested: true,
    storeAndForward: false,
    payload: encodeControlPacket(command),
  });
}
