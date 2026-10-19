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

export enum BushMeshDistressType {
  General = 0,
  Medical = 1,
  Injury = 2,
  Fire = 3,
  Lost = 4,
  Vehicle = 5,
  NeedWater = 6,
  Flood = 7,
  Other = 15,
}

export type BushMeshDistress = {
  type: BushMeshDistressType | number;
  location?: Pick<CompactLocation, 'latitude' | 'longitude'> & {
    precision?: LocationPrecision;
  };
  batteryPercent?: number;
};

export function encodeDistressPayload(distress: BushMeshDistress): number[] {
  assertIntegerInRange(distress.type, 0, 15, 'Distress type');
  const hasLocation = distress.location !== undefined;
  const hasBattery = distress.batteryPercent !== undefined;

  if (hasBattery) {
    assertIntegerInRange(distress.batteryPercent!, 0, 100, 'Battery percentage');
  }

  const flags =
    distress.type | (hasLocation ? 0x10 : 0) | (hasBattery ? 0x20 : 0);
  const bytes = [flags];

  if (distress.location) {
    bytes.push(
      ...encodeLocationPayload({
        latitude: distress.location.latitude,
        longitude: distress.location.longitude,
        precision: distress.location.precision ?? LocationPrecision.Approx1M,
      }),
    );
  }

  if (hasBattery) {
    bytes.push(distress.batteryPercent!);
  }

  return bytes;
}

export function decodeDistressPayload(bytes: number[]): BushMeshDistress {
  assertBytes(bytes);

  if (bytes.length < 1) {
    throw new Error('Distress payload is empty.');
  }

  const flags = bytes[0];
  const hasLocation = (flags & 0x10) !== 0;
  const hasBattery = (flags & 0x20) !== 0;
  let cursor = 1;
  let location: BushMeshDistress['location'];

  if (hasLocation) {
    const locationBytes = bytes.slice(cursor, cursor + 7);

    if (locationBytes.length !== 7) {
      throw new Error('Distress location is truncated.');
    }

    const decoded = decodeLocationPayload(locationBytes);
    location = {
      latitude: decoded.latitude,
      longitude: decoded.longitude,
      precision: decoded.precision,
    };
    cursor += 7;
  }

  let batteryPercent: number | undefined;

  if (hasBattery) {
    batteryPercent = bytes[cursor];

    if (batteryPercent === undefined || batteryPercent > 100) {
      throw new Error('Distress battery percentage is invalid.');
    }

    cursor += 1;
  }

  if (cursor !== bytes.length) {
    throw new Error('Unexpected bytes after distress payload.');
  }

  return {
    type: flags & 0x0f,
    location,
    batteryPercent,
  };
}

export type BushMeshTelemetry = {
  batteryPercent?: number;
  batteryMillivolts?: number;
  temperatureC?: number;
  altitudeMetres?: number;
  speedMetresPerSecond?: number;
  headingDegrees?: number;
};

const TELEMETRY_BATTERY_PERCENT = 1 << 0;
const TELEMETRY_BATTERY_MV = 1 << 1;
const TELEMETRY_TEMPERATURE = 1 << 2;
const TELEMETRY_ALTITUDE = 1 << 3;
const TELEMETRY_SPEED = 1 << 4;
const TELEMETRY_HEADING = 1 << 5;

