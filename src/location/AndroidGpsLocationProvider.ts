import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  EmitterSubscription,
} from 'react-native';

import {gpsPreferences} from '../device/gps/gpsPreferences';
import {
  BushMeshLocationProvider,
  LocationErrorHandler,
  LocationFixHandler,
  LocationProviderStop,
} from './LocationProvider';
import {BushMeshLocationFix} from './positionPlanner';
import {gpsAcquisitionHint} from '../device/gps/gpsPreferenceCodec';

type NativeGpsFix = {
  latitude: number;
  longitude: number;
  timestampMs: number;
  altitudeMeters: number | null;
  speedKmh: number | null;
  headingDegrees: number | null;
  accuracyMeters: number | null;
};

type NativeGpsError = {message?: string};

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

/**
 * The existing shared GPS provider is the only writer of native location
 * start/stop commands. Reads stored acquisition hints on explicit start.
 * Requests are serialized, so a late preference restore or a stop/start
 * handoff cannot restart GPS after the caller cancelled an old session.
 */
export class AndroidGpsLocationProvider implements BushMeshLocationProvider {
  readonly id = 'android-gps';
  readonly label = 'Android GPS';

  private lifecycle: Promise<void> = Promise.resolve();
  private generation = 0;

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
    let stopped = false;
    let startAttempted = false;
    const generation = ++this.generation;
    const subscriptions: EmitterSubscription[] = [
      emitter.addListener('BushMeshLocationFix', (value: NativeGpsFix) => {
        if (stopped) return;
        const fix = toLocationFix(value);
        if (!fix) {
          onError?.(new Error('Android GPS returned an invalid location fix.'));
          return;
        }
        onFix(fix);
      }),
      emitter.addListener('BushMeshLocationError', (value: NativeGpsError) => {
        if (!stopped) {
          onError?.(
            new Error(value?.message || 'Android GPS provider reported an error.'),
          );
        }
      }),
    ];

    const begin = this.lifecycle.catch(() => undefined).then(async () => {
      await gpsPreferences.initialize();
      if (stopped || generation !== this.generation) return;
      const hint = gpsAcquisitionHint(gpsPreferences.snapshot().acquisitionMode);
      startAttempted = true;
      await nativeModule.start(hint.minTimeMs, hint.minDistanceMeters);
    }).catch(error => {
      if (!stopped) {
        onError?.(
          error instanceof Error
            ? error
            : new Error('Android GPS could not be started.'),
        );
      }
    });
    this.lifecycle = begin;

    return () => {
      if (stopped) return;
      stopped = true;
      if (this.generation === generation) this.generation += 1;
      subscriptions.forEach(subscription => subscription.remove());
      // Stop after the queued start finishes, never while a new session is
      // already starting. A cancelled pre-start never reaches native.start.
      this.lifecycle = this.lifecycle.catch(() => undefined).then(async () => {
        if (startAttempted) await nativeModule.stop();
      }).catch(() => undefined);
    };
  }
}

export const androidGpsLocationProvider = new AndroidGpsLocationProvider();
