import type {BushMeshLocationFix} from '../../location/positionPlanner';
import {validateLocationFix} from '../../location/positionPlanner';
import type {GpsPreferencesV1} from '../../device/gps/gpsPreferenceCodec';
import type {GpsReadinessSnapshot} from '../../device/gps/gpsReadiness';
import type {LocationSessionStatus} from '../../state/LocationSessionContext';

export type DriveGpsDisplayState =
  | 'no-fix' | 'stopped' | 'stale' | 'future-dated'
  | 'invalid' | 'simulation' | 'gps-disabled' | 'permission-denied'
  | 'unconfirmed' | 'low-accuracy' | 'ready';

export type DriveGpsDisplay = {
  state: DriveGpsDisplayState;
  statusLabel: string;
  warning: string;
  speedLabel: string;
  headingLabel: string;
  positionAgeLabel: string;
  accuracyLabel: string;
  sourceLabel: string;
  radioLabel: string;
  navigationReliable: boolean;
};

type MotionSample = {
  timestampMs: number;
  speedKmh: number | null;
  headingDegrees: number | null;
};

/**
 * Only existing, validated fixes. A new explicit tracking session resets this
 * filter; stale/unreliable observations cannot keep a moving dashboard alive.
 * No GPS acquisition, navigation, transmission or persisted location history.
 */
export class DriveMotionStabilizer {
  private samples: MotionSample[] = [];
  private lastTimestamp: number | null = null;

  clear(): void {
    this.samples = [];
    this.lastTimestamp = null;
  }

  observe(fix: BushMeshLocationFix | null, nowMs: number): void {
    if (!fix || validateLocationFix(fix) !== null ||
        fix.timestampMs > nowMs + 2_000 || nowMs - fix.timestampMs > 45_000) {
      this.clear();
      return;
    }
    if (this.lastTimestamp !== null && fix.timestampMs <= this.lastTimestamp) {
      return;
    }
    if (this.lastTimestamp !== null && fix.timestampMs - this.lastTimestamp > 30_000) {
      this.clear();
    }
    this.lastTimestamp = fix.timestampMs;
    const sufficientAccuracy =
      fix.accuracyMeters !== null && fix.accuracyMeters !== undefined &&
      fix.accuracyMeters <= 50;
    this.samples.push({
      timestampMs: fix.timestampMs,
      speedKmh: sufficientAccuracy && fix.speedKmh != null &&
        Number.isFinite(fix.speedKmh) ? fix.speedKmh : null,
      headingDegrees: sufficientAccuracy && fix.headingDegrees != null &&
        fix.speedKmh != null && fix.speedKmh >= 5 &&
        fix.headingDegrees >= 0 && fix.headingDegrees < 360
        ? fix.headingDegrees : null,
    });
    if (this.samples.length > 3) this.samples.shift();
  }

  speedKmh(): number | null {
    const speeds = this.samples.map(x => x.speedKmh)
      .filter((x): x is number => x !== null).sort((a, b) => a - b);
    if (!speeds.length || this.samples[this.samples.length - 1].speedKmh === null) return null;
    return speeds[Math.floor(speeds.length / 2)];
  }

  headingDegrees(): number | null {
    const last = this.samples[this.samples.length - 1];
    if (!last || last.headingDegrees === null) return null;
    const candidates = this.samples.map(x => x.headingDegrees)
      .filter((x): x is number => x !== null);
    if (candidates.length === 0) return null;
    // Do not smooth across sharp turns or stale inconsistent course readings.
    if (candidates.some(h => {
      const diff = Math.abs(h - last.headingDegrees!);
      return Math.min(diff, 360 - diff) > 35;
    })) return last.headingDegrees;
    const radians = candidates.map(deg => deg * Math.PI / 180);
    const sin = radians.reduce((sum, angle) => sum + Math.sin(angle), 0);
    const cos = radians.reduce((sum, angle) => sum + Math.cos(angle), 0);
    if (Math.hypot(sin, cos) < 0.5) return last.headingDegrees;
    return (Math.atan2(sin, cos) * 180 / Math.PI + 360) % 360;
  }
}

