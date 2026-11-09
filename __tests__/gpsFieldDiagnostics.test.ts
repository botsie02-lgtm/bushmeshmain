import {
  GpsFieldInput,
  GpsFieldMonitor,
  gpsFieldExportSummary,
} from '../src/device/gps/gpsFieldDiagnostics';
import {
  DEFAULT_GPS_PREFERENCES,
  GpsAcquisitionMode,
} from '../src/device/gps/gpsPreferenceCodec';
import {GpsReadinessSnapshot} from '../src/device/gps/gpsReadiness';

const START = 1_800_000_000_000;

const baselineReadiness: GpsReadinessSnapshot = {
  supported: true,
  precisePermission: 'granted',
  approximatePermission: 'denied',
  gpsEnabled: true,
  nativeTracking: true,
  provider: 'gps',
  visibility: 'active',
  backgroundStartPermission: 'not-declared',
  checkedAtMs: START,
  error: null,
};
const fix = (timestampMs: number, accuracyMeters = 9, speedKmh = 45) => ({
  latitude: -37.814,
  longitude: 144.963,
  timestampMs,
  accuracyMeters,
  speedKmh,
  headingDegrees: 72,
});

function frame(
  nowMs: number,
  options?: {
    timestampMs?: number | null;
    gpsEnabled?: boolean;
    precisePermission?: GpsReadinessSnapshot['precisePermission'];
    visibility?: GpsReadinessSnapshot['visibility'];
    status?: GpsFieldInput['session']['status'];
    source?: string | null;
    mode?: GpsAcquisitionMode;
    accuracyMeters?: number;
    speedKmh?: number;
  },
): GpsFieldInput {
  return {
    nowMs,
    readiness: {
      ...baselineReadiness,
      gpsEnabled: options?.gpsEnabled ?? true,
      precisePermission: options?.precisePermission ?? 'granted',
      visibility: options?.visibility ?? 'active',
    },
    preferences: {
      ...DEFAULT_GPS_PREFERENCES,
      acquisitionMode: options?.mode ?? 'responsive',
    },
    session: {
      status: options?.status ?? 'tracking',
      providerLabel: options?.source === undefined ? 'Android GPS' : options.source,
      latestFix: options?.timestampMs === null ? null
        : fix(options?.timestampMs ?? nowMs,
          options?.accuracyMeters ?? 9, options?.speedKmh ?? 45),
      trackPoints: [],
    },
  };
}

