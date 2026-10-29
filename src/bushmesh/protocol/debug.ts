import {BushMeshCompressionProfile, BushMeshPacketType} from './codec';
import {decodeFragment} from './fragmentation';
import {getBushMeshPacketDefinition} from './packetTypes';
import {decodeBushMeshTypedPacket} from './typedPackets';
import {decodeBushMeshWire} from './transport';

export type BushMeshPacketInspection = {
  hex: string;
  byteLength: number;
  version: number;
  packetType: number;
  packetTypeName: string;
  priority: number;
  compression: number;
  compressionName: string;
  messageId: number;
  ackRequested: boolean;
  storeAndForward: boolean;
  ttlHops: number | null;
  payloadByteLength: number;
  renderedText?: string;
  fragment?: {
    messageId: number;
    fragmentIndex: number;
    fragmentCount: number;
    dataByteLength: number;
  };
  typedKind?: string;
};

export function bytesToBushMeshHex(bytes: number[]): string {
  return bytes.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function humanizePacketName(name: string): string {
  return name
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function inspectBushMeshPacket(bytes: number[]): BushMeshPacketInspection {
  const decoded = decodeBushMeshWire(bytes);
  const envelope = decoded.envelope;
  const packetDefinition = getBushMeshPacketDefinition(envelope.type);
  const packetTypeName = packetDefinition
    ? humanizePacketName(packetDefinition.name)
    : `Unknown(${envelope.type})`;
  const compressionName =
    BushMeshCompressionProfile[envelope.compression as BushMeshCompressionProfile] ??
    `Unknown(${envelope.compression})`;

  const inspection: BushMeshPacketInspection = {
    hex: bytesToBushMeshHex(bytes),
    byteLength: bytes.length,
    version: envelope.version,
    packetType: envelope.type,
    packetTypeName,
    priority: envelope.priority,
    compression: envelope.compression,
    compressionName,
    messageId: envelope.messageId,
    ackRequested: envelope.ackRequested,
    storeAndForward: envelope.storeAndForward,
    ttlHops: envelope.ttlHops,
    payloadByteLength: envelope.payload.length,
    renderedText: decoded.renderedText,
  };

  if (envelope.type === BushMeshPacketType.Fragment) {
    const fragment = decodeFragment(envelope.payload);
    inspection.fragment = {
      messageId: fragment.messageId,
      fragmentIndex: fragment.fragmentIndex,
      fragmentCount: fragment.fragmentCount,
      dataByteLength: fragment.data.length,
    };
  }

  try {
    inspection.typedKind = decodeBushMeshTypedPacket(bytes).kind;
  } catch {
    // Inspection still remains useful for envelopes whose typed payload is malformed.
  }

  return inspection;
}

export function describeBushMeshPacket(bytes: number[]): string[] {
  const inspection = inspectBushMeshPacket(bytes);
  const lines = [
    `${inspection.packetTypeName} message #${inspection.messageId}`,
    `Bytes: ${inspection.byteLength} (payload ${inspection.payloadByteLength})`,
    `Priority ${inspection.priority}, compression ${inspection.compressionName}`,
    `ACK ${inspection.ackRequested ? 'requested' : 'not requested'}`,
  ];

  if (inspection.ttlHops !== null) {
    lines.push(`Store/forward TTL: ${inspection.ttlHops} hops`);
  }
  if (inspection.fragment) {
    lines.push(
      `Fragment ${inspection.fragment.fragmentIndex + 1}/${inspection.fragment.fragmentCount}`,
    );
  }
  if (inspection.renderedText) {
    lines.push(`Text: ${inspection.renderedText}`);
  }
  lines.push(`HEX: ${inspection.hex}`);
  return lines;
}
