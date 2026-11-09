import {
  BushMeshLocationFix,
  validateLocationFix,
} from '../../location/positionPlanner';
import {
  buildGpsDiagnostics,
  GpsDiagnosticResult,
  LocationSessionObservation,
} from './gpsDiagnostics';
import {
  GpsAcquisitionMode,
  GpsPreferencesV1,
  gpsAcquisitionHint,
} from './gpsPreferenceCodec';
import {GpsReadinessSnapshot} from './gpsReadiness';

export type GpsObservedSource = 'android-gps' | 'simulation' | 'other' | 'none';
export type HeadingQuality =
  | 'unavailable' | 'invalid' | 'stale' | 'low-speed'
  | 'coarse-fix' | 'speed-unknown' | 'course-only';
export type LocationQuality = 'unavailable' | 'attention' | 'usable';

export type GpsFieldInput = {
  readiness: GpsReadinessSnapshot | null;
  session: LocationSessionObservation;
  preferences: GpsPreferencesV1;
  nowMs: number;
};

export type GpsIntervalStatistics = {
  observedFixes: number;
  intervalCount: number;
  averageMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  maximumMs: number | null;
  observedHz: number | null;
  longGaps: number;
  currentSilenceMs: number | null;
  longGapThresholdMs: number;
  rejectedObservations: number;
};

export type GpsFieldReport = {
  diagnostics: GpsDiagnosticResult | null;
  observedSource: GpsObservedSource;
  headingQuality: HeadingQuality;
  quality: LocationQuality;
  batteryPolicy: string;
  acquisitionMode: GpsAcquisitionMode;
  requestHintMs: number;
  requestHintMeters: number;
  statistics: GpsIntervalStatistics;
  lossEvents: number;
  recoveryEvents: number;
  providerDisabledEvents: number;
  permissionDeniedEvents: number;
  backgroundTransitions: number;
  restartRecoverySupported: false;
  notes: string[];
};

type FixSample = {
  arrivedAtMs: number;
  fixTimestampMs: number;
  accuracyMeters: number | null;
  speedKmh: number | null;
  headingDegrees: number | null;
  source: Exclude<GpsObservedSource, 'none'>;
};

const MAX_SAMPLES = 128;
const FUTURE_ALLOWANCE_MS = 10_000;

function classifySource(label: string | null): GpsObservedSource {
  if (!label) return 'none';
  if (label === 'Android GPS') return 'android-gps';
  if (label === 'Simulated route') return 'simulation';
  return 'other';
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil((sorted.length - 1) * p)];
}

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

/**
 * Bounded, process-memory-only statistics of accepted fixes *observed by this
 * UI*. No coordinates, identifiers, PSKs, location service, or native emitter.
 * Sampling a React state stream cannot measure deliveries while JS is paused.
 */
export class GpsFieldMonitor {
  private samples: FixSample[] = [];
  private intervalSamplesMs: number[] = [];
  private totalObserved = 0;
  private rejectedObservations = 0;
  private totalIntervals = 0;
  private longGaps = 0;
  private lastFingerprint: string | null = null;
  private lastActive = false;
  private lastArrivalAtMs: number | null = null;
  private sessionStartAtMs: number | null = null;
  private lastSource: GpsObservedSource = 'none';
  private lastVisibility: string | null = null;
  private lastEnabled: boolean | null = null;
  private lastDenied = false;
  private wasDegraded = false;
  private everHealthy = false;
  private lossEvents = 0;
  private recoveryEvents = 0;
  private providerDisabledEvents = 0;
  private permissionDeniedEvents = 0;
  private backgroundTransitions = 0;

