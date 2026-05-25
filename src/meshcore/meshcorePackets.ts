import {Buffer} from 'buffer';

export type MeshCorePacketInfo = {
  packetType: number | null;
  label: string;
  hex: string;
  byteLength: number;
};

const PACKET_LABELS: Record<number, string> = {
  0x05: 'PACKET_SELF_INFO',
  0x06: 'PACKET_MSG_SENT',
  0x0d: 'PACKET_DEVICE_INFO',
  0x12: 'PACKET_CHANNEL_INFO',
};

export function base64ToBytes(value: string): number[] {
  return Array.from(Buffer.from(value, 'base64'));
}

export function bytesToHex(bytes: number[]): string {
  return bytes
    .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

export function decodeMeshCoreBytes(bytes: number[]): MeshCorePacketInfo {
  const packetType = bytes.length > 0 ? bytes[0] : null;
  const hex = bytesToHex(bytes);

  if (packetType === null) {
    return {
      packetType: null,
      label: 'EMPTY_PACKET',
      hex,
      byteLength: 0,
    };
  }

  return {
    packetType,
    label:
      PACKET_LABELS[packetType] ??
      `UNKNOWN_PACKET_0x${packetType
        .toString(16)
        .padStart(2, '0')
        .toUpperCase()}`,
    hex,
    byteLength: bytes.length,
  };
}

export function decodeMeshCorePacket(base64Value: string): MeshCorePacketInfo {
  return decodeMeshCoreBytes(base64ToBytes(base64Value));
}