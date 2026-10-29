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
  LocationDelta,
  decodeLocationPayload,
  encodeLocationPayload,
} from './location';

export enum BushMeshConvoyRole {
  Lead = 0,
  Member = 1,
  Tail = 2,
  Recovery = 3,
  Support = 4,
}

export type BushMeshConvoyStatus = {
  convoyId: number;
  nodeId: number;
  sequence: number;
  orderIndex: number;
  role: BushMeshConvoyRole | number;
  location?: CompactLocation;
  locationDelta?: LocationDelta;
  /** Explicitly invalidates a previously known location until a new absolute fix arrives. */
  locationUnavailable?: boolean;
  speedKph?: number;
  headingDegrees?: number;
  batteryPercent?: number;
  stopped?: boolean;
  hazard?: boolean;
};

const FLAG_LOCATION = 1 << 0;
const FLAG_SPEED = 1 << 1;
const FLAG_HEADING = 1 << 2;
const FLAG_BATTERY = 1 << 3;
const FLAG_STOPPED = 1 << 4;
const FLAG_HAZARD = 1 << 5;
const FLAG_LOCATION_DELTA = 1 << 6;
const FLAG_LOCATION_UNAVAILABLE = 1 << 7;

const EARTH_RADIUS_METRES = 6_371_000;
const METRES_PER_DEGREE_LATITUDE = (Math.PI * EARTH_RADIUS_METRES) / 180;

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function normaliseLongitude(longitude: number): number {
  let normalised = longitude;
  while (normalised > 180) {
    normalised -= 360;
  }
  while (normalised < -180) {
    normalised += 360;
  }
  return normalised;
}

function longitudeDeltaDegrees(from: number, to: number): number {
  let delta = to - from;
  while (delta > 180) {
    delta -= 360;
  }
  while (delta < -180) {
    delta += 360;
  }
  return delta;
}

/**
 * Returns a compact north/east displacement suitable for convoy heartbeats.
 * The calculation is intentionally local-planar because deltas are only used
 * between nearby periodic absolute GPS anchors.
 */
export function convoyLocationDelta(
  from: CompactLocation,
  to: CompactLocation,
): LocationDelta {
  const averageLatitude = radians((from.latitude + to.latitude) / 2);
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.max(0.01, Math.abs(Math.cos(averageLatitude)));

  return {
    northMetres: Math.round(
      (to.latitude - from.latitude) * METRES_PER_DEGREE_LATITUDE,
    ),
    eastMetres: Math.round(
      longitudeDeltaDegrees(from.longitude, to.longitude) *
        metresPerDegreeLongitude,
    ),
  };
}

/** Reconstructs a coordinate from a previously known convoy position. */
export function applyConvoyLocationDelta(
  base: CompactLocation,
  delta: LocationDelta,
): CompactLocation {
  const latitude =
    base.latitude + delta.northMetres / METRES_PER_DEGREE_LATITUDE;
  const latitudeForLongitude = radians(
    Math.max(-89.9, Math.min(89.9, (base.latitude + latitude) / 2)),
  );
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.max(0.01, Math.abs(Math.cos(latitudeForLongitude)));

  return {
    latitude: Math.max(-90, Math.min(90, latitude)),
    longitude: normaliseLongitude(
      base.longitude + delta.eastMetres / metresPerDegreeLongitude,
    ),
    precision: base.precision,
  };
}

export function encodeConvoyStatus(status: BushMeshConvoyStatus): number[] {
  assertIntegerInRange(status.convoyId, 0, 0xffffffff, 'Convoy ID');
  assertIntegerInRange(status.nodeId, 0, 0xffffffff, 'Convoy node ID');
  assertIntegerInRange(status.sequence, 0, 0xffffffff, 'Convoy sequence');
  assertIntegerInRange(status.orderIndex, 0, 0xffff, 'Convoy order index');
  assertIntegerInRange(status.role, 0, 7, 'Convoy role');

  if (status.location && status.locationDelta) {
    throw new Error('Convoy status cannot contain both absolute and delta location.');
  }
  if (status.locationUnavailable && (status.location || status.locationDelta)) {
    throw new Error(
      'Convoy status cannot mark location unavailable while carrying location data.',
    );
  }

  let flags = 0;
  const optional: number[] = [];

  if (status.location) {
    flags |= FLAG_LOCATION;
    const locationBytes = encodeLocationPayload({
      ...status.location,
      batteryPercent: undefined,
    });
    optional.push(locationBytes.length, ...locationBytes);
  } else if (status.locationDelta) {
    flags |= FLAG_LOCATION_DELTA;
    optional.push(
      ...encodeSignedVarInt(status.locationDelta.northMetres),
      ...encodeSignedVarInt(status.locationDelta.eastMetres),
    );
  } else if (status.locationUnavailable) {
    flags |= FLAG_LOCATION_UNAVAILABLE;
  }

  if (status.speedKph !== undefined) {
    if (!Number.isFinite(status.speedKph) || status.speedKph < 0 || status.speedKph > 6553.5) {
      throw new Error('Convoy speed must be from 0 to 6553.5 km/h.');
    }
    flags |= FLAG_SPEED;
    optional.push(...encodeVarUint(Math.round(status.speedKph * 10)));
  }

  if (status.headingDegrees !== undefined) {
    if (
      !Number.isFinite(status.headingDegrees) ||
      status.headingDegrees < 0 ||
      status.headingDegrees >= 360
    ) {
      throw new Error('Convoy heading must be from 0 to less than 360 degrees.');
    }
    flags |= FLAG_HEADING;
    optional.push(...encodeVarUint(Math.round(status.headingDegrees)));
  }

  if (status.batteryPercent !== undefined) {
    assertIntegerInRange(status.batteryPercent, 0, 100, 'Convoy battery percentage');
    flags |= FLAG_BATTERY;
    optional.push(status.batteryPercent);
  }

  if (status.stopped) {
    flags |= FLAG_STOPPED;
  }
  if (status.hazard) {
    flags |= FLAG_HAZARD;
  }

  return [
    ...encodeVarUint(status.convoyId),
    ...encodeVarUint(status.nodeId),
    ...encodeVarUint(status.sequence),
    ...encodeVarUint(status.orderIndex),
    status.role & 0x07,
    flags,
    ...optional,
  ];
}

