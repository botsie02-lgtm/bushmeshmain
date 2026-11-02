import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  EmitterSubscription,
} from 'react-native';

import {
  BushMeshLocationProvider,
  LocationErrorHandler,
  LocationFixHandler,
  LocationProviderStop,
} from './LocationProvider';
import {BushMeshLocationFix} from './positionPlanner';

type NativeGpsFix = {
  latitude: number;
  longitude: number;
  timestampMs: number;
  altitudeMeters: number | null;
  speedKmh: number | null;
  headingDegrees: number | null;
  accuracyMeters: number | null;
};

type NativeGpsError = {
  message?: string;
};

type NativeGpsModule = {
  start: (minTimeMs: number, minDistanceMeters: number) => Promise<boolean>;
  stop: () => Promise<boolean>;
  getStatus: () => Promise<{
    tracking: boolean;
    gpsEnabled: boolean;
    provider: string;
  }>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

const nativeModule = NativeModules.BushMeshLocation as NativeGpsModule | undefined;

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toLocationFix(value: NativeGpsFix): BushMeshLocationFix | null {
  const latitude = asFiniteNumber(value.latitude);
  const longitude = asFiniteNumber(value.longitude);
  const timestampMs = asFiniteNumber(value.timestampMs);

  if (latitude === null || longitude === null || timestampMs === null) {
    return null;
  }

  return {
    latitude,
    longitude,
    timestampMs,
    altitudeMeters: asFiniteNumber(value.altitudeMeters),
    speedKmh: asFiniteNumber(value.speedKmh),
    headingDegrees: asFiniteNumber(value.headingDegrees),
    accuracyMeters: asFiniteNumber(value.accuracyMeters),
  };
}

export class AndroidGpsLocationProvider implements BushMeshLocationProvider {
  readonly id = 'android-gps';
  readonly label = 'Android GPS';

  isSupported(): boolean {
    return Platform.OS === 'android' && nativeModule !== undefined;
  }

  start(
    onFix: LocationFixHandler,
    onError?: LocationErrorHandler,
  ): LocationProviderStop {
    if (!this.isSupported() || !nativeModule) {
      onError?.(new Error('Native Android GPS provider is unavailable.'));
      return () => undefined;
    }

    const emitter = new NativeEventEmitter(nativeModule as never);
    const subscriptions: EmitterSubscription[] = [
      emitter.addListener('BushMeshLocationFix', (value: NativeGpsFix) => {
        const fix = toLocationFix(value);
        if (!fix) {
          onError?.(new Error('Android GPS returned an invalid location fix.'));
          return;
        }
        onFix(fix);
      }),
      emitter.addListener('BushMeshLocationError', (value: NativeGpsError) => {
        onError?.(
          new Error(value?.message || 'Android GPS provider reported an error.'),
        );
      }),
    ];

    let stopped = false;
    nativeModule.start(1_000, 0).catch(error => {
      if (stopped) {
        return;
      }
      onError?.(
        error instanceof Error
          ? error
          : new Error('Android GPS could not be started.'),
      );
    });

    return () => {
      if (stopped) {
        return;
      }
      stopped = true;
      subscriptions.forEach(subscription => subscription.remove());
      nativeModule.stop().catch(() => undefined);
    };
  }
}

export const androidGpsLocationProvider = new AndroidGpsLocationProvider();
