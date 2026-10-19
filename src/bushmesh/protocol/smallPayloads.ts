import {Buffer} from 'buffer';

import {
  assertBytes,
  assertIntegerInRange,
  decodeSignedVarInt,
  decodeVarUint,
  encodeSignedVarInt,
  encodeVarUint,
} from './codec';
import {
  CompactLocation,
  LocationPrecision,
  decodeLocationPayload,
  encodeLocationPayload,
} from './location';

const EARTH_RADIUS_METRES = 6371000;

export type BushMeshContactCard = {
  nodeId: number;
  name: string;
  role: number;
  location?: CompactLocation;
};

export function encodeContactCard(card: BushMeshContactCard): number[] {
  assertIntegerInRange(card.nodeId, 0, 0xffffffff, 'Contact node ID');
  assertIntegerInRange(card.role, 0, 15, 'Contact role');
  const nameBytes = Array.from(Buffer.from(card.name, 'utf8'));
  assertIntegerInRange(nameBytes.length, 1, 48, 'Contact name byte length');
  const hasLocation = card.location !== undefined;
  const flags = (card.role << 1) | (hasLocation ? 1 : 0);

  return [
    flags,
    ...encodeVarUint(card.nodeId),
    ...encodeVarUint(nameBytes.length),
    ...nameBytes,
    ...(hasLocation ? encodeLocationPayload(card.location!) : []),
  ];
}

export function decodeContactCard(bytes: number[]): BushMeshContactCard {
  assertBytes(bytes, 'contact card');
  const flags = bytes[0];
  if (flags === undefined) {
    throw new Error('Contact card is empty.');
  }
  const nodeId = decodeVarUint(bytes, 1);
  const nameLength = decodeVarUint(bytes, nodeId.nextOffset);
  if (nameLength.value < 1 || nameLength.value > 48) {
    throw new Error('Contact card name length is invalid.');
  }
  const nameStart = nameLength.nextOffset;
  const nameEnd = nameStart + nameLength.value;
  if (nameEnd > bytes.length) {
    throw new Error('Contact card name is truncated.');
  }

  const hasLocation = (flags & 0x01) !== 0;
  let location: CompactLocation | undefined;
  if (hasLocation) {
    const locationBytes = bytes.slice(nameEnd);
    const decoded = decodeLocationPayload(locationBytes);
    location = {
      latitude: decoded.latitude,
      longitude: decoded.longitude,
      precision: decoded.precision,
      batteryPercent: decoded.batteryPercent ?? undefined,
    };
  } else if (nameEnd !== bytes.length) {
    throw new Error('Unexpected bytes after contact card.');
  }

  return {
    nodeId: nodeId.value,
    name: Buffer.from(bytes.slice(nameStart, nameEnd)).toString('utf8'),
    role: (flags >> 1) & 0x0f,
    location,
  };
}

export type BushMeshRoutePoint = {
  latitude: number;
  longitude: number;
};

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function pointDelta(previous: BushMeshRoutePoint, current: BushMeshRoutePoint): {
  northMetres: number;
  eastMetres: number;
} {
  const previousLat = degreesToRadians(previous.latitude);
  const currentLat = degreesToRadians(current.latitude);
  const meanLat = (previousLat + currentLat) / 2;
  return {
    northMetres: Math.round((currentLat - previousLat) * EARTH_RADIUS_METRES),
    eastMetres: Math.round(
      degreesToRadians(current.longitude - previous.longitude) *
        Math.cos(meanLat) *
        EARTH_RADIUS_METRES,
    ),
  };
}

function applyPointDelta(
  previous: BushMeshRoutePoint,
  northMetres: number,
  eastMetres: number,
): BushMeshRoutePoint {
  const previousLatRadians = degreesToRadians(previous.latitude);
  return {
    latitude:
      previous.latitude +
      (northMetres / EARTH_RADIUS_METRES) * (180 / Math.PI),
    longitude:
      previous.longitude +
      (eastMetres /
        (EARTH_RADIUS_METRES * Math.max(0.000001, Math.cos(previousLatRadians)))) *
        (180 / Math.PI),
  };
}

export function encodeRoutePoints(
  points: BushMeshRoutePoint[],
  precision = LocationPrecision.Approx10M,
): number[] {
  assertIntegerInRange(points.length, 1, 255, 'Route point count');
  const first = encodeLocationPayload({
    latitude: points[0].latitude,
    longitude: points[0].longitude,
    precision,
  });
  const bytes = [...encodeVarUint(points.length), ...first];

  for (let index = 1; index < points.length; index += 1) {
    const delta = pointDelta(points[index - 1], points[index]);
    bytes.push(
      ...encodeSignedVarInt(delta.northMetres),
      ...encodeSignedVarInt(delta.eastMetres),
    );
  }
  return bytes;
}

export function decodeRoutePoints(bytes: number[]): BushMeshRoutePoint[] {
  assertBytes(bytes, 'route points');
  const count = decodeVarUint(bytes, 0);
  if (count.value < 1 || count.value > 255) {
    throw new Error('Route point count is invalid.');
  }
  const firstEnd = count.nextOffset + 7;
  if (firstEnd > bytes.length) {
    throw new Error('Route first point is truncated.');
  }
  const first = decodeLocationPayload(bytes.slice(count.nextOffset, firstEnd));
  const points: BushMeshRoutePoint[] = [
    {latitude: first.latitude, longitude: first.longitude},
  ];
  let cursor = firstEnd;

  for (let index = 1; index < count.value; index += 1) {
    const north = decodeSignedVarInt(bytes, cursor);
    const east = decodeSignedVarInt(bytes, north.nextOffset);
    points.push(applyPointDelta(points[index - 1], north.value, east.value));
    cursor = east.nextOffset;
  }

  if (cursor !== bytes.length) {
    throw new Error('Unexpected bytes after compact route points.');
  }
  return points;
}

export type BushMeshConfigEntry = {
  key: number;
  value: number[];
};

export function encodeConfigBundle(entries: BushMeshConfigEntry[]): number[] {
  assertIntegerInRange(entries.length, 0, 64, 'Config entry count');
  const bytes = [...encodeVarUint(entries.length)];
  for (const entry of entries) {
    assertIntegerInRange(entry.key, 0, 0xffff, 'Config key');
    assertBytes(entry.value, 'Config value');
    assertIntegerInRange(entry.value.length, 0, 255, 'Config value length');
    bytes.push(
      ...encodeVarUint(entry.key),
      ...encodeVarUint(entry.value.length),
      ...entry.value,
    );
  }
  return bytes;
}

export function decodeConfigBundle(bytes: number[]): BushMeshConfigEntry[] {
  assertBytes(bytes, 'config bundle');
  const count = decodeVarUint(bytes, 0);
  if (count.value > 64) {
    throw new Error('Config bundle contains too many entries.');
  }
  let cursor = count.nextOffset;
  const entries: BushMeshConfigEntry[] = [];
  for (let index = 0; index < count.value; index += 1) {
    const key = decodeVarUint(bytes, cursor);
    const length = decodeVarUint(bytes, key.nextOffset);
    if (length.value > 255) {
      throw new Error('Config value is too large.');
    }
    const end = length.nextOffset + length.value;
    if (end > bytes.length) {
      throw new Error('Config value is truncated.');
    }
    entries.push({key: key.value, value: bytes.slice(length.nextOffset, end)});
    cursor = end;
  }
  if (cursor !== bytes.length) {
    throw new Error('Unexpected bytes after config bundle.');
  }
  return entries;
}
