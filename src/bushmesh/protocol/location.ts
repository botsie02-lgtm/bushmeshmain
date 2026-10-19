import {
  assertBytes,
  assertIntegerInRange,
  decodeSignedVarInt,
  encodeSignedVarInt,
} from './codec';

export enum LocationPrecision {
  Approx1Km = 0,
  Approx100M = 1,
  Approx10M = 2,
  Approx1M = 3,
}

export type CompactLocation = {
  latitude: number;
  longitude: number;
  precision?: LocationPrecision;
  batteryPercent?: number;
};

export type LocationDelta = {
  northMetres: number;
  eastMetres: number;
};

const MAX_U24 = 0xffffff;
const LOCATION_CLEAR_BITS: Record<LocationPrecision, number> = {
  [LocationPrecision.Approx1Km]: 10,
  [LocationPrecision.Approx100M]: 7,
  [LocationPrecision.Approx10M]: 3,
  [LocationPrecision.Approx1M]: 0,
};

function quantizeU24(value: number, clearBits: number): number {
  if (clearBits === 0) {
    return value;
  }

  const quantum = 2 ** clearBits;
  return Math.max(0, Math.min(MAX_U24, Math.round(value / quantum) * quantum));
}

function writeUInt24BE(value: number): number[] {
  assertIntegerInRange(value, 0, MAX_U24, 'UInt24 value');
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function readUInt24BE(bytes: number[], offset: number): number {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];

  if (a === undefined || b === undefined || c === undefined) {
    throw new Error('Truncated UInt24.');
  }

  return a * 65536 + b * 256 + c;
}

function encodeLatitude(latitude: number): number {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('Latitude must be from -90 to 90 degrees.');
  }

  return Math.round(((latitude + 90) / 180) * MAX_U24);
}

function encodeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('Longitude must be from -180 to 180 degrees.');
  }

  return Math.round(((longitude + 180) / 360) * MAX_U24);
}

export function encodeLocationPayload(location: CompactLocation): number[] {
  const precision = location.precision ?? LocationPrecision.Approx10M;
  assertIntegerInRange(precision, 0, 3, 'Location precision');

  const batteryPresent = location.batteryPercent !== undefined;

  if (batteryPresent) {
    assertIntegerInRange(location.batteryPercent!, 0, 100, 'Battery percent');
  }

  const clearBits = LOCATION_CLEAR_BITS[precision];
  const latitude = quantizeU24(encodeLatitude(location.latitude), clearBits);
  const longitude = quantizeU24(encodeLongitude(location.longitude), clearBits);
  const flags = (precision << 6) | (batteryPresent ? 0x20 : 0);
  const payload = [
    flags,
    ...writeUInt24BE(latitude),
    ...writeUInt24BE(longitude),
  ];

  if (batteryPresent) {
    payload.push(location.batteryPercent! & 0x7f);
  }

  return payload;
}

export function decodeLocationPayload(bytes: number[]): {
  latitude: number;
  longitude: number;
  precision: LocationPrecision;
  batteryPercent: number | null;
} {
  assertBytes(bytes);

  if (bytes.length < 7) {
    throw new Error('Compact location payload is too short.');
  }

  const flags = bytes[0];
  const precision = (flags >> 6) & 0x03;
  const batteryPresent = (flags & 0x20) !== 0;
  const latitude = (readUInt24BE(bytes, 1) / MAX_U24) * 180 - 90;
  const longitude = (readUInt24BE(bytes, 4) / MAX_U24) * 360 - 180;
  const batteryPercent = batteryPresent ? bytes[7] : null;

  if (batteryPresent && batteryPercent === undefined) {
    throw new Error('Location payload says battery is present but it is missing.');
  }

  if (batteryPercent !== null && batteryPercent > 100) {
    throw new Error('Location payload contains invalid battery percentage.');
  }

  return {latitude, longitude, precision, batteryPercent};
}

export function encodeLocationDelta(delta: LocationDelta): number[] {
  return [
    ...encodeSignedVarInt(delta.northMetres),
    ...encodeSignedVarInt(delta.eastMetres),
  ];
}

export function decodeLocationDelta(bytes: number[]): LocationDelta {
  const north = decodeSignedVarInt(bytes, 0);
  const east = decodeSignedVarInt(bytes, north.nextOffset);

  if (east.nextOffset !== bytes.length) {
    throw new Error('Unexpected bytes after location delta.');
  }

  return {northMetres: north.value, eastMetres: east.value};
}
