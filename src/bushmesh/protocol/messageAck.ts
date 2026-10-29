import {
  assertBytes,
  assertIntegerInRange,
  decodeVarUint,
  encodeVarUint,
} from './codec';

export enum BushMeshDeliveryAckStatus {
  Delivered = 0,
  Rejected = 1,
  Expired = 2,
}

export type BushMeshDeliveryAck = {
  messageId: number;
  status: BushMeshDeliveryAckStatus | number;
};

/** Payload codec for the delivery-ACK variant of packet type ACK (0x0c). */
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
