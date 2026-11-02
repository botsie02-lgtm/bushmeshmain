import {CompactLocation, LocationDelta} from '../protocol';

const EARTH_RADIUS_METRES = 6_371_000;

export type BushMeshConvoyLocationEncoding =
  | {mode: 'absolute'; location: CompactLocation}
  | {mode: 'delta'; locationDelta: LocationDelta}
  | {mode: 'unchanged'};

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function metresBetween(
  previous: CompactLocation,
  current: CompactLocation,
): LocationDelta {
  const previousLat = radians(previous.latitude);
  const currentLat = radians(current.latitude);
  const deltaLat = currentLat - previousLat;
  const deltaLon = radians(current.longitude - previous.longitude);
  const meanLat = (previousLat + currentLat) / 2;

  return {
    northMetres: Math.round(deltaLat * EARTH_RADIUS_METRES),
    eastMetres: Math.round(
      deltaLon * Math.cos(meanLat) * EARTH_RADIUS_METRES,
    ),
  };
}

/**
 * Convoy heartbeats do not need to repeat a full GPS coordinate every time.
 * This encoder periodically anchors with an absolute location and emits small
 * metre deltas between anchors. A zero movement emits no location bytes at all.
 */
export class BushMeshConvoyLocationEncoder {
  private previous: CompactLocation | null = null;
  private updatesSinceAbsolute = 0;

  constructor(
    private readonly absoluteEvery = 6,
    private readonly maxDeltaMetres = 2000,
  ) {
    if (!Number.isInteger(absoluteEvery) || absoluteEvery < 1) {
      throw new Error('Convoy absolute GPS interval must be a positive integer.');
    }
    if (!Number.isFinite(maxDeltaMetres) || maxDeltaMetres <= 0) {
      throw new Error('Convoy maximum GPS delta must be greater than zero.');
    }
  }

  encode(
    location: CompactLocation,
    forceAbsolute = false,
  ): BushMeshConvoyLocationEncoding {
    const current = {...location};

    if (
      forceAbsolute ||
      !this.previous ||
      this.updatesSinceAbsolute >= this.absoluteEvery - 1
    ) {
      this.previous = current;
      this.updatesSinceAbsolute = 0;
      return {mode: 'absolute', location: current};
    }

    const delta = metresBetween(this.previous, current);
    const distance = Math.hypot(delta.northMetres, delta.eastMetres);

    if (distance > this.maxDeltaMetres) {
      this.previous = current;
      this.updatesSinceAbsolute = 0;
      return {mode: 'absolute', location: current};
    }

    this.previous = current;
    this.updatesSinceAbsolute += 1;

    if (delta.northMetres === 0 && delta.eastMetres === 0) {
      return {mode: 'unchanged'};
    }

    return {mode: 'delta', locationDelta: delta};
  }

  reset(): void {
    this.previous = null;
    this.updatesSinceAbsolute = 0;
  }
}
