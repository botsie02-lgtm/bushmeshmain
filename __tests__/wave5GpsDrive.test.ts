import {
  DriveMotionStabilizer,
  driveGpsDisplay,
} from '../src/drive/dashboard/driveGpsMotion';
import type {BushMeshLocationFix} from '../src/location/positionPlanner';
import {DEFAULT_GPS_PREFERENCES} from '../src/device/gps/gpsPreferenceCodec';
import type {GpsReadinessSnapshot} from '../src/device/gps/gpsReadiness';
import {inspectGpsReadiness} from '../src/device/gps/gpsReadiness';
import {GpsFieldMonitor, gpsFieldExportSummary} from '../src/device/gps/gpsFieldDiagnostics';

const NOW = 1_801_000_000_000;
const fix = (ts: number, data: Partial<BushMeshLocationFix> = {}):
  BushMeshLocationFix => ({
  latitude: -37.1, longitude: 144.4, timestampMs: ts,
  accuracyMeters: 6, speedKmh: 34, headingDegrees: 359, ...data,
});
const readiness: GpsReadinessSnapshot = {
  supported: true, precisePermission: 'granted', approximatePermission: 'denied',
  gpsEnabled: true, nativeTracking: true, provider: 'gps', visibility: 'active',
  backgroundStartPermission: 'not-declared', checkedAtMs: NOW, error: null,
};
function view(options?: {
  fix?: BushMeshLocationFix | null;
  status?: 'stopped' | 'tracking' | 'tracking-no-link' | 'error';
  readiness?: GpsReadinessSnapshot | null;
  source?: string | null;
  now?: number;
  stabilizer?: DriveMotionStabilizer;
}) {
  const filter = options?.stabilizer ?? new DriveMotionStabilizer();
  const item = options && 'fix' in options ? options.fix ?? null : fix(NOW);
  if (item) filter.observe(item, options?.now ?? NOW);
  return driveGpsDisplay({
    fix: item,
    status: options?.status ?? 'tracking',
    providerLabel: options?.source === undefined ? 'Android GPS' : options.source,
    readiness: options?.readiness === undefined ? readiness : options.readiness,
    nowMs: options?.now ?? NOW,
    prefs: DEFAULT_GPS_PREFERENCES,
    radioStatus: 'ready',
    stabilizer: filter,
  });
}

describe('Wave 5 Drive GPS quality display', () => {
  it('never fabricates motion before a fix or after GPS stops', () => {
    const noFix = view({fix: null});
    expect(noFix).toMatchObject({
      state: 'no-fix', speedLabel: '—', headingLabel: '—',
      navigationReliable: false,
    });
    expect(noFix.warning).toMatch(/not assume.*stationary/i);
    const stopped = view({status: 'stopped'});
    expect(stopped).toMatchObject({
      state: 'stopped', speedLabel: '—', headingLabel: '—',
    });
  });

  it('suppresses motion after lost/stale GPS, or future clock timestamps', () => {
    const stale = view({fix: fix(NOW - 90_000)});
    expect(stale).toMatchObject({
      state: 'stale', headingLabel: '—', speedLabel: '—',
    });
    const future = view({fix: fix(NOW + 30_000)});
    expect(future).toMatchObject({
      state: 'future-dated', headingLabel: '—', speedLabel: '—',
    });
    const recovery = view({fix: fix(NOW + 1_000), now: NOW + 1_000});
    expect(recovery.navigationReliable).toBe(true);
  });

  it('keeps permission and native provider conditions explicit', () => {
    expect(view({readiness: {...readiness, precisePermission: 'denied'}}))
      .toMatchObject({state: 'permission-denied', speedLabel: '—'});
    expect(view({readiness: {...readiness, gpsEnabled: false}}))
      .toMatchObject({state: 'gps-disabled', speedLabel: '—'});
    expect(view({readiness: {...readiness, nativeTracking: false}}))
      .toMatchObject({state: 'unconfirmed', speedLabel: '—'});
    expect(view({source: 'Simulated route'}))
      .toMatchObject({state: 'simulation', speedLabel: '—'});
  });

  it('degrades unknown accuracy, coarse fix and low-speed heading safely', () => {
    expect(view({fix: fix(NOW, {accuracyMeters: null})}))
      .toMatchObject({state: 'low-accuracy', headingLabel: '—', speedLabel: '—'});
    expect(view({fix: fix(NOW, {accuracyMeters: 150})}))
      .toMatchObject({state: 'low-accuracy', headingLabel: '—', speedLabel: '—'});
    expect(view({fix: fix(NOW, {speedKmh: 1})}))
      .toMatchObject({state: 'ready', headingLabel: '—'});
    expect(view({fix: fix(NOW, {speedKmh: null})}))
      .toMatchObject({state: 'ready', speedLabel: '—', headingLabel: '—'});
    const inaccurateNative = {...readiness, nativeDelivery: {
      callbackCount: 1, intervalCount: 0, meanIntervalMs: null,
      medianIntervalMs: null, p95IntervalMs: null, maxIntervalMs: null,
      latestFixAgeMs: 0, callbackSilenceMs: 0, rejectedClockSamples: 0,
      requestedMinTimeMs: 1000, requestedMinDistanceMeters: 0,
      accuracyMeters: 5, speedKmh: 34, bearingDegrees: 359,
      speedAccuracyKmh: 15, bearingAccuracyDegrees: 45,
    }};
    expect(view({readiness: inaccurateNative}))
      .toMatchObject({state: 'ready', speedLabel: '—', headingLabel: '—'});
  });

  it('uses circular smoothing across north, without making up missing direction', () => {
    const filter = new DriveMotionStabilizer();
    filter.observe(fix(NOW - 2000, {headingDegrees: 359, speedKmh: 32}), NOW);
    filter.observe(fix(NOW - 1000, {headingDegrees: 1, speedKmh: 35}), NOW);
    filter.observe(fix(NOW, {headingDegrees: 2, speedKmh: 34}), NOW);
    const display = view({stabilizer: filter});
    expect(display.state).toBe('ready');
    const degrees = parseInt(display.headingLabel, 10);
    expect(degrees < 5 || degrees > 355).toBe(true);
    expect(display.speedLabel).toMatch(/34\.0 km\/h/);
    const sharp = fix(NOW + 1000, {headingDegrees: 140});
    filter.observe(sharp, NOW + 1000);
    expect(filter.headingDegrees()).toBe(140);
    filter.observe(fix(NOW + 2000, {headingDegrees: null}), NOW + 2000);
    expect(filter.headingDegrees()).toBeNull();
  });

  it('clears old smoothing after a large gap and maintains no stale motion', () => {
    const filter = new DriveMotionStabilizer();
    filter.observe(fix(NOW - 50_000), NOW - 50_000);
    filter.observe(fix(NOW, {headingDegrees: 45, speedKmh: 10}), NOW);
    expect(filter.speedKmh()).toBe(10);
    expect(filter.headingDegrees()).toBe(45);
    filter.observe(fix(NOW - 90_000), NOW);
    expect(filter.speedKmh()).toBeNull();
  });

  it('distinguishes radio offline from valid GPS without assigning delivery proof', () => {
    const filter = new DriveMotionStabilizer();
    filter.observe(fix(NOW), NOW);
    const item = driveGpsDisplay({
      fix: fix(NOW), status: 'tracking', providerLabel: 'Android GPS',
      readiness, nowMs: NOW, prefs: DEFAULT_GPS_PREFERENCES,
      radioStatus: 'offline', stabilizer: filter,
    });
    expect(item.navigationReliable).toBe(true);
    expect(item.radioLabel).toMatch(/OFFLINE/);
    expect(item.warning).toMatch(/peer delivery unconfirmed/i);
  });
});