  /** Reset only in-memory counters; never clears location history or tracking. */
  reset(input?: GpsFieldInput): void {
    this.samples = [];
    this.intervalSamplesMs = [];
    this.totalObserved = 0;
    this.rejectedObservations = 0;
    this.totalIntervals = 0;
    this.longGaps = 0;
    this.lossEvents = 0;
    this.recoveryEvents = 0;
    this.providerDisabledEvents = 0;
    this.permissionDeniedEvents = 0;
    this.backgroundTransitions = 0;
    this.everHealthy = false;
    this.wasDegraded = false;
    this.lastArrivalAtMs = null;
    this.lastActive = false;
    this.sessionStartAtMs = null;
    this.lastSource = 'none';
    this.lastFingerprint = null;
    this.lastVisibility = null;
    this.lastEnabled = null;
    this.lastDenied = false;
    if (input) {
      const active = input.session.status === 'tracking' ||
        input.session.status === 'tracking-no-link';
      this.lastActive = active;
      this.sessionStartAtMs = active ? input.nowMs : null;
      this.lastSource = classifySource(input.session.providerLabel);
      this.lastFingerprint = input.session.latestFix && active
        ? this.lastSource + ':' + input.session.latestFix.timestampMs : null;
      this.lastVisibility = input.readiness?.visibility ?? null;
      this.lastEnabled = input.readiness?.gpsEnabled ?? null;
      this.lastDenied = input.readiness?.precisePermission === 'denied';
    }
  }

  /** Safe to call with repeated renders/ticks: each unique fix counted once. */
  observe(input: GpsFieldInput): void {
    const {readiness, session, nowMs, preferences} = input;
    if (!Number.isFinite(nowMs)) return;
    const active = session.status === 'tracking' ||
      session.status === 'tracking-no-link';
    const source = classifySource(session.providerLabel);
    if (active && (!this.lastActive || source !== this.lastSource)) {
      this.sessionStartAtMs = nowMs;
      this.lastArrivalAtMs = null;
      this.lastFingerprint = null;
      this.everHealthy = false;
      this.wasDegraded = false;
    }
    if (!active && this.lastActive) {
      this.lastArrivalAtMs = null;
      this.sessionStartAtMs = null;
      this.lastFingerprint = null;
      this.wasDegraded = false;
      this.everHealthy = false;
    }
    this.lastActive = active;
    this.lastSource = source;

    if (readiness) {
      if (this.lastEnabled === true && readiness.gpsEnabled === false) {
        this.providerDisabledEvents += 1;
      }
      if (!this.lastDenied && readiness.precisePermission === 'denied') {
        this.permissionDeniedEvents += 1;
      }
      if (this.lastVisibility === 'active' &&
          readiness.visibility === 'background') {
        this.backgroundTransitions += 1;
      }
      this.lastEnabled = readiness.gpsEnabled;
      this.lastDenied = readiness.precisePermission === 'denied';
      this.lastVisibility = readiness.visibility;
    }

    if (active && source !== 'none' && session.latestFix) {
      const fix = session.latestFix;
      const fingerprint = source + ':' + String(fix.timestampMs);
      if (this.lastFingerprint !== fingerprint) {
        this.lastFingerprint = fingerprint;
        const error = validateLocationFix(fix);
        if (error || fix.timestampMs > nowMs + FUTURE_ALLOWANCE_MS) {
          this.rejectedObservations += 1;
        } else {
          this.addSample(fix, source, nowMs,
            Math.max(15_000, gpsAcquisitionHint(preferences.acquisitionMode).minTimeMs * 3));
        }
      }
    }
    if (!active || !readiness) return;

    const diag = buildGpsDiagnostics({
      readiness, session, preferences, nowMs,
    });
    const degraded = readiness.gpsEnabled !== true ||
      readiness.precisePermission !== 'granted' ||
      diag.fixSource !== 'session' ||
      diag.fixState !== 'fresh';
    if (!degraded) {
      if (this.wasDegraded && this.everHealthy) {
        this.recoveryEvents += 1;
      }
      this.everHealthy = true;
    } else if (!this.wasDegraded && this.everHealthy) {
      this.lossEvents += 1;
    }
    this.wasDegraded = degraded;
  }

