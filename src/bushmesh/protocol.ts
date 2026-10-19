export const BUSHMESH_PROTOCOL_VERSION = 1;

/**
 * MeshCore reserves 0xFF00-0xFFFF for development/testing application data.
 * BushMesh uses 0xFF00 during development and should request a permanent
 * MeshCore allocation before a production release.
 */
export const BUSHMESH_MESHCORE_DEV_DATA_TYPE = 0xff00;

export enum BushMeshMessageType {
  Position = 0x01,
  QuickAction = 0x02,
}

export enum BushMeshQuickActionCode {
  Stop = 0x01,
  Hazard = 0x02,
  Regroup = 0x03,
  Fuel = 0x04,
  Ok = 0x05,
  Help = 0x06,
}

/**
 * Compact 48-bit Bushmesh identity reference, encoded as 12 hexadecimal
 * characters. This is intentionally small enough for LoRa while still giving
 * convoy packets a stable sender identity independent of display names.
 */
export type BushMeshIdentityRef = string;

export type BushMeshPosition = {
  senderId: BushMeshIdentityRef;
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

export type BushMeshQuickAction = {
  senderId: BushMeshIdentityRef;
  sequence: number;
  timestampSeconds: number;
  action: BushMeshQuickActionCode;
  latitude?: number | null;
  longitude?: number | null;
  ttlSeconds?: number;
  flags?: number;
};

export type DecodedBushMeshQuickAction = BushMeshQuickAction & {
  version: number;
  type: BushMeshMessageType.QuickAction;
  latitude: number | null;
  longitude: number | null;
  ttlSeconds: number;
};

const IDENTITY_REF_BYTES = 6;
const POSITION_PACKET_BYTES = 30;
const QUICK_ACTION_PACKET_BYTES = 26;
const UNKNOWN_ALTITUDE = 0x7fff;
const UNKNOWN_SPEED = 0xffff;
const UNKNOWN_HEADING = 0xffff;
const UNKNOWN_ACCURACY = 0xff;
const UNKNOWN_COORDINATE = -0x80000000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validateCoordinate(
  label: 'Latitude' | 'Longitude',
  value: number,
): void {
  const min = label === 'Latitude' ? -90 : -180;
  const max = label === 'Latitude' ? 90 : 180;

  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max} degrees.`);
  }
}

function identityRefToBytes(identityRef: BushMeshIdentityRef): number[] {
  const normalized = identityRef.replace(/[^0-9a-f]/gi, '').toUpperCase();

  if (!/^[0-9A-F]{12}$/.test(normalized)) {
    throw new Error(
      'BushMesh senderId must contain exactly 12 hexadecimal characters.',
    );
  }

  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}

function bytesToIdentityRef(bytes: Uint8Array, offset: number): string {
  return Array.from(bytes.slice(offset, offset + IDENTITY_REF_BYTES))
    .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('');
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
  validateCoordinate('Latitude', position.latitude);
  validateCoordinate('Longitude', position.longitude);

  const bytes: number[] = [
    BUSHMESH_PROTOCOL_VERSION,
    BushMeshMessageType.Position,
    position.flags ?? 0,
    ...identityRefToBytes(position.senderId),
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
      ? UNKNOWN_SPEED
      : clamp(Math.round(position.speedKmh * 10), 0, UNKNOWN_SPEED - 1);
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
    throw new Error(
      `Packet is not a BushMesh position message: ${payload[1]}.`,
    );
  }

  const altitudeRaw = readInt16LE(payload, 23);
  const speedRaw = readUInt16LE(payload, 25);
  const headingRaw = readUInt16LE(payload, 27);
  const accuracyRaw = payload[29];

  return {
    version: payload[0],
    type: BushMeshMessageType.Position,
    flags: payload[2],
    senderId: bytesToIdentityRef(payload, 3),
    sequence: readUInt16LE(payload, 9),
    timestampSeconds: readUInt32LE(payload, 11),
    latitude: readInt32LE(payload, 15) / 1e7,
    longitude: readInt32LE(payload, 19) / 1e7,
    altitudeMeters: altitudeRaw === UNKNOWN_ALTITUDE ? null : altitudeRaw,
    speedKmh: speedRaw === UNKNOWN_SPEED ? null : speedRaw / 10,
    headingDegrees:
      headingRaw === UNKNOWN_HEADING ? null : headingRaw / 100,
    accuracyMeters:
      accuracyRaw === UNKNOWN_ACCURACY ? null : accuracyRaw,
  };
}

export function encodeBushMeshQuickAction(
  message: BushMeshQuickAction,
): Uint8Array {
  const hasLatitude = message.latitude != null;
  const hasLongitude = message.longitude != null;

  if (hasLatitude !== hasLongitude) {
    throw new Error(
      'BushMesh quick actions must include both latitude and longitude or neither.',
    );
  }

  if (hasLatitude && hasLongitude) {
    validateCoordinate('Latitude', message.latitude as number);
    validateCoordinate('Longitude', message.longitude as number);
  }

  if (!Object.values(BushMeshQuickActionCode).includes(message.action)) {
    throw new Error(`Unsupported BushMesh quick action ${message.action}.`);
  }

  const bytes: number[] = [
    BUSHMESH_PROTOCOL_VERSION,
    BushMeshMessageType.QuickAction,
    message.flags ?? 0,
    ...identityRefToBytes(message.senderId),
  ];

  writeUInt16LE(bytes, message.sequence);
  writeUInt32LE(bytes, message.timestampSeconds);
  bytes.push(message.action);

  writeInt32LE(
    bytes,
    hasLatitude
      ? Math.round((message.latitude as number) * 1e7)
      : UNKNOWN_COORDINATE,
  );
  writeInt32LE(
    bytes,
    hasLongitude
      ? Math.round((message.longitude as number) * 1e7)
      : UNKNOWN_COORDINATE,
  );
  writeUInt16LE(bytes, clamp(message.ttlSeconds ?? 0, 0, 0xffff));

  return Uint8Array.from(bytes);
}

export function decodeBushMeshQuickAction(
  payload: Uint8Array,
): DecodedBushMeshQuickAction {
  if (payload.length !== QUICK_ACTION_PACKET_BYTES) {
    throw new Error(
      `Invalid BushMesh quick-action packet length ${payload.length}; expected ${QUICK_ACTION_PACKET_BYTES}.`,
    );
  }

  if (payload[0] !== BUSHMESH_PROTOCOL_VERSION) {
    throw new Error(`Unsupported BushMesh protocol version ${payload[0]}.`);
  }

  if (payload[1] !== BushMeshMessageType.QuickAction) {
    throw new Error(
      `Packet is not a BushMesh quick-action message: ${payload[1]}.`,
    );
  }

  const action = payload[15] as BushMeshQuickActionCode;
  if (!Object.values(BushMeshQuickActionCode).includes(action)) {
    throw new Error(`Unsupported BushMesh quick action ${action}.`);
  }

  const latitudeRaw = readInt32LE(payload, 16);
  const longitudeRaw = readInt32LE(payload, 20);
  const hasLocation =
    latitudeRaw !== UNKNOWN_COORDINATE && longitudeRaw !== UNKNOWN_COORDINATE;

  if (
    (latitudeRaw === UNKNOWN_COORDINATE) !==
    (longitudeRaw === UNKNOWN_COORDINATE)
  ) {
    throw new Error('BushMesh quick-action location is incomplete.');
  }

  return {
    version: payload[0],
    type: BushMeshMessageType.QuickAction,
    flags: payload[2],
    senderId: bytesToIdentityRef(payload, 3),
    sequence: readUInt16LE(payload, 9),
    timestampSeconds: readUInt32LE(payload, 11),
    action,
    latitude: hasLocation ? latitudeRaw / 1e7 : null,
    longitude: hasLocation ? longitudeRaw / 1e7 : null,
    ttlSeconds: readUInt16LE(payload, 24),
  };
}
