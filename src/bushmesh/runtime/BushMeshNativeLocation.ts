import {NativeModules, PermissionsAndroid, Platform} from 'react-native';

import {CompactLocation, LocationPrecision} from '../protocol';
import {publishBushMeshLocalLocation} from './BushMeshLocalLocationHub';

export type BushMeshNativePosition = {
  location: CompactLocation;
  accuracyMetres: number;
  timestampMs: number;
  altitudeMetres?: number;
  speedKph?: number;
  headingDegrees?: number;
};

type NativeLocationResult = {
  latitude: number;
  longitude: number;
  accuracyMetres: number;
  timestampMs: number;
  altitudeMetres?: number;
  speedKph?: number;
  headingDegrees?: number;
};

type BushMeshLocationNativeModule = {
  getCurrentLocation: (
    maxAgeMs: number,
    timeoutMs: number,
  ) => Promise<NativeLocationResult>;
  cancel?: () => Promise<void>;
};

function nativeLocation(): BushMeshLocationNativeModule | null {
  const module = NativeModules.BushMeshLocation as
    | BushMeshLocationNativeModule
    | undefined;
  if (!module || typeof module.getCurrentLocation !== 'function') {
    return null;
  }
  return module;
}

export function isBushMeshNativeLocationAvailable(): boolean {
  return nativeLocation() !== null;
}

export async function ensureBushMeshLocationPermission(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  if (await PermissionsAndroid.check(permission)) {
    return;
  }

  const result = await PermissionsAndroid.request(permission, {
    title: 'BushMesh convoy location',
    message:
      'BushMesh uses your phone location while convoy mode is enabled to send compact vehicle position updates over LoRa.',
    buttonPositive: 'Allow location',
    buttonNegative: 'Not now',
  });

  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Location permission is required to include GPS in convoy heartbeats.');
  }
}

function precisionForAccuracy(accuracyMetres: number): LocationPrecision {
  if (accuracyMetres <= 5) {
    return LocationPrecision.Approx1M;
  }
  if (accuracyMetres <= 50) {
    return LocationPrecision.Approx10M;
  }
  if (accuracyMetres <= 500) {
    return LocationPrecision.Approx100M;
  }
  return LocationPrecision.Approx1Km;
}

function optionalFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export async function getBushMeshNativePosition(options?: {
  maxAgeMs?: number;
  timeoutMs?: number;
}): Promise<BushMeshNativePosition> {
  const module = nativeLocation();
  if (!module) {
    throw new Error('Native BushMesh location services are unavailable on this device.');
  }

  await ensureBushMeshLocationPermission();
  const result = await module.getCurrentLocation(
    options?.maxAgeMs ?? 15_000,
    options?.timeoutMs ?? 7_000,
  );

  if (
    !result ||
    !Number.isFinite(result.latitude) ||
    !Number.isFinite(result.longitude) ||
    result.latitude < -90 ||
    result.latitude > 90 ||
    result.longitude < -180 ||
    result.longitude > 180
  ) {
    throw new Error('Native location returned invalid coordinates.');
  }

  const accuracyMetres = Math.max(
    0,
    optionalFinite(result.accuracyMetres) ?? 1000,
  );
  const timestampMs = optionalFinite(result.timestampMs) ?? Date.now();
  const speed = optionalFinite(result.speedKph);
  const heading = optionalFinite(result.headingDegrees);
  const position: BushMeshNativePosition = {
    location: {
      latitude: result.latitude,
      longitude: result.longitude,
      precision: precisionForAccuracy(accuracyMetres),
    },
    accuracyMetres,
    timestampMs,
    altitudeMetres: optionalFinite(result.altitudeMetres),
    speedKph:
      speed !== undefined && speed >= 0 && speed <= 6553.5
        ? speed
        : undefined,
    headingDegrees:
      heading !== undefined && heading >= 0 && heading < 360
        ? heading
        : undefined,
  };

  publishBushMeshLocalLocation({
    location: position.location,
    capturedAtMs: position.timestampMs,
    accuracyMetres: position.accuracyMetres,
    altitudeMetres: position.altitudeMetres,
    speedKph: position.speedKph,
    headingDegrees: position.headingDegrees,
  });

  return position;
}

export async function cancelBushMeshNativeLocation(): Promise<void> {
  await nativeLocation()?.cancel?.();
}
