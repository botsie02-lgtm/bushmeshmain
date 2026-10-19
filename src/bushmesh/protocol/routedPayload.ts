import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
  assertBytes,
  assertIntegerInRange,
  decodeVarUint,
  encodeVarUint,
} from './codec';
import {decodeBushMeshWire, encodeBushMeshWire} from './transport';

export type BushMeshRoutedPayload = {
  sourceNodeId: number;
  destinationNodeId?: number;
  innerWireBytes: number[];
};

export function encodeRoutedPayload(payload: BushMeshRoutedPayload): number[] {
  assertIntegerInRange(payload.sourceNodeId, 0, 0xffffffff, 'Source node ID');
  if (payload.destinationNodeId !== undefined) {
    assertIntegerInRange(
      payload.destinationNodeId,
      0,
      0xffffffff,
      'Destination node ID',
    );
  }
  assertBytes(payload.innerWireBytes, 'routed inner wire bytes');
  decodeBushMeshWire(payload.innerWireBytes);

  const hasDestination = payload.destinationNodeId !== undefined;
  return [
    hasDestination ? 0x01 : 0x00,
    ...encodeVarUint(payload.sourceNodeId),
    ...(hasDestination ? encodeVarUint(payload.destinationNodeId!) : []),
    ...payload.innerWireBytes,
  ];
}

export function decodeRoutedPayload(bytes: number[]): BushMeshRoutedPayload {
  assertBytes(bytes, 'routed payload');

  if (bytes.length < 4) {
    throw new Error('Routed BushMesh payload is too short.');
  }

  const flags = bytes[0];
  const source = decodeVarUint(bytes, 1);
  let cursor = source.nextOffset;
  let destinationNodeId: number | undefined;

  if ((flags & 0x01) !== 0) {
    const destination = decodeVarUint(bytes, cursor);
    destinationNodeId = destination.value;
    cursor = destination.nextOffset;
  }

  const innerWireBytes = bytes.slice(cursor);
  if (innerWireBytes.length === 0) {
    throw new Error('Routed BushMesh payload has no inner packet.');
  }
  decodeBushMeshWire(innerWireBytes);

  return {
    sourceNodeId: source.value,
    destinationNodeId,
    innerWireBytes,
  };
}

export function encodeBushMeshRoutedWire(
  routed: BushMeshRoutedPayload,
  messageId: number,
  options?: {
    ttlHops?: number;
    priority?: BushMeshPriority | number;
  },
): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Routed,
    priority: options?.priority ?? BushMeshPriority.DirectMessage,
    compression: BushMeshCompressionProfile.CompressedBinary,
    messageId,
    ackRequested: false,
    storeAndForward: true,
    ttlHops: options?.ttlHops ?? 4,
    payload: encodeRoutedPayload(routed),
  });
}
