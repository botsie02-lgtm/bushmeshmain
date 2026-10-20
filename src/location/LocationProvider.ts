import {BushMeshLocationFix} from './positionPlanner';

export type LocationProviderStop = () => void;
export type LocationFixHandler = (fix: BushMeshLocationFix) => void;
export type LocationErrorHandler = (error: Error) => void;

export interface BushMeshLocationProvider {
  readonly id: string;
  readonly label: string;
  start(
    onFix: LocationFixHandler,
    onError?: LocationErrorHandler,
  ): LocationProviderStop;
}

export type SimulatedRoutePoint = Omit<BushMeshLocationFix, 'timestampMs'> & {
  delayMs?: number;
};

/**
 * Deterministic development provider used by emulator/CI and UI work. It emits
 * a route repeatedly without depending on Android location services. A native
 * provider can later implement the same contract.
 */
export class SimulatedLocationProvider implements BushMeshLocationProvider {
  readonly id = 'simulated';
  readonly label = 'Simulated route';

  private readonly route: SimulatedRoutePoint[];
  private readonly defaultDelayMs: number;
  private readonly loop: boolean;

  constructor(
    route: SimulatedRoutePoint[],
    options?: {defaultDelayMs?: number; loop?: boolean},
  ) {
    if (route.length === 0) {
      throw new Error('Simulated location route must contain at least one point.');
    }

    this.route = route.map(point => ({...point}));
    this.defaultDelayMs = Math.max(1, options?.defaultDelayMs ?? 5_000);
    this.loop = options?.loop ?? true;
  }

  start(
    onFix: LocationFixHandler,
    onError?: LocationErrorHandler,
  ): LocationProviderStop {
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let index = 0;
    let lastTimestampMs = 0;

    const emitNext = () => {
      if (stopped) {
        return;
      }

      try {
        const point = this.route[index];
        const now = Date.now();
        const timestampMs = Math.max(now, lastTimestampMs + 1);
        lastTimestampMs = timestampMs;

        onFix({
          latitude: point.latitude,
          longitude: point.longitude,
          timestampMs,
          altitudeMeters: point.altitudeMeters ?? null,
          speedKmh: point.speedKmh ?? null,
          headingDegrees: point.headingDegrees ?? null,
          accuracyMeters: point.accuracyMeters ?? null,
        });

        const delayMs = Math.max(1, point.delayMs ?? this.defaultDelayMs);
        index += 1;

        if (index >= this.route.length) {
          if (!this.loop) {
            return;
          }
          index = 0;
        }

        timeout = setTimeout(emitNext, delayMs);
      } catch (error) {
        onError?.(
          error instanceof Error
            ? error
            : new Error('Simulated location provider failed.'),
        );
      }
    };

    emitNext();

    return () => {
      stopped = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };
  }
}

export function createDefaultSimulatedRoute(): SimulatedLocationProvider {
  return new SimulatedLocationProvider(
    [
      {
        latitude: -37.5628,
        longitude: 146.2504,
        altitudeMeters: 1178,
        speedKmh: 0,
        headingDegrees: 35,
        accuracyMeters: 5,
      },
      {
        latitude: -37.5619,
        longitude: 146.2516,
        altitudeMeters: 1181,
        speedKmh: 18,
        headingDegrees: 38,
        accuracyMeters: 5,
      },
      {
        latitude: -37.5607,
        longitude: 146.2531,
        altitudeMeters: 1185,
        speedKmh: 31,
        headingDegrees: 42,
        accuracyMeters: 6,
      },
      {
        latitude: -37.5597,
        longitude: 146.2545,
        altitudeMeters: 1187,
        speedKmh: 28,
        headingDegrees: 75,
        accuracyMeters: 6,
      },
    ],
    {defaultDelayMs: 5_000, loop: true},
  );
}
