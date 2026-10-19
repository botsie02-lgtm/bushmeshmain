export const BUSHMESH_PROTOCOL_VERSION = 1;

export enum BushMeshPacketType {
  Message = 0x01,
  Location = 0x02,
  Distress = 0x03,
  Weather = 0x04,
  Battery = 0x05,
  DeviceInfo = 0x06,
  Ping = 0x07,
  Route = 0x08,
  File = 0x09,
  Command = 0x0a,
  Fragment = 0x0b,
  Ack = 0x0c,
  Sync = 0x0d,
  Routed = 0x0e,
}

export enum BushMeshPriority {
  Emergency = 0,
  DirectMessage = 1,
  Location = 2,
  Telemetry = 3,
  Background = 4,
}

export enum BushMeshCompressionProfile {
  Raw = 0,
  TextDictionary = 1,
  SensorDelta = 2,
  Gps = 3,
  Command = 4,
  Cbor = 5,
  CompressedBinary = 6,
  Semantic = 7,
}

export type BushMeshEnvelope = {
  version?: number;
  type: BushMeshPacketType | number;
  priority?: BushMeshPriority | number;
  compression?: BushMeshCompressionProfile | number;
  messageId: number;
  ackRequested?: boolean;
  storeAndForward?: boolean;
  ttlHops?: number;
  payload: number[];
};

export type DecodedBushMeshEnvelope = {
  version: number;
  type: number;
  priority: number;
  compression: number;
  messageId: number;
  ackRequested: boolean;
  storeAndForward: boolean;
  ttlHops: number | null;
  payload: number[];
  headerLength: number;
};

export function assertIntegerInRange(
  value: number,
  min: number,
  max: number,
  label: string,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
}

export function assertBytes(bytes: number[], label = 'bytes'): void {
  bytes.forEach((byte, index) => {
    if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
      throw new Error(`${label}[${index}] is not a valid byte.`);
    }
  });
}

export function encodeVarUint(value: number): number[] {
  assertIntegerInRange(value, 0, 0xffffffff, 'VarUint value');

  const bytes: number[] = [];
  let remaining = value;

  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);

    if (remaining > 0) {
      byte |= 0x80;
    }

    bytes.push(byte);
  } while (remaining > 0);

  return bytes;
}

export function decodeVarUint(
  bytes: number[],
  offset = 0,
): {value: number; nextOffset: number} {
  let value = 0;
  let multiplier = 1;
  let cursor = offset;

  for (let count = 0; count < 5; count += 1) {
    const byte = bytes[cursor];

    if (byte === undefined) {
      throw new Error('Truncated VarUint.');
    }

    value += (byte & 0x7f) * multiplier;
    cursor += 1;

    if ((byte & 0x80) === 0) {
      if (value > 0xffffffff) {
        throw new Error('VarUint exceeds uint32 range.');
      }

      return {value, nextOffset: cursor};
    }

    multiplier *= 128;
  }

  throw new Error('VarUint is too long.');
}

export function zigZagEncode(value: number): number {
  assertIntegerInRange(value, -0x80000000, 0x7fffffff, 'ZigZag value');
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

export function zigZagDecode(value: number): number {
  assertIntegerInRange(value, 0, 0xffffffff, 'ZigZag encoded value');
  return value % 2 === 0 ? value / 2 : -((value + 1) / 2);
}

export function encodeSignedVarInt(value: number): number[] {
  return encodeVarUint(zigZagEncode(value));
}

export function decodeSignedVarInt(
  bytes: number[],
  offset = 0,
): {value: number; nextOffset: number} {
  const decoded = decodeVarUint(bytes, offset);
  return {
    value: zigZagDecode(decoded.value),
    nextOffset: decoded.nextOffset,
  };
}

export function encodeEnvelope(envelope: BushMeshEnvelope): number[] {
  const version = envelope.version ?? BUSHMESH_PROTOCOL_VERSION;
  const priority = envelope.priority ?? BushMeshPriority.DirectMessage;
  const compression = envelope.compression ?? BushMeshCompressionProfile.Raw;
  const ackRequested = envelope.ackRequested ?? false;
  const storeAndForward = envelope.storeAndForward ?? false;

  assertIntegerInRange(version, 0, 3, 'Protocol version');
  assertIntegerInRange(envelope.type, 0, 0x3f, 'Packet type');
  assertIntegerInRange(priority, 0, 7, 'Priority');
  assertIntegerInRange(compression, 0, 7, 'Compression profile');
  assertBytes(envelope.payload, 'payload');

  const first = (version << 6) | envelope.type;
  const second =
    (priority << 5) |
    (compression << 2) |
    (ackRequested ? 0x02 : 0) |
    (storeAndForward ? 0x01 : 0);

  const bytes = [first, second, ...encodeVarUint(envelope.messageId)];

  if (storeAndForward) {
    const ttlHops = envelope.ttlHops ?? 3;
    assertIntegerInRange(ttlHops, 0, 255, 'TTL hops');
    bytes.push(ttlHops);
  }

  return [...bytes, ...envelope.payload];
}

export function decodeEnvelope(bytes: number[]): DecodedBushMeshEnvelope {
  assertBytes(bytes);

  if (bytes.length < 3) {
    throw new Error('Bushmesh envelope is too short.');
  }

  const first = bytes[0];
  const second = bytes[1];
  const messageId = decodeVarUint(bytes, 2);
  const storeAndForward = (second & 0x01) !== 0;
  let cursor = messageId.nextOffset;
  let ttlHops: number | null = null;

  if (storeAndForward) {
    const ttl = bytes[cursor];

    if (ttl === undefined) {
      throw new Error('Bushmesh store-and-forward envelope is missing TTL.');
    }

    ttlHops = ttl;
    cursor += 1;
  }

  return {
    version: first >> 6,
    type: first & 0x3f,
    priority: second >> 5,
    compression: (second >> 2) & 0x07,
    messageId: messageId.value,
    ackRequested: (second & 0x02) !== 0,
    storeAndForward,
    ttlHops,
    payload: bytes.slice(cursor),
    headerLength: cursor,
  };
}