export function decodeConvoyStatus(bytes: number[]): BushMeshConvoyStatus {
  assertBytes(bytes, 'convoy status');

  const convoyId = decodeVarUint(bytes, 0);
  const nodeId = decodeVarUint(bytes, convoyId.nextOffset);
  const sequence = decodeVarUint(bytes, nodeId.nextOffset);
  const orderIndex = decodeVarUint(bytes, sequence.nextOffset);
  let cursor = orderIndex.nextOffset;

  const role = bytes[cursor];
  const flags = bytes[cursor + 1];
  if (role === undefined || flags === undefined) {
    throw new Error('Convoy status header is truncated.');
  }
  if (role > 7) {
    throw new Error('Convoy status contains an invalid role.');
  }
  if ((flags & FLAG_LOCATION) !== 0 && (flags & FLAG_LOCATION_DELTA) !== 0) {
    throw new Error('Convoy status contains both absolute and delta location.');
  }
  if (
    (flags & FLAG_LOCATION_UNAVAILABLE) !== 0 &&
    ((flags & FLAG_LOCATION) !== 0 || (flags & FLAG_LOCATION_DELTA) !== 0)
  ) {
    throw new Error('Convoy status marks location unavailable while carrying location data.');
  }
  cursor += 2;

  let location: CompactLocation | undefined;
  let locationDelta: LocationDelta | undefined;
  let speedKph: number | undefined;
  let headingDegrees: number | undefined;
  let batteryPercent: number | undefined;

  if ((flags & FLAG_LOCATION) !== 0) {
    const length = bytes[cursor];
    if (length === undefined || length < 7 || cursor + 1 + length > bytes.length) {
      throw new Error('Convoy location payload is truncated.');
    }
    cursor += 1;
    const decoded = decodeLocationPayload(bytes.slice(cursor, cursor + length));
    location = {
      latitude: decoded.latitude,
      longitude: decoded.longitude,
      precision: decoded.precision,
    };
    cursor += length;
  } else if ((flags & FLAG_LOCATION_DELTA) !== 0) {
    const north = decodeSignedVarInt(bytes, cursor);
    const east = decodeSignedVarInt(bytes, north.nextOffset);
    locationDelta = {
      northMetres: north.value,
      eastMetres: east.value,
    };
    cursor = east.nextOffset;
  }

  if ((flags & FLAG_SPEED) !== 0) {
    const speed = decodeVarUint(bytes, cursor);
    speedKph = speed.value / 10;
    cursor = speed.nextOffset;
  }

  if ((flags & FLAG_HEADING) !== 0) {
    const heading = decodeVarUint(bytes, cursor);
    if (heading.value >= 360) {
      throw new Error('Convoy heading is invalid.');
    }
    headingDegrees = heading.value;
    cursor = heading.nextOffset;
  }

  if ((flags & FLAG_BATTERY) !== 0) {
    const battery = bytes[cursor];
    if (battery === undefined || battery > 100) {
      throw new Error('Convoy battery percentage is invalid.');
    }
    batteryPercent = battery;
    cursor += 1;
  }

  if (cursor !== bytes.length) {
    throw new Error('Unexpected bytes after convoy status.');
  }

  const status: BushMeshConvoyStatus = {
    convoyId: convoyId.value,
    nodeId: nodeId.value,
    sequence: sequence.value,
    orderIndex: orderIndex.value,
    role,
    location,
    locationDelta,
    speedKph,
    headingDegrees,
    batteryPercent,
    stopped: (flags & FLAG_STOPPED) !== 0,
    hazard: (flags & FLAG_HAZARD) !== 0,
  };

  if ((flags & FLAG_LOCATION_UNAVAILABLE) !== 0) {
    status.locationUnavailable = true;
  }

  return status;
}
