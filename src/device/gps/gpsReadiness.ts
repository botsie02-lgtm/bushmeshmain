import {AppState, NativeModules, PermissionsAndroid, Platform} from 'react-native';

/**
 * Android callback measurements from the *existing* LocationListener.
 * Interval values use SystemClock.elapsedRealtime, not the RN render clock.
 * Optional for older native binaries; does not expose latitude or longitude.
 */
export type GpsNativeDelivery = {
  callbackCount: number;
  intervalCount: number;
  meanIntervalMs: number | null;
  medianIntervalMs: number | null;
  p95IntervalMs: number | null;
  maxIntervalMs: number | null;
  latestFixAgeMs: number | null;
  callbackSilenceMs: number | null;
  rejectedClockSamples: number;
  requestedMinTimeMs: number | null;
  requestedMinDistanceMeters: number | null;
  accuracyMeters: number | null;
  speedKmh: number | null;
  bearingDegrees: number | null;
  speedAccuracyKmh: number | null;
  bearingAccuracyDegrees: number | null;
};

function nonnegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value : null;
}

function parseDelivery(value: unknown): GpsNativeDelivery | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const count = nonnegativeNumber(r.callbackCount);
  const intervals = nonnegativeNumber(r.intervalCount);
  if (count === null || intervals === null ||
      !Number.isSafeInteger(count) || !Number.isSafeInteger(intervals) ||
      intervals > Math.max(0, count - 1)) return null;
  return {
    callbackCount: count,
    intervalCount: intervals,
    meanIntervalMs: nonnegativeNumber(r.meanIntervalMs),
    medianIntervalMs: nonnegativeNumber(r.medianIntervalMs),
    p95IntervalMs: nonnegativeNumber(r.p95IntervalMs),
    maxIntervalMs: nonnegativeNumber(r.maxIntervalMs),
    latestFixAgeMs: nonnegativeNumber(r.latestFixAgeMs),
    callbackSilenceMs: nonnegativeNumber(r.callbackSilenceMs),
    rejectedClockSamples: nonnegativeNumber(r.rejectedClockSamples) ?? 0,
    requestedMinTimeMs: nonnegativeNumber(r.requestedMinTimeMs),
    requestedMinDistanceMeters: nonnegativeNumber(r.requestedMinDistanceMeters),
    accuracyMeters: nonnegativeNumber(r.accuracyMeters),
    speedKmh: nonnegativeNumber(r.speedKmh),
    bearingDegrees: nonnegativeNumber(r.bearingDegrees),
    speedAccuracyKmh: nonnegativeNumber(r.speedAccuracyKmh),
    bearingAccuracyDegrees: nonnegativeNumber(r.bearingAccuracyDegrees),
  };
}

export type PermissionState = 'granted' | 'denied' | 'unknown';
export type VisibilityState = 'active' | 'background' | 'inactive' | 'unknown';

export type GpsReadinessSnapshot = {
  supported: boolean;
  precisePermission: PermissionState;
  approximatePermission: PermissionState;
  gpsEnabled: boolean | null;
  nativeTracking: boolean | null;
  provider: string | null;
  visibility: VisibilityState;
  /** No ACCESS_BACKGROUND_LOCATION declaration in the current Android manifest. */
  backgroundStartPermission: 'not-declared' | 'not-applicable';
  checkedAtMs: number;
  error: string | null;
  /** Null when the active Android binary has no native callback telemetry. */
  nativeDelivery?: GpsNativeDelivery | null;
};

type NativeLocationReadPort = {
  getStatus: () => Promise<unknown>;
};

type GpsReadinessDependencies = {
  platform: string;
  apiLevel: number;
  visibility: VisibilityState;
  checkPermission: (permission: string) => Promise<boolean>;
  native: NativeLocationReadPort | null;
  now: () => number;
};

function parseStatus(value: unknown): {
  tracking: boolean;
  gpsEnabled: boolean;
  provider: string | null;
  nativeDelivery: GpsNativeDelivery | null;
} {
  if (!value || typeof value !== 'object') {
    throw new Error('Android did not return GPS provider state.');
  }
  const state = value as Record<string, unknown>;
  if (typeof state.tracking !== 'boolean' ||
      typeof state.gpsEnabled !== 'boolean') {
    throw new Error('Android returned malformed GPS provider state.');
  }
  return {
    tracking: state.tracking,
    gpsEnabled: state.gpsEnabled,
    provider: typeof state.provider === 'string' ? state.provider : null,
    nativeDelivery: parseDelivery(state.delivery),
  };
}

async function permission(
  check: GpsReadinessDependencies['checkPermission'],
  name: string,
): Promise<PermissionState> {
  try {
    return (await check(name)) ? 'granted' : 'denied';
  } catch {
    return 'unknown';
  }
}

/** Read-only check. Does not call PermissionsAndroid.request or start/stop GPS. */
export async function inspectGpsReadiness(
  deps: GpsReadinessDependencies,
): Promise<GpsReadinessSnapshot> {
  const base: GpsReadinessSnapshot = {
    supported: deps.platform === 'android' && deps.native !== null,
    precisePermission: 'unknown',
    approximatePermission: 'unknown',
    gpsEnabled: null,
    nativeTracking: null,
    provider: null,
    visibility: deps.visibility,
    backgroundStartPermission: deps.apiLevel >= 29 ? 'not-declared' : 'not-applicable',
    checkedAtMs: deps.now(),
    error: null,
    nativeDelivery: null,
  };

  if (!base.supported) {
    return {...base, error: 'Native Android GPS inspection is unavailable.'};
  }
  const [fine, coarse, native] = await Promise.all([
    permission(deps.checkPermission, 'android.permission.ACCESS_FINE_LOCATION'),
    permission(deps.checkPermission, 'android.permission.ACCESS_COARSE_LOCATION'),
    deps.native!.getStatus().then(value => ({value, error: null as string | null}))
      .catch(error => ({
        value: null,
        error: error instanceof Error ? error.message : 'GPS status could not be read.',
      })),
  ]);
  if (native.error) {
    return {...base, precisePermission: fine, approximatePermission: coarse,
      error: native.error};
  }
  try {
    const status = parseStatus(native.value);
    return {...base, precisePermission: fine, approximatePermission: coarse,
      gpsEnabled: status.gpsEnabled, nativeTracking: status.tracking,
      provider: status.provider, nativeDelivery: status.nativeDelivery};
  } catch (error) {
    return {...base, precisePermission: fine, approximatePermission: coarse,
      error: error instanceof Error ? error.message : 'Invalid GPS status.'};
  }
}

const module = NativeModules.BushMeshLocation as NativeLocationReadPort | undefined;

/**
 * Explicit read-only invocation. AppState is sampled, never subscribed here;
 * the UI may refresh on foreground transitions without changing permissions.
 */
export function readAndroidGpsReadiness(): Promise<GpsReadinessSnapshot> {
  const visibility: VisibilityState = AppState.currentState === 'active' ||
    AppState.currentState === 'inactive' ||
    AppState.currentState === 'background'
    ? AppState.currentState : 'unknown';
  return inspectGpsReadiness({
    platform: Platform.OS,
    apiLevel: typeof Platform.Version === 'number' ? Platform.Version : 0,
    visibility,
    native: module?.getStatus ? module : null,
    checkPermission: name => PermissionsAndroid.check(name as
      (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS]),
    now: Date.now,
  });
}
