import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
  assertBytes,
  assertIntegerInRange,
  decodeVarUint,
  encodeVarUint,
} from './codec';
import {encodeBushMeshWire} from './transport';

export enum BushMeshDeliveryAckStatus {
  Delivered = 0,
  Rejected = 1,
  Expired = 2,
}

export type BushMeshDeliveryAck = {
  messageId: number;
  status: BushMeshDeliveryAckStatus | number;
};

export function encodeDeliveryAckPayload(ack: BushMeshDeliveryAck): number[] {
  assertIntegerInRange(ack.messageId, 0, 0xffffffff, 'Acknowledged message ID');
  assertIntegerInRange(ack.status, 0, 255, 'Delivery ACK status');

  return [ack.status, ...encodeVarUint(ack.messageId)];
}

export function decodeDeliveryAckPayload(bytes: number[]): BushMeshDeliveryAck {
  assertBytes(bytes, 'delivery ACK payload');

  if (bytes.length < 2) {
    throw new Error('Delivery ACK payload is too short.');
  }

  const status = bytes[0];
  const messageId = decodeVarUint(bytes, 1);

  if (messageId.nextOffset !== bytes.length) {
    throw new Error('Unexpected bytes after delivery ACK payload.');
  }

  return {
    messageId: messageId.value,
    status,
  };
}

export function encodeBushMeshDeliveryAckWire(
  acknowledgedMessageId: number,
  ackPacketMessageId: number,
  status: BushMeshDeliveryAckStatus | number = BushMeshDeliveryAckStatus.Delivered,
): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Ack,
    priority: BushMeshPriority.DirectMessage,
    compression: BushMeshCompressionProfile.Command,
    messageId: ackPacketMessageId,
    ackRequested: false,
    storeAndForward: false,
    payload: encodeDeliveryAckPayload({
      messageId: acknowledgedMessageId,
      status,
    }),
  });
}