  private addSample(
    fix: BushMeshLocationFix,
    source: Exclude<GpsObservedSource, 'none'>,
    nowMs: number,
    longGapThresholdMs: number,
  ): void {
    const sample: FixSample = {
      arrivedAtMs: nowMs,
      fixTimestampMs: fix.timestampMs,
      accuracyMeters: fix.accuracyMeters ?? null,
      speedKmh: fix.speedKmh ?? null,
      headingDegrees: fix.headingDegrees ?? null,
      source,
    };
    if (this.lastArrivalAtMs !== null && nowMs > this.lastArrivalAtMs) {
      const delta = nowMs - this.lastArrivalAtMs;
      this.intervalSamplesMs.push(delta);
      this.totalIntervals += 1;
      if (delta > longGapThresholdMs) this.longGaps += 1;
      if (this.intervalSamplesMs.length > MAX_SAMPLES) this.intervalSamplesMs.shift();
    }
    this.lastArrivalAtMs = nowMs;
    this.samples.push(sample);
    this.totalObserved += 1;
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  report(input: GpsFieldInput): GpsFieldReport {
    const {readiness, session, preferences, nowMs} = input;
    const hint = gpsAcquisitionHint(preferences.acquisitionMode);
    const threshold = Math.max(15_000, hint.minTimeMs * 3);
    const sorted = [...this.intervalSamplesMs].sort((a, b) => a - b);
    const average = sorted.length
      ? sorted.reduce((sum, x) => sum + x, 0) / sorted.length : null;
    const active = session.status === 'tracking' ||
      session.status === 'tracking-no-link';
    const silenceSince = active
      ? this.lastArrivalAtMs ?? this.sessionStartAtMs : null;
    const silence = silenceSince === null
      ? null : Math.max(0, nowMs - silenceSince);
    const diagnostics = readiness
      ? buildGpsDiagnostics({readiness, session, preferences, nowMs}) : null;
    const lastFix = diagnostics?.fix ?? null;
    const headingQuality = this.headingQuality(lastFix, diagnostics, preferences);
    let quality: LocationQuality = 'unavailable';
    if (diagnostics && diagnostics.availability === 'ready' &&
        diagnostics.fixSource === 'session' &&
        diagnostics.fixState === 'fresh') {
      quality = diagnostics.accuracyAssessment === 'within-preference' &&
        (headingQuality === 'course-only' || headingQuality === 'low-speed')
        ? 'usable' : 'attention';
    } else if (diagnostics?.fixState === 'fresh') {
      quality = 'attention';
    }
    const notes: string[] = [];
    if (!readiness) notes.push('Android GPS status has not been checked yet.');
    else if (diagnostics?.availability === 'permission-denied') {
      notes.push('Precise location permission denied; diagnostics do not request access.');
    } else if (diagnostics?.availability === 'gps-disabled') {
      notes.push('GPS disabled on Android; existing session may stop or error.');
    } else if (diagnostics?.availability === 'app-backgrounded') {
      notes.push('App is not foregrounded; do not infer background tracking readiness.');
    }
    if (session.status === 'error') {
      notes.push('Existing location session reports an error; use the normal GPS controls.');
    }
    if (diagnostics?.fixSource === 'breadcrumb') {
      notes.push('Last-known position is a historical saved breadcrumb, not a live fix.');
    }
    if (diagnostics?.fixState === 'stale' || (silence !== null && silence > threshold)) {
      notes.push('Location update is overdue; location may be unusable for convoy decisions.');
    }
    if (diagnostics?.fixState === 'future-dated' ||
        diagnostics?.fixState === 'invalid') {
      notes.push('Position timestamp or content is invalid; do not treat as current.');
    }
    if (this.lastSource === 'simulation') {
      notes.push('Simulation source: observed intervals are not physical Android GPS performance.');
    }
    if (this.totalObserved < 2) {
      notes.push('At least two observed fixes are needed to measure an update interval.');
    }
    notes.push('Measured intervals are UI-observed fix arrivals, not native guaranteed cadence.');
    notes.push('No GPS power drain, battery current, or heading sensor accuracy is measured.');
    notes.push('Independent background or process-restart GPS acquisition is not established.');

    return {
      diagnostics,
      observedSource: classifySource(session.providerLabel),
      headingQuality,
      quality,
      batteryPolicy: preferences.acquisitionMode === 'responsive'
        ? 'Frequent GPS update requests; potentially higher battery use (not measured).'
        : preferences.acquisitionMode === 'balanced'
          ? 'Moderate GPS update requests; real battery use is not measured.'
          : 'Reduced GPS update requests; monitor convoy position gaps (not measured power).',
      acquisitionMode: preferences.acquisitionMode,
      requestHintMs: hint.minTimeMs,
      requestHintMeters: hint.minDistanceMeters,
      statistics: {
        observedFixes: this.totalObserved,
        intervalCount: this.totalIntervals,
        averageMs: rounded(average),
        medianMs: rounded(percentile(sorted, 0.5)),
        p95Ms: rounded(percentile(sorted, 0.95)),
        maximumMs: sorted.length ? Math.max(...sorted) : null,
        observedHz: average !== null && average > 0
          ? Math.round(10_000 / average) / 10 : null,
        longGaps: this.longGaps,
        currentSilenceMs: silence,
        longGapThresholdMs: threshold,
        rejectedObservations: this.rejectedObservations,
      },
      lossEvents: this.lossEvents,
      recoveryEvents: this.recoveryEvents,
      providerDisabledEvents: this.providerDisabledEvents,
      permissionDeniedEvents: this.permissionDeniedEvents,
      backgroundTransitions: this.backgroundTransitions,
      restartRecoverySupported: false,
      notes,
    };
  }

  private headingQuality(
    fix: BushMeshLocationFix | null,
    diagnostics: GpsDiagnosticResult | null,
    preferences: GpsPreferencesV1,
  ): HeadingQuality {
    if (!fix || fix.headingDegrees == null) return 'unavailable';
    if (fix.headingDegrees < 0 || fix.headingDegrees >= 360 ||
        !Number.isFinite(fix.headingDegrees)) return 'invalid';
    if (!diagnostics || diagnostics.fixState !== 'fresh' ||
        diagnostics.fixSource !== 'session') return 'stale';
    if (fix.speedKmh != null && fix.speedKmh < 5) return 'low-speed';
    if (fix.accuracyMeters == null ||
        fix.accuracyMeters > preferences.accuracyWarningMeters) return 'coarse-fix';
    if (fix.speedKmh == null) return 'speed-unknown';
    // Android provider reports course/bearing but not bearing uncertainty.
    return 'course-only';
  }
}

/** Explicit, bounded, field-safe summary. Never serializes raw session/errors. */
export function gpsFieldExportSummary(input: {
  report: GpsFieldReport;
  preferences: GpsPreferencesV1;
  nowMs: number;
  includePreciseCoordinates?: boolean;
}): Record<string, unknown> {
  const {report, preferences, nowMs} = input;
  const fix = report.diagnostics?.fix;
  const summary: Record<string, unknown> = {
    schemaVersion: 1,
    category: 'bushmesh-gps-field-validation',
    generatedAt: new Date(nowMs).toISOString(),
    privacy: input.includePreciseCoordinates
      ? 'Explicitly opted in to include last position'
      : 'No coordinates, radio IDs, device IDs, keys, or raw tracks',
    sourceClass: report.observedSource,
    acquisitionMode: preferences.acquisitionMode,
    requestedMinUpdateMs: report.requestHintMs,
    requestedMinDistanceMeters: report.requestHintMeters,
    measuredObservedIntervals: report.statistics,
    readiness: {
      availability: report.diagnostics?.availability ?? 'unknown',
      foregroundStartReady: report.diagnostics?.foregroundStartReady ?? false,
      backgroundStartReady: false,
      nativeTracking: report.diagnostics?.nativeTracking ?? null,
    },
    lastFix: {
      state: report.diagnostics?.fixState ?? 'unknown',
      source: report.diagnostics?.fixSource ?? 'none',
      ageSeconds: report.diagnostics?.fixAgeMs == null
        ? null : Math.round(report.diagnostics.fixAgeMs / 1_000),
      accuracyMeters: fix?.accuracyMeters ?? null,
      speedKmh: fix?.speedKmh ?? null,
      headingQuality: report.headingQuality,
    },
    quality: report.quality,
    batteryPolicy: report.batteryPolicy,
    lossEvents: report.lossEvents,
    recoveryEvents: report.recoveryEvents,
    providerDisabledEvents: report.providerDisabledEvents,
    permissionDeniedEvents: report.permissionDeniedEvents,
    backgroundTransitions: report.backgroundTransitions,
    warnings: report.notes,
    limits: {
      intervalsMeasuredAt: 'Mounted React Native UI only',
      nativeFixCallbackTimestamps: false,
      radioPositionSchedulerChanged: false,
      batteryCurrentMeasured: false,
      processRestartTrackingVerified: false,
    },
  };
  if (input.includePreciseCoordinates && fix &&
      !validateLocationFix(fix)) {
    summary.optInLastPosition = {
      latitude: fix.latitude,
      longitude: fix.longitude,
      historical: report.diagnostics?.fixSource === 'breadcrumb',
    };
  }
  return summary;
}