describe('GPS field diagnostic monitor – reproducible virtual field timeline', () => {
  it('detects GPS disabled mid-session then recovery, without any native service action', () => {
    const m = new GpsFieldMonitor();
    const working = frame(START);
    m.observe(working);
    expect(m.report(working).quality).toBe('usable');

    const disabled = frame(START + 15_000, {
      timestampMs: START, gpsEnabled: false,
    });
    m.observe(disabled);
    expect(m.report(disabled)).toMatchObject({
      providerDisabledEvents: 1,
      lossEvents: 1,
      recoveryEvents: 0,
      quality: 'attention',
    });
    m.observe(disabled);
    expect(m.report(disabled).providerDisabledEvents).toBe(1);

    const recovered = frame(START + 20_000, {
      timestampMs: START + 20_000,
    });
    m.observe(recovered);
    expect(m.report(recovered).recoveryEvents).toBe(1);
    expect(m.report(recovered).quality).toBe('usable');
  });

  it('detects denied precise permission and counts a loss once, before recovery', () => {
    const m = new GpsFieldMonitor();
    m.observe(frame(START));
    const denied = frame(START + 5_000, {
      precisePermission: 'denied', timestampMs: START,
    });
    m.observe(denied);
    m.observe(frame(START + 6_000, {
      precisePermission: 'denied', timestampMs: START,
    }));
    expect(m.report(denied).permissionDeniedEvents).toBe(1);
    expect(m.report(denied).diagnostics?.availability).toBe('permission-denied');
    expect(m.report(denied).lossEvents).toBe(1);
    const recovery = frame(START + 9_000);
    m.observe(recovery);
    expect(m.report(recovery).recoveryEvents).toBe(1);
  });

  it('reports no fix, long silence, stale fix and recovery without inventing dropped GPS callbacks', () => {
    const m = new GpsFieldMonitor();
    const missing = frame(START, {timestampMs: null});
    m.observe(missing);
    expect(m.report(missing).statistics).toMatchObject({
      observedFixes: 0,
      intervalCount: 0,
      averageMs: null,
      currentSilenceMs: 0,
    });
    const first = frame(START + 5_000);
    m.observe(first);
    const silence = frame(START + 240_000, {
      timestampMs: START + 5_000,
    });
    m.observe(silence);
    expect(m.report(silence).diagnostics?.fixState).toBe('stale');
    expect(m.report(silence).statistics.currentSilenceMs).toBe(235_000);
    expect(m.report(silence).lossEvents).toBe(1);
    const recovered = frame(START + 245_000);
    m.observe(recovered);
    expect(m.report(recovered)).toMatchObject({
      lossEvents: 1, recoveryEvents: 1,
    });
    // A gap is observed, but the number of missed Android fixes is unknown.
    expect(m.report(recovered).statistics).toMatchObject({
      intervalCount: 1, longGaps: 1,
      maximumMs: 240_000,
    });
  });

  it('records measured UI arrival gaps independent of the saved Android request hint', () => {
    const m = new GpsFieldMonitor();
    const arrivals = [
      START, START + 2_000, START + 5_000, START + 12_000,
    ];
    for (const at of arrivals) {
      m.observe(frame(at, {mode: 'responsive'}));
    }
    const responsive = m.report(frame(START + 12_000, {
      mode: 'responsive',
    }));
    expect(responsive.requestHintMs).toBe(1_000);
    expect(responsive.statistics).toMatchObject({
      observedFixes: 4,
      intervalCount: 3,
      medianMs: 3_000,
      maximumMs: 7_000,
      observedHz: 0.3,
    });
    const balanced = m.report(frame(START + 12_000, {
      mode: 'balanced',
    }));
    const battery = m.report(frame(START + 12_000, {
      mode: 'battery-saver',
    }));
    expect(balanced.requestHintMs).toBe(5_000);
    expect(battery.requestHintMs).toBe(15_000);
    expect(battery.requestHintMeters).toBe(25);
    expect(battery.statistics.medianMs).toBe(3_000);
    expect(battery.batteryPolicy).toMatch(/not measured power/i);
  });

  it('does not span independent sessions or interpret preferences saved mid-session as measured', () => {
    const m = new GpsFieldMonitor();
    m.observe(frame(START));
    m.observe(frame(START + 5_000));
    const stopped = frame(START + 10_000, {status: 'stopped', timestampMs: null});
    m.observe(stopped);
    const restart = frame(START + 3_600_000, {
      mode: 'battery-saver',
    });
    m.observe(restart);
    const next = frame(START + 3_618_000, {
      mode: 'battery-saver',
    });
    m.observe(next);
    const stats = m.report(next).statistics;
    expect(stats.intervalCount).toBe(2);
    expect(stats.maximumMs).toBe(18_000);
    expect(stats.longGaps).toBe(0);
  });

  it('detects low-speed heading, coarse accuracy, missing speed and future-dated fix', () => {
    const m = new GpsFieldMonitor();
    const slow = frame(START, {speedKmh: 0});
    m.observe(slow);
    expect(m.report(slow).headingQuality).toBe('low-speed');
    const coarse = frame(START + 10_000, {accuracyMeters: 300});
    m.observe(coarse);
    expect(m.report(coarse)).toMatchObject({
      headingQuality: 'coarse-fix', quality: 'attention',
    });
    const future = frame(START + 15_000, {
      timestampMs: START + 120_000,
    });
    m.observe(future);
    expect(m.report(future).diagnostics?.fixState).toBe('future-dated');
    expect(m.report(future).statistics.rejectedObservations).toBe(1);
    expect(m.report(future).headingQuality).toBe('stale');
    const badBearing = frame(START + 20_000);
    badBearing.session.latestFix!.headingDegrees = 900;
    m.observe(badBearing);
    expect(m.report(badBearing).headingQuality).toBe('invalid');
  });

  it('does not treat a saved breadcrumb after process restart as a live fix', () => {
    const afterRestart = new GpsFieldMonitor();
    const old = frame(START + 60_000, {
      status: 'stopped', timestampMs: null, source: null,
    });
    old.session.trackPoints = [{
      ...fix(START - 300_000), recordedAtMs: START - 300_000,
    }];
    afterRestart.observe(old);
    const result = afterRestart.report(old);
    expect(result.statistics.observedFixes).toBe(0);
    expect(result.diagnostics?.fixSource).toBe('breadcrumb');
    expect(result.diagnostics?.fixState).toBe('stale');
    expect(result.notes.join(' ')).toContain('historical saved breadcrumb');
    expect(result.restartRecoverySupported).toBe(false);
  });

  it('never claims independent background tracking or reliable screen-lock acquisition', () => {
    const m = new GpsFieldMonitor();
    const foreground = frame(START);
    m.observe(foreground);
    const background = frame(START + 30_000, {
      timestampMs: START, visibility: 'background',
    });
    m.observe(background);
    const result = m.report(background);
    expect(result.backgroundTransitions).toBe(1);
    expect(result.diagnostics?.backgroundStartReady).toBe(false);
    expect(result.restartRecoverySupported).toBe(false);
    expect(result.notes.join(' ')).toMatch(/background/i);
    m.observe(background);
    expect(m.report(background).backgroundTransitions).toBe(1);
  });

  it('safe reset removes only counters while leaving session, fix and preferences intact', () => {
    const m = new GpsFieldMonitor();
    const first = frame(START);
    m.observe(first);
    const second = frame(START + 2_000);
    m.observe(second);
    expect(m.report(second).statistics.observedFixes).toBe(2);
    m.reset(second);
    m.observe(second);
    const result = m.report(second);
    expect(result.statistics.observedFixes).toBe(0);
    expect(result.statistics.intervalCount).toBe(0);
    expect(second.session.latestFix?.latitude).toBe(-37.814);
    expect(result.diagnostics?.fixState).toBe('fresh');
    m.observe(frame(START + 4_000));
    expect(m.report(frame(START + 4_000)).statistics.observedFixes).toBe(1);
  });

  it('de-duplicates the same location fix and bounds memory to 128 coordinate-free samples', () => {
    const m = new GpsFieldMonitor();
    for (let n = 0; n < 300; n += 1) {
      const current = frame(START + n * 2_000);
      m.observe(current);
      m.observe(current);
    }
    const result = m.report(frame(START + 600_000));
    expect(result.statistics.observedFixes).toBe(300);
    expect(result.statistics.intervalCount).toBe(299);
    const internalRepresentation = JSON.stringify(m);
    expect(internalRepresentation).not.toContain('latitude');
    expect(internalRepresentation).not.toContain('longitude');
    expect(internalRepresentation).not.toContain('-37.814');
    expect(internalRepresentation).not.toContain('144.963');
    const internal = JSON.parse(internalRepresentation);
    expect(internal.samples).toHaveLength(128);
    expect(internal.intervalSamplesMs).toHaveLength(128);
  });
});

