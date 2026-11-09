import {BushMeshTrackPoint} from '../../location/TrackRecorder';
import {BushMeshLocationFix, validateLocationFix} from '../../location/positionPlanner';
import {GpsPreferencesV1} from './gpsPreferenceCodec';
import {GpsReadinessSnapshot} from './gpsReadiness';

export type GpsFixState = 'none' | 'fresh' | 'stale' | 'future-dated' | 'invalid';
export type GpsAvailabilityState =
  | 'unsupported' | 'permission-denied' | 'permission-unknown'
  | 'gps-disabled' | 'gps-unknown' | 'ready' | 'app-backgrounded';

export type GpsDiagnosticResult = {
  availability: GpsAvailabilityState;
  availabilityHint: string;
  foregroundStartReady: boolean;
  backgroundStartReady: boolean;
  backgroundHint: string;
  fixState: GpsFixState;
  fixAgeMs: number | null;
  fix: BushMeshLocationFix | null;
  fixSource: 'session' | 'breadcrumb' | 'none';
  accuracyAssessment: 'unknown' | 'within-preference' | 'low-accuracy';
  locationSourceLabel: string;
  nativeTracking: boolean | null;
};

export type LocationSessionObservation = {
  status: 'stopped' | 'tracking' | 'tracking-no-link' | 'error';
  providerLabel: string | null;
  latestFix: BushMeshLocationFix | null;
  trackPoints: readonly BushMeshTrackPoint[];
};

function availabilityOf(readiness: GpsReadinessSnapshot): {
  state: GpsAvailabilityState;
  hint: string;
} {
  if (!readiness.supported) {
    return {state: 'unsupported', hint: 'No supported native Android GPS module.'};
  }
  if (readiness.precisePermission === 'denied') {
    return {
      state: 'permission-denied',
      hint: 'Precise location is not granted. Use Android app settings, or explicitly start GPS to request it.',
    };
  }
  if (readiness.precisePermission === 'unknown') {
    return {state: 'permission-unknown',
      hint: 'Precise permission could not be checked. No permission was requested.'};
  }
  if (readiness.gpsEnabled === false) {
    return {state: 'gps-disabled', hint: 'Android GPS is switched off. Enable device location services.'};
  }
  if (readiness.gpsEnabled === null) {
    return {state: 'gps-unknown', hint: readiness.error ?? 'GPS provider availability is unknown.'};
  }
  if (readiness.visibility !== 'active') {
    return {state: 'app-backgrounded',
      hint: 'Bring BushMesh to the foreground before starting a GPS session.'};
  }
  return {state: 'ready', hint: 'Precise permission granted and Android GPS enabled.'};
}

/**
 * Read-only projection of observed session/native state. A recovered breadcrumb
 * is historical, never treated as a live fix or permission for LoRa transmission.
 */
export function buildGpsDiagnostics(input: {
  readiness: GpsReadinessSnapshot;
  session: LocationSessionObservation;
  preferences: GpsPreferencesV1;
  nowMs: number;
}): GpsDiagnosticResult {
  const {readiness, session, preferences, nowMs} = input;
  const availability = availabilityOf(readiness);
  const lastTrack = session.trackPoints.length
    ? session.trackPoints[session.trackPoints.length - 1] : null;
  const liveFix = session.latestFix;
  const fix = liveFix ?? lastTrack;
  const fixSource = liveFix ? 'session' : lastTrack ? 'breadcrumb' : 'none';
  let fixState: GpsFixState = 'none';
  let fixAgeMs: number | null = null;
  let accuracyAssessment: GpsDiagnosticResult['accuracyAssessment'] = 'unknown';

  if (fix) {
    const validationError = validateLocationFix(fix);
    const age = nowMs - fix.timestampMs;
    fixAgeMs = Number.isFinite(age) ? age : null;
    if (validationError || fixAgeMs === null) fixState = 'invalid';
    else if (age < -10_000) fixState = 'future-dated';
    else if (age > preferences.staleAfterSeconds * 1_000) fixState = 'stale';
    else fixState = 'fresh';

    if (fix.accuracyMeters !== null && fix.accuracyMeters !== undefined &&
        Number.isFinite(fix.accuracyMeters) && fix.accuracyMeters >= 0) {
      accuracyAssessment = fix.accuracyMeters > preferences.accuracyWarningMeters
        ? 'low-accuracy' : 'within-preference';
    }
  }

  const foregroundStartReady = availability.state === 'ready';
  // Current Android manifest does not request ACCESS_BACKGROUND_LOCATION.
  // A previously started foreground location service can sometimes continue
  // after backgrounding, but a new background start is not supported.
  const backgroundStartReady = false;
  const backgroundHint = readiness.backgroundStartPermission === 'not-declared'
    ? readiness.nativeTracking === true
      ? 'A foreground-started GPS session is reported active. Continuation depends on Android; independent background starts are not configured.'
      : 'Independent background GPS start is not configured (ACCESS_BACKGROUND_LOCATION is absent). Start while app is visible.'
    : 'Background starts are not guaranteed by the current app lifecycle. Start GPS while BushMesh is visible.';

  return {
    availability: availability.state,
    availabilityHint: availability.hint,
    foregroundStartReady,
    backgroundStartReady,
    backgroundHint,
    fixState,
    fixAgeMs,
    fix,
    fixSource,
    accuracyAssessment,
    locationSourceLabel: liveFix
      ? session.providerLabel ?? 'Current session (unknown source)'
      : lastTrack
        ? 'Saved breadcrumb (historical, source not recorded)'
        : session.providerLabel ?? 'No location source',
    nativeTracking: readiness.nativeTracking,
  };
}

export function formatGpsAge(ageMs: number | null): string {
  if (ageMs === null) return 'Not available';
  if (ageMs < -10_000) return 'Clock mismatch (future fix)';
  const seconds = Math.max(0, Math.round(ageMs / 1_000));
  if (seconds < 60) return seconds + ' seconds ago';
  return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's ago';
}
