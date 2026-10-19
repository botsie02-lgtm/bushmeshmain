import {Buffer} from 'buffer';

import {
  DecodedBushMeshWireMessage,
  tryDecodeBushMeshChannelPayload,
} from '../bushmesh/protocol';

export type MeshCoreBushMeshChannelFrame = {
  channelIndex: number;
  pathLength: number;
  textType: number;
  timestamp: number | null;
  payloadBytes: number[];
  decoded: DecodedBushMeshWireMessage;
};

function readUInt32LE(bytes: number[], offset: number): number | null {
  if (bytes.length < offset + 4) {
    return null;
  }

  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

export function tryDecodeBushMeshChannelFrame(
  bytes: number[],
): MeshCoreBushMeshChannelFrame | null {
  const packetType = bytes[0];

  if (packetType !== 0x08 && packetType !== 0x11) {
    return null;
  }

  const isV3 = packetType === 0x11;
  const offset = isV3 ? 4 : 1;

  if (bytes.length < offset + 7) {
    return null;
  }

  const channelIndex = bytes[offset];
  const pathLength = bytes[offset + 1];
  const textType = bytes[offset + 2];
  const timestamp = readUInt32LE(bytes, offset + 3);
  const payloadBytes = bytes.slice(offset + 7);
  const text = Buffer.from(payloadBytes)
    .toString('utf8')
    .replace(/\0/g, '')
    .trim();
  const decoded = tryDecodeBushMeshChannelPayload(payloadBytes, text);

  if (!decoded) {
    return null;
  }

  return {
    channelIndex,
    pathLength,
    textType,
    timestamp,
    payloadBytes,
    decoded,
  };
}
