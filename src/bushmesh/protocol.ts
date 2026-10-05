export const BUSHMESH_PROTOCOL_VERSION = 1;

/**
 * MeshCore reserves 0xFF00-0xFFFF for development/testing application data.
 * BushMesh uses 0xFF00 during development and should request a permanent
 * MeshCore allocation before a production release.
 */
export const BUSHMESH_MESHCORE_DEV_DATA_TYPE = 0xff00;

export enum BushMeshMessageType {
  Position = 0x01,
}

export type BushMeshPosition = {
  sequence: number;
  timestampSeconds: number;
  latitude: number;
  longitude: number;
  altitudeMeters?: number | null;
  speedKmh?: number | null;
  headingDegrees?: number | null;
  accuracyMeters?: number | null;
  flags?: number;
};

export type DecodedBushMeshPosition = BushMeshPosition & {
  version: number;
  type: BushMeshMessageType.Position;
};

const POSITION_PACKET_BYTES = 24;
const UNKNOWN_ALTITUDE = 0x7fff;
const UNKNOWN_HEADING = 0xffff;
const UNKNOWN_ACCURACY = 0xff;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function writeUInt16LE(bytes: number[], value: number): void {
  const safe = value & 0xffff;
  bytes.push(safe & 0xff, (safe >>> 8) & 0xff);
}

function writeInt16LE(bytes: number[], value: number): void {
  writeUInt16LE(bytes, value & 0xffff);
}

function writeUInt32LE(bytes: number[], value: number): void {
  const safe = value >>> 0;
  bytes.push(
    safe & 0xff,
    (safe >>> 8) & 0xff,
    (safe >>> 16) & 0xff,
    (safe >>> 24) & 0xff,
  );
}

function writeInt32LE(bytes: number[], value: number): void {
  writeUInt32LE(bytes, value >>> 0);
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readInt16LE(bytes: Uint8Array, offset: number): number {
  const value = readUInt16LE(bytes, offset);
  return value > 0x7fff ? value - 0x10000 : value;
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readInt32LE(bytes: Uint8Array, offset: number): number {
  const value = readUInt32LE(bytes, offset);
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

export function encodeBushMeshPosition(position: BushMeshPosition): Uint8Array {
  if (
    !Number.isFinite(position.latitude) ||
    position.latitude < -90 ||
    position.latitude > 90
  ) {
    throw new Error('Latitude must be between -90 and 90 degrees.');
  }

  if (
    !Number.isFinite(position.longitude) ||
    position.longitude < -180 ||
    position.longitude > 180
  ) {
    throw new Error('Longitude must be between -180 and 180 degrees.');
  }

  const bytes: number[] = [
    BUSHMESH_PROTOCOL_VERSION,
    BushMeshMessageType.Position,
    position.flags ?? 0,
  ];

  writeUInt16LE(bytes, position.sequence);
  writeUInt32LE(bytes, position.timestampSeconds);
  writeInt32LE(bytes, Math.round(position.latitude * 1e7));
  writeInt32LE(bytes, Math.round(position.longitude * 1e7));

  const altitude =
    position.altitudeMeters == null
      ? UNKNOWN_ALTITUDE
      : clamp(Math.round(position.altitudeMeters), -32768, 32766);
  writeInt16LE(bytes, altitude);

  const speedDeciKmh =
    position.speedKmh == null
      ? 0
      : clamp(Math.round(position.speedKmh * 10), 0, 0xffff);
  writeUInt16LE(bytes, speedDeciKmh);

  const headingCentidegrees =
    position.headingDegrees == null
      ? UNKNOWN_HEADING
      : clamp(Math.round(position.headingDegrees * 100), 0, 35999);
  writeUInt16LE(bytes, headingCentidegrees);

  const accuracy =
    position.accuracyMeters == null
      ? UNKNOWN_ACCURACY
      : clamp(Math.round(position.accuracyMeters), 0, 254);
  bytes.push(accuracy);

  return Uint8Array.from(bytes);
}

export function decodeBushMeshPosition(
  payload: Uint8Array,
): DecodedBushMeshPosition {
  if (payload.length !== POSITION_PACKET_BYTES) {
    throw new Error(
      `Invalid BushMesh position packet length ${payload.length}; expected ${POSITION_PACKET_BYTES}.`,
    );
  }

  if (payload[0] !== BUSHMESH_PROTOCOL_VERSION) {
    throw new Error(`Unsupported BushMesh protocol version ${payload[0]}.`);
  }

  if (payload[1] !== BushMeshMessageType.Position) {
    throw new Error(`Packet is not a BushMesh position message: ${payload[1]}.`);
  }

  const altitudeRaw = readInt16LE(payload, 17);
  const speedRaw = readUInt16LE(payload, 19);
  const headingRaw = readUInt16LE(payload, 21);
  const accuracyRaw = payload[23];

  return {
    version: payload[0],
    type: BushMeshMessageType.Position,
    flags: payload[2],
    sequence: readUInt16LE(payload, 3),
    timestampSeconds: readUInt32LE(payload, 5),
    latitude: readInt32LE(payload, 9) / 1e7,
    longitude: readInt32LE(payload, 13) / 1e7,
    altitudeMeters: altitudeRaw === UNKNOWN_ALTITUDE ? null : altitudeRaw,
    speedKmh: speedRaw / 10,
    headingDegrees:
      headingRaw === UNKNOWN_HEADING ? null : headingRaw / 100,
    accuracyMeters:
      accuracyRaw === UNKNOWN_ACCURACY ? null : accuracyRaw,
  };
}
