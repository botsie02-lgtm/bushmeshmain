import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
} from './codec';
import {FragmentAck, decodeFragmentAck, encodeFragmentAck} from './fragmentation';
import {
  BushMeshDeliveryAck,
  BushMeshDeliveryAckStatus,
  decodeDeliveryAckPayload,
  encodeDeliveryAckPayload,
} from './messageAck';
import {decodeBushMeshWire, encodeBushMeshWire} from './transport';

export type BushMeshAckPacket =
  | {kind: 'fragment'; value: FragmentAck}
  | {kind: 'delivery'; value: BushMeshDeliveryAck};

/**
 * ACK (0x0C) has two v1 schemas. The compression field is the discriminator:
 * Raw => selective fragment bitmap; Command => whole-message delivery status.
 */
export function decodeBushMeshAckWire(wireBytes: number[]): BushMeshAckPacket {
  const decoded = decodeBushMeshWire(wireBytes);
  if (decoded.envelope.type !== BushMeshPacketType.Ack) {
    throw new Error('BushMesh ACK decoder expected packet type ACK.');
  }

  if (decoded.envelope.compression === BushMeshCompressionProfile.Raw) {
    return {
      kind: 'fragment',
      value: decodeFragmentAck(decoded.envelope.payload),
    };
  }

  if (decoded.envelope.compression === BushMeshCompressionProfile.Command) {
    return {
      kind: 'delivery',
      value: decodeDeliveryAckPayload(decoded.envelope.payload),
    };
  }

  throw new Error(
    `Unsupported BushMesh ACK compression discriminator ${decoded.envelope.compression}.`,
  );
}

export function encodeBushMeshFragmentAckWire(
  messageId: number,
  fragmentCount: number,
  receivedFragments: number[],
): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Ack,
    priority: BushMeshPriority.DirectMessage,
    compression: BushMeshCompressionProfile.Raw,
    messageId,
    ackRequested: false,
    payload: encodeFragmentAck(messageId, fragmentCount, receivedFragments),
  });
}

export function encodeBushMeshDeliveryAckPacketWire(
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
