export type MeshCoreSendAccepted = {
  route: 'direct' | 'flood' | 'unknown';
  expectedAckHex: string;
  suggestedTimeoutMs: number | null;
};

export type MeshCoreSendConfirmed = {
  ackHex: string;
  roundTripMs: number | null;
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

function readHex(bytes: number[], offset: number, length: number): string | null {
  if (bytes.length < offset + length) {
    return null;
  }

  return bytes
    .slice(offset, offset + length)
    .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

/**
 * Parses MeshCore RESP_CODE_SENT / PACKET_MSG_SENT (0x06).
 *
 * This means the companion accepted the outbound message and supplied an ACK
 * tag to watch for. It does not by itself prove the peer received the message.
 */
export function parseMeshCoreSendAccepted(
  bytes: number[] | Uint8Array,
): MeshCoreSendAccepted | null {
  const packet = Array.from(bytes);
  if (packet[0] !== 0x06) {
    return null;
  }

  const expectedAckHex = readHex(packet, 2, 4);
  if (packet.length < 6 || expectedAckHex === null) {
    throw new Error('MeshCore PACKET_MSG_SENT is too short for its ACK tag.');
  }

  return {
    route: packet[1] === 0 ? 'direct' : packet[1] === 1 ? 'flood' : 'unknown',
    expectedAckHex,
    suggestedTimeoutMs: readUInt32LE(packet, 6),
  };
}

/**
 * Parses MeshCore PUSH_CODE_SEND_CONFIRMED / PACKET_ACK (0x82).
 */
export function parseMeshCoreSendConfirmed(
  bytes: number[] | Uint8Array,
): MeshCoreSendConfirmed | null {
  const packet = Array.from(bytes);
  if (packet[0] !== 0x82) {
    return null;
  }

  const ackHex = readHex(packet, 1, 4);
  if (packet.length < 5 || ackHex === null) {
    throw new Error('MeshCore PACKET_ACK is too short for its ACK tag.');
  }

  return {
    ackHex,
    roundTripMs: readUInt32LE(packet, 5),
  };
}