export function encodeTelemetryPayload(telemetry: BushMeshTelemetry): number[] {
  let flags = 0;
  const body: number[] = [];

  if (telemetry.batteryPercent !== undefined) {
    assertIntegerInRange(telemetry.batteryPercent, 0, 100, 'Battery percentage');
    flags |= TELEMETRY_BATTERY_PERCENT;
    body.push(telemetry.batteryPercent);
  }

  if (telemetry.batteryMillivolts !== undefined) {
    assertIntegerInRange(
      telemetry.batteryMillivolts,
      0,
      20000,
      'Battery millivolts',
    );
    flags |= TELEMETRY_BATTERY_MV;
    body.push(...encodeVarUint(telemetry.batteryMillivolts));
  }

  if (telemetry.temperatureC !== undefined) {
    if (!Number.isFinite(telemetry.temperatureC)) {
      throw new Error('Temperature must be finite.');
    }

    const deciC = Math.round(telemetry.temperatureC * 10);
    assertIntegerInRange(deciC, -1000, 2000, 'Temperature');
    flags |= TELEMETRY_TEMPERATURE;
    body.push(...encodeSignedVarInt(deciC));
  }

  if (telemetry.altitudeMetres !== undefined) {
    if (!Number.isFinite(telemetry.altitudeMetres)) {
      throw new Error('Altitude must be finite.');
    }

    const altitude = Math.round(telemetry.altitudeMetres);
    assertIntegerInRange(altitude, -1000, 20000, 'Altitude');
    flags |= TELEMETRY_ALTITUDE;
    body.push(...encodeSignedVarInt(altitude));
  }

  if (telemetry.speedMetresPerSecond !== undefined) {
    if (
      !Number.isFinite(telemetry.speedMetresPerSecond) ||
      telemetry.speedMetresPerSecond < 0
    ) {
      throw new Error('Speed must be finite and non-negative.');
    }

    const deciSpeed = Math.round(telemetry.speedMetresPerSecond * 10);
    assertIntegerInRange(deciSpeed, 0, 10000, 'Speed');
    flags |= TELEMETRY_SPEED;
    body.push(...encodeVarUint(deciSpeed));
  }

  if (telemetry.headingDegrees !== undefined) {
    const heading = Math.round(telemetry.headingDegrees);
    assertIntegerInRange(heading, 0, 359, 'Heading');
    flags |= TELEMETRY_HEADING;
    body.push(...encodeVarUint(heading));
  }

  return [flags, ...body];
}

export function decodeTelemetryPayload(bytes: number[]): BushMeshTelemetry {
  assertBytes(bytes);

  if (bytes.length < 1) {
    throw new Error('Telemetry payload is empty.');
  }

  const flags = bytes[0];
  let cursor = 1;
  const telemetry: BushMeshTelemetry = {};

  if ((flags & TELEMETRY_BATTERY_PERCENT) !== 0) {
    const battery = bytes[cursor];

    if (battery === undefined || battery > 100) {
      throw new Error('Telemetry battery percentage is invalid.');
    }

    telemetry.batteryPercent = battery;
    cursor += 1;
  }

  if ((flags & TELEMETRY_BATTERY_MV) !== 0) {
    const decoded = decodeVarUint(bytes, cursor);
    telemetry.batteryMillivolts = decoded.value;
    cursor = decoded.nextOffset;
  }

  if ((flags & TELEMETRY_TEMPERATURE) !== 0) {
    const decoded = decodeSignedVarInt(bytes, cursor);
    telemetry.temperatureC = decoded.value / 10;
    cursor = decoded.nextOffset;
  }

  if ((flags & TELEMETRY_ALTITUDE) !== 0) {
    const decoded = decodeSignedVarInt(bytes, cursor);
    telemetry.altitudeMetres = decoded.value;
    cursor = decoded.nextOffset;
  }

  if ((flags & TELEMETRY_SPEED) !== 0) {
    const decoded = decodeVarUint(bytes, cursor);
    telemetry.speedMetresPerSecond = decoded.value / 10;
    cursor = decoded.nextOffset;
  }

  if ((flags & TELEMETRY_HEADING) !== 0) {
    const decoded = decodeVarUint(bytes, cursor);

    if (decoded.value > 359) {
      throw new Error('Telemetry heading is invalid.');
    }

    telemetry.headingDegrees = decoded.value;
    cursor = decoded.nextOffset;
  }

  if (cursor !== bytes.length) {
    throw new Error('Unexpected bytes after telemetry payload.');
  }

  return telemetry;
}
