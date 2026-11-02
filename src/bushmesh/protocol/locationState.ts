import {
  CompactLocation,
  LocationDelta,
  LocationPrecision,
  decodeLocationDelta,
  encodeLocationDelta,
  encodeLocationPayload,
} from './location';

const EARTH_RADIUS_METRES = 6371000;

export type BushMeshLocationUpdate =
  | {
      mode: 'absolute';
      payload: number[];
      location: CompactLocation;
    }
  | {
      mode: 'delta';
      payload: number[];
      delta: LocationDelta;
      location: CompactLocation;
    };

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function metresBetween(
  previous: CompactLocation,
  current: CompactLocation,
): LocationDelta {
  const previousLat = degreesToRadians(previous.latitude);
  const currentLat = degreesToRadians(current.latitude);
  const deltaLat = currentLat - previousLat;
  const deltaLon = degreesToRadians(current.longitude - previous.longitude);
  const meanLat = (previousLat + currentLat) / 2;

  return {
    northMetres: Math.round(deltaLat * EARTH_RADIUS_METRES),
    eastMetres: Math.round(
      deltaLon * Math.cos(meanLat) * EARTH_RADIUS_METRES,
    ),
  };
}

function applyDelta(
  previous: CompactLocation,
  delta: LocationDelta,
): CompactLocation {
  const previousLatRadians = degreesToRadians(previous.latitude);
  const latitude =
    previous.latitude +
    (delta.northMetres / EARTH_RADIUS_METRES) * (180 / Math.PI);
  const longitude =
    previous.longitude +
    (delta.eastMetres /
      (EARTH_RADIUS_METRES * Math.max(0.000001, Math.cos(previousLatRadians)))) *
      (180 / Math.PI);

  return {
    latitude,
    longitude,
    precision: previous.precision,
    batteryPercent: previous.batteryPercent,
  };
}

export class BushMeshLocationDeltaEncoder {
  private previous: CompactLocation | null = null;
  private updatesSinceAbsolute = 0;

  constructor(
    private readonly absoluteEvery = 10,
    private readonly maxDeltaMetres = 2000,
  ) {
    if (!Number.isInteger(absoluteEvery) || absoluteEvery < 1) {
      throw new Error('Absolute GPS interval must be a positive integer.');
    }

    if (!Number.isFinite(maxDeltaMetres) || maxDeltaMetres <= 0) {
      throw new Error('Maximum GPS delta distance must be greater than zero.');
    }
  }

  encode(location: CompactLocation, forceAbsolute = false): BushMeshLocationUpdate {
    const normalized: CompactLocation = {
      ...location,
      precision: location.precision ?? LocationPrecision.Approx10M,
    };

    if (
      forceAbsolute ||
      !this.previous ||
      this.updatesSinceAbsolute >= this.absoluteEvery - 1
    ) {
      this.previous = normalized;
      this.updatesSinceAbsolute = 0;
      return {
        mode: 'absolute',
        payload: encodeLocationPayload(normalized),
        location: normalized,
      };
    }

    const delta = metresBetween(this.previous, normalized);
    const distance = Math.hypot(delta.northMetres, delta.eastMetres);

    if (distance > this.maxDeltaMetres) {
      this.previous = normalized;
      this.updatesSinceAbsolute = 0;
      return {
        mode: 'absolute',
        payload: encodeLocationPayload(normalized),
        location: normalized,
      };
    }

    this.previous = normalized;
    this.updatesSinceAbsolute += 1;
    return {
      mode: 'delta',
      payload: encodeLocationDelta(delta),
      delta,
      location: normalized,
    };
  }

  reset(): void {
    this.previous = null;
    this.updatesSinceAbsolute = 0;
  }
}

export class BushMeshLocationDeltaDecoder {
  private previous: CompactLocation | null = null;

  acceptAbsolute(location: CompactLocation): CompactLocation {
    this.previous = {...location};
    return {...this.previous};
  }

  acceptDelta(payload: number[]): CompactLocation {
    if (!this.previous) {
      throw new Error('Cannot decode GPS delta before an absolute location.');
    }

    const delta = decodeLocationDelta(payload);
    this.previous = applyDelta(this.previous, delta);
    return {...this.previous};
  }

  current(): CompactLocation | null {
    return this.previous ? {...this.previous} : null;
  }

  reset(): void {
    this.previous = null;
  }
}