export function driveGpsDisplay(input: {
  fix: BushMeshLocationFix | null;
  status: LocationSessionStatus;
  providerLabel: string | null;
  readiness: GpsReadinessSnapshot | null;
  prefs: GpsPreferencesV1;
  nowMs: number;
  radioStatus: 'ready' | 'connected' | 'offline';
  stabilizer: DriveMotionStabilizer;
}): DriveGpsDisplay {
  const {fix, status, providerLabel, readiness, prefs, nowMs, radioStatus,
    stabilizer} = input;
  const active = status === 'tracking' || status === 'tracking-no-link';
  const native = providerLabel === 'Android GPS';
  const simulator = providerLabel === 'Simulated route';
  const ageMs = fix ? nowMs - fix.timestampMs : null;
  const ageLabel = ageMs === null || !Number.isFinite(ageMs)
    ? 'NO FIX' : ageMs < -2_000
      ? 'FUTURE TIMESTAMP'
      : Math.max(0, Math.round(ageMs / 1000)) + ' s ago';
  let state: DriveGpsDisplayState = 'ready';
  let warning = 'GPS quality observed; confirm the track and surroundings.';
  if (!active) {
    state = 'stopped';
    warning = 'Tracking stopped. Last coordinates are not a live navigation fix.';
  } else if (!fix) {
    state = 'no-fix';
    warning = 'No GPS fix received. Do not assume the vehicle is stationary.';
  } else if (validateLocationFix(fix) !== null) {
    state = 'invalid';
    warning = 'GPS fix failed validation; do not navigate from this position.';
  } else if (ageMs !== null && ageMs < -10_000) {
    state = 'future-dated';
    warning = 'GPS time is ahead of the phone clock. Position is untrusted.';
  } else if (ageMs !== null && ageMs > Math.min(45_000, prefs.staleAfterSeconds * 1000)) {
    state = 'stale';
    warning = 'GPS fix is stale; displayed movement is suppressed.';
  } else if (simulator) {
    state = 'simulation';
    warning = 'Simulated position is not physical GPS field readiness.';
  } else if (!native) {
    state = 'unconfirmed';
    warning = 'The location source is not verified as Android GPS.';
  } else if (readiness?.precisePermission === 'denied') {
    state = 'permission-denied';
    warning = 'Precise location denied. Use the existing GPS controls/settings.';
  } else if (readiness?.gpsEnabled === false) {
    state = 'gps-disabled';
    warning = 'Android location services are disabled.';
  } else if (!readiness || readiness.precisePermission !== 'granted' ||
             readiness.gpsEnabled !== true || readiness.nativeTracking !== true) {
    state = 'unconfirmed';
    warning = 'GPS service readiness has not been confirmed; treat movement as unknown.';
  } else if (fix.accuracyMeters == null ||
             fix.accuracyMeters > Math.min(100, prefs.accuracyWarningMeters)) {
    state = 'low-accuracy';
    warning = 'Reported horizontal accuracy is inadequate for a trusted direction of travel.';
  }

  const reliable = state === 'ready';
  const mostRecent = readiness?.nativeDelivery;
  // Native uncertainty is only comparable when both fix ages are close.
  const matchingNativeFix = reliable && mostRecent?.latestFixAgeMs != null &&
    ageMs !== null && Math.abs(mostRecent.latestFixAgeMs - ageMs) <= 5_000;
  const speedUncertainty = matchingNativeFix ? mostRecent?.speedAccuracyKmh : null;
  const bearingUncertainty = matchingNativeFix
    ? mostRecent?.bearingAccuracyDegrees : null;
  const stableSpeed = reliable && fix?.accuracyMeters != null &&
    fix.accuracyMeters <= 50 && speedUncertainty !== null &&
    speedUncertainty !== undefined && speedUncertainty > 10
    ? null : reliable ? stabilizer.speedKmh() : null;
  const stableHeading = reliable && fix?.accuracyMeters != null &&
    fix.accuracyMeters <= 50 && bearingUncertainty !== null &&
    bearingUncertainty !== undefined && bearingUncertainty > 30
    ? null : reliable ? stabilizer.headingDegrees() : null;
  return {
    state,
    statusLabel: state === 'ready' ? 'GPS CURRENT'
      : state.toUpperCase().replace(/-/g, ' '),
    warning: reliable && radioStatus !== 'ready'
      ? 'GPS current; radio transport is not ready. Peer delivery unconfirmed.' : warning,
    speedLabel: stableSpeed === null ? '—'
      : stableSpeed.toFixed(1) + ' km/h' +
        (speedUncertainty === null || speedUncertainty === undefined
          ? ' · precision unknown' : ' · GPS reported'),
    headingLabel: stableHeading === null ? '—'
      : Math.round(stableHeading) + '° · GPS course',
    positionAgeLabel: ageLabel,
    accuracyLabel: fix?.accuracyMeters == null ? '—'
      : '±' + Math.round(fix.accuracyMeters) + ' m',
    sourceLabel: providerLabel ?? 'No provider',
    radioLabel: radioStatus === 'ready' ? 'DATA LINK READY' :
      radioStatus === 'connected' ? 'NODE CONNECTED · DATA NOT READY' : 'RADIO OFFLINE',
    navigationReliable: reliable,
  };
}
