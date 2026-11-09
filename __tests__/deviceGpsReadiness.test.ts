import {
  inspectGpsReadiness,
} from '../src/device/gps/gpsReadiness';
import {
  buildGpsDiagnostics, formatGpsAge, LocationSessionObservation,
} from '../src/device/gps/gpsDiagnostics';
import {DEFAULT_GPS_PREFERENCES} from '../src/device/gps/gpsPreferenceCodec';
import {GpsReadinessSnapshot} from '../src/device/gps/gpsReadiness';

const NOW = 1_800_000_000_000;
const validFix = {
  latitude: -37.81, longitude: 144.96, timestampMs: NOW - 20_000,
  accuracyMeters: 12, altitudeMeters: 23, speedKmh: 42,
  headingDegrees: 45,
};
const readiness: GpsReadinessSnapshot = {
  supported: true,
  precisePermission: 'granted',
  approximatePermission: 'granted',
  gpsEnabled: true,
  nativeTracking: true,
  provider: 'gps',
  visibility: 'active',
  backgroundStartPermission: 'not-declared',
  checkedAtMs: NOW,
  error: null,
};
const session: LocationSessionObservation = {
  status: 'tracking',
  providerLabel: 'Android GPS',
  latestFix: validFix,
  trackPoints: [],
};

function diagnostics(input: {
  readiness?: GpsReadinessSnapshot;
  session?: LocationSessionObservation;
  nowMs?: number;
  staleAfterSeconds?: 45 | 90 | 180;
}) {
  return buildGpsDiagnostics({
    readiness: input.readiness ?? readiness,
    session: input.session ?? session,
    preferences: {
      ...DEFAULT_GPS_PREFERENCES,
      staleAfterSeconds: input.staleAfterSeconds ?? 45,
    },
    nowMs: input.nowMs ?? NOW,
  });
}

describe('GPS read-only inspection and freshness', () => {
  it('reads existing Android status and permissions without requesting anything', async () => {
    const getStatus = jest.fn(async () => ({
      tracking: false, gpsEnabled: true, provider: 'gps',
    }));
    const checkPermission = jest.fn(async (permission: string) =>
      permission.includes('FINE'));
    const result = await inspectGpsReadiness({
      platform: 'android', apiLevel: 35, visibility: 'active',
      checkPermission, native: {getStatus}, now: () => NOW,
    });
    expect(result).toMatchObject({
      supported: true, precisePermission: 'granted',
      approximatePermission: 'denied', gpsEnabled: true,
      nativeTracking: false, backgroundStartPermission: 'not-declared',
    });
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(checkPermission).toHaveBeenCalledTimes(2);
    expect(Object.keys(result)).not.toContain('longitude');
  });

  it('surfaces denied permission, disabled GPS and inability to inspect status distinctly', async () => {
    const denied = await inspectGpsReadiness({
      platform: 'android', apiLevel: 34, visibility: 'active',
      checkPermission: async () => false,
      native: {getStatus: async () => ({
        tracking: false, gpsEnabled: true, provider: 'gps',
      })}, now: () => NOW,
    });
    expect(diagnostics({readiness: denied}).availability).toBe('permission-denied');
    expect(diagnostics({readiness: {
      ...readiness, gpsEnabled: false,
    }}).availability).toBe('gps-disabled');
    const unreadable = await inspectGpsReadiness({
      platform: 'android', apiLevel: 34, visibility: 'active',
      checkPermission: async () => {throw new Error('Not allowed');},
      native: {getStatus: async () => {throw new Error('Provider error');}},
      now: () => NOW,
    });
    expect(unreadable.gpsEnabled).toBeNull();
    expect(unreadable.precisePermission).toBe('unknown');
    expect(unreadable.error).toContain('Provider error');
    expect(diagnostics({readiness: unreadable}).availability).toBe('permission-unknown');
  });

  it('does not report a ready foreground/background start on unsupported hardware', async () => {
    const report = await inspectGpsReadiness({
      platform: 'ios', apiLevel: 0, visibility: 'unknown',
      checkPermission: async () => {throw new Error('must not call');},
      native: null, now: () => NOW,
    });
    expect(diagnostics({readiness: report}).availability).toBe('unsupported');
    expect(diagnostics({readiness: report}).foregroundStartReady).toBe(false);
    expect(diagnostics({readiness: report}).backgroundStartReady).toBe(false);
  });

  it('does not claim a fresh GPS fix when there is no source or position', () => {
    const missing = diagnostics({session: {
      status: 'stopped', providerLabel: null, latestFix: null, trackPoints: [],
    }});
    expect(missing.fixState).toBe('none');
    expect(missing.fix).toBeNull();
    expect(missing.fixSource).toBe('none');
    expect(missing.locationSourceLabel).toBe('No location source');
  });

  it('marks stale/future-dated or imprecise fixes, and keeps display thresholds independent', () => {
    expect(diagnostics({nowMs: NOW + 60_000}).fixState).toBe('stale');
    expect(diagnostics({nowMs: NOW + 60_000, staleAfterSeconds: 180})
      .fixState).toBe('fresh');
    expect(diagnostics({session: {
      ...session, latestFix: {...validFix, timestampMs: NOW + 20_000},
    }}).fixState).toBe('future-dated');
    expect(diagnostics({session: {
      ...session, latestFix: {...validFix, accuracyMeters: 300},
    }}).accuracyAssessment).toBe('low-accuracy');
    expect(formatGpsAge(125_000)).toBe('2m 5s ago');
  });

  it('after restart shows a saved breadcrumb as historical, not a current GPS session', () => {
    const report = diagnostics({session: {
      status: 'stopped', providerLabel: null,
      latestFix: null,
      trackPoints: [{...validFix, timestampMs: NOW - 300_000,
        recordedAtMs: NOW - 300_000}],
    }});
    expect(report.fixState).toBe('stale');
    expect(report.fixSource).toBe('breadcrumb');
    expect(report.locationSourceLabel).toMatch(/historical/i);
    expect(report.nativeTracking).toBe(true);
  });

  it('foreground-started tracking can continue, but background starts are not claimed ready', () => {
    const result = diagnostics({readiness: {
      ...readiness, visibility: 'background', nativeTracking: true,
    }});
    expect(result.foregroundStartReady).toBe(false);
    expect(result.backgroundStartReady).toBe(false);
    expect(result.backgroundHint).toMatch(/already|reported active|foreground-started/i);
    expect(diagnostics({session: {
      ...session, providerLabel: 'Simulated route',
    }}).locationSourceLabel).toBe('Simulated route');
  });
});