describe('GPS field technical export – explicit privacy contract', () => {
  it('omits coordinates, raw session errors, identity and raw track by default', () => {
    const m = new GpsFieldMonitor();
    const input = frame(START);
    input.session.trackPoints = [{
      ...fix(START - 20_000), recordedAtMs: START - 20_000,
    }];
    m.observe(input);
    const report = m.report(input);
    const summary = gpsFieldExportSummary({
      report, preferences: input.preferences, nowMs: START,
    });
    const text = JSON.stringify(summary);
    expect(summary).toMatchObject({
      schemaVersion: 1,
      sourceClass: 'android-gps',
      readiness: {backgroundStartReady: false},
    });
    expect(text).not.toMatch(/-37\.814|144\.963|latitude|longitude|psk|privateKey|deviceAddress/i);
    expect(text).not.toContain('recordedAtMs');
    expect(text).toContain('observedFixes');
  });

  it('includes the last location only with an explicit opt-in; never includes full tracks', () => {
    const m = new GpsFieldMonitor();
    const input = frame(START);
    m.observe(input);
    const summary = gpsFieldExportSummary({
      report: m.report(input), preferences: input.preferences, nowMs: START,
      includePreciseCoordinates: true,
    });
    expect(summary).toMatchObject({
      optInLastPosition: {
        latitude: -37.814, longitude: 144.963, historical: false,
      },
    });
    expect(JSON.stringify(summary)).not.toContain('trackPoints');
  });
});