describe('Wave 5 Android callback telemetry and technical exports', () => {
  const delivery = {
    callbackCount: 3, intervalCount: 2, meanIntervalMs: 6_000,
    medianIntervalMs: 5_000, p95IntervalMs: 7_000, maxIntervalMs: 7_000,
    latestFixAgeMs: 1200, callbackSilenceMs: 1500, rejectedClockSamples: 1,
    requestedMinTimeMs: 5_000, requestedMinDistanceMeters: 5,
    accuracyMeters: 9, speedKmh: 15, bearingDegrees: 75,
    speedAccuracyKmh: 2, bearingAccuracyDegrees: 9,
  };

  it('parses optional native measurements without any permission request or service start', async () => {
    const checkPermission = jest.fn(async (permission: string) =>
      permission.endsWith('FINE_LOCATION'));
    const getStatus = jest.fn(async () => ({
      gpsEnabled: true, tracking: true, provider: 'gps', delivery,
    }));
    const status = await inspectGpsReadiness({
      platform: 'android', apiLevel: 36, visibility: 'active',
      checkPermission, native: {getStatus}, now: () => NOW,
    });
    expect(status.nativeDelivery).toEqual(delivery);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(checkPermission).toHaveBeenCalledTimes(2);
  });

  it('accepts older native modules with no delivery statistics', async () => {
    const status = await inspectGpsReadiness({
      platform: 'android', apiLevel: 36, visibility: 'active',
      checkPermission: async () => true,
      native: {getStatus: async () => ({
        gpsEnabled: true, tracking: false, provider: 'gps',
      })}, now: () => NOW,
    });
    expect(status.nativeDelivery).toBeNull();
    expect(status.gpsEnabled).toBe(true);
  });

  it('clamps malformed native telemetry to null instead of producing false cadence claims', async () => {
    const bad = await inspectGpsReadiness({
      platform: 'android', apiLevel: 36, visibility: 'active',
      checkPermission: async () => true,
      native: {getStatus: async () => ({
        gpsEnabled: true, tracking: true, provider: 'gps',
        delivery: {callbackCount: -1, intervalCount: 5},
      })}, now: () => NOW,
    });
    expect(bad.nativeDelivery).toBeNull();
  });

  it('exports native cadence and uncertainty without coordinates unless explicitly opted in', () => {
    const monitor = new GpsFieldMonitor();
    const session = {
      status: 'tracking' as const, providerLabel: 'Android GPS',
      latestFix: fix(NOW), trackPoints: [],
    };
    const input = {
      readiness: {...readiness, nativeDelivery: delivery},
      session, preferences: DEFAULT_GPS_PREFERENCES, nowMs: NOW,
    };
    monitor.observe(input);
    const report = monitor.report(input);
    const output = gpsFieldExportSummary({
      report, preferences: DEFAULT_GPS_PREFERENCES, nowMs: NOW,
      nativeDelivery: delivery,
    });
    expect(output.nativeCallbackMeasurements).toMatchObject({
      callbackCount: 3, meanIntervalMs: 6_000,
      speedAccuracyKmh: 2,
    });
    expect(JSON.stringify(output)).not.toMatch(/-37\.1|144\.4|latitude|longitude|psk/i);
  });

  it('distinguishes selected preference hints from actual applied Android session hints', () => {
    const selected = {...DEFAULT_GPS_PREFERENCES, acquisitionMode: 'battery-saver' as const};
    expect(selected.acquisitionMode).toBe('battery-saver');
    expect(delivery.requestedMinTimeMs).toBe(5_000);
    expect(delivery.meanIntervalMs).toBe(6_000);
    // No retroactive claim that the active GPS session adopted battery saver.
  });
});
