import {BushMeshQuickActionCode} from '../../../bushmesh/legacyProtocol';
import type {DriveDashboardModel} from '../../dashboard/driveDashboardModel';
import type {BushMeshMapPackCatalogEntry} from '../../../maps/mapPackCatalog';
import type {DriveAlert} from '../../../state/DriveContext';
import {
  deriveFieldReadiness,
  type FieldReadinessInput,
} from '../fieldReadinessModel';

const NOW = 1_800_000_000_000;

function dashboard(): DriveDashboardModel {
  return {
    status: 'attention',
    statusTitle: 'DRIVE SETUP INCOMPLETE',
    statusDetail: 'Review trip readiness.',
    radioStatus: 'offline',
    connectionDetail: 'Radio disconnected.',
    convoy: {
      id: null, name: 'No active convoy', memberRosterVerified: false,
      verifiedMemberCount: null, live: 0, recent: 0, stale: 0,
      lost: 0, noPosition: 0,
    },
    gps: {
      fix: null, freshness: 'unknown', ageLabel: 'No valid fix',
      latitudeLabel: '—', longitudeLabel: '—', headingLabel: '—',
      accuracyLabel: '—', simulated: false, nativeSource: false,
      tracking: false,
    },
    maps: {
      status: 'no-pack', label: 'No verified map archive',
      detail: 'Download a map pack.',
    },
    incomingCarrierMessages: 8,
    outgoingPending: 2,
    outgoingFailed: 1,
    alerts: [],
    alertsAvailable: false,
    actionAvailability: {
      canTransmit: false,
      reason: 'Choose an authorised convoy.',
      channelIndex: null,
    },
    mapMembers: [],
  };
}

function registeredPack(
  state: 'not-installed' | 'ready' | 'installing' | 'invalid' = 'ready',
): BushMeshMapPackCatalogEntry {
  const artifact = {
    packId: 'alpine-map',
    manifestVersion: 'v1',
    format: 'pmtiles' as const,
    localUri: 'file:///private/alpine.pmtiles',
    bytes: 2048,
    sha256: 'a'.repeat(64),
    verifiedAtMs: NOW,
  };
  return {
    manifest: {
      schemaVersion: 1, id: 'alpine-map', name: 'Alpine',
      version: 'v1', bounds: {south: -41, west: 140, north: -35, east: 150},
      format: 'pmtiles', minZoom: 4, maxZoom: 14, tileSize: 256,
      expectedBytes: 2048, sha256: 'a'.repeat(64),
      source: {kind: 'remote', url: 'https://example.test/alpine.pmtiles'},
    },
    artifact: state === 'ready' ? artifact : null,
    installState: state,
    lastError: state === 'invalid' ? 'Checksum mismatch' : null,
  };
}

function input(overrides: Partial<FieldReadinessInput> = {}): FieldReadinessInput {
  return {
    dashboard: dashboard(),
    packCatalog: [],
    mapPackInstallSupported: false,
    mapPersistenceStatus: 'ready',
    imageryEvidence: null,
    speedKmh: null,
    nowMs: NOW,
    ...overrides,
  };
}

function operational(): DriveDashboardModel {
  const original = dashboard();
  return {
    ...original,
    status: 'ready',
    radioStatus: 'ready',
    convoy: {
      id: 'OP-CONVOY', name: 'High Country Group',
      memberRosterVerified: true,
      verifiedMemberCount: 3,
      live: 1, recent: 0, stale: 1, lost: 0, noPosition: 1,
    },
    gps: {
      fix: {
        latitude: -37.8, longitude: 146.1, receivedAtMs: NOW - 4_000,
        headingDegrees: 360, accuracyMeters: 6.4,
      },
      freshness: 'live', ageLabel: '4s ago',
      latitudeLabel: '-37.80000', longitudeLabel: '146.10000',
      headingLabel: '0°', accuracyLabel: '±6m',
      nativeSource: true, simulated: false, tracking: true,
    },
    maps: {
      status: 'ready', label: 'Trip pack coverage verified',
      detail: 'Trip points are covered.',
    },
    alertsAvailable: true,
    actionAvailability: {
      canTransmit: true, reason: '', channelIndex: 2,
    },
  };
}

function alert(
  id: string, action: BushMeshQuickActionCode, offsetMs = 0,
): DriveAlert {
  return {
    id, action, label: action === BushMeshQuickActionCode.Stop ? 'STOP' : 'HAZARD',
    description: 'Reported by verified sender.',
    senderId: 'VERIFIED-1', channelIndex: 2,
    latitude: -37.8, longitude: 146.1,
    packetTimestampSeconds: Math.floor((NOW + offsetMs) / 1000),
    receivedAtMs: NOW + offsetMs,
    expiresAtMs: NOW + offsetMs + 120_000,
    source: 'radio', snrDb: null, pathLength: null,
  };
}

describe('field readiness presentation model', () => {
  test('empty state is fail-closed with no fabricated convoy or map imagery', () => {
    const view = deriveFieldReadiness(input());
    expect(view.allChecksReady).toBe(false);
    expect(view.title).toBe('PRE-TRIP CHECK NEEDED');
    expect(view.radio.state).toBe('unavailable');
    expect(view.gps.state).toBe('unavailable');
    expect(view.gps.latitude).toBe('—');
    expect(view.maps.state).toBe('unavailable');
    expect(view.maps.imagery).toBe('not-confirmed');
    expect(view.maps.imageryLabel).toContain('NOT confirmed');
    expect(view.convoy.remoteCount).toBeNull();
    expect(view.convoy.state).toBe('awaiting-authorisation');
    expect(view.alerts).toEqual([]);
    expect(view.traffic.carrierRxLast5Min).toBe(8);
    expect(view.previewAvailable).toBe(true);
    expect(view.previewReason).toContain('LOCAL PREVIEW ONLY');
  });

  test('distinguishes disconnected, degraded and connected radio', () => {
    const down = deriveFieldReadiness(input()).radio;
    const degraded = deriveFieldReadiness(input({
      dashboard: {...dashboard(), radioStatus: 'connected'},
    })).radio;
    const connected = deriveFieldReadiness(input({
      dashboard: {...dashboard(), radioStatus: 'ready'},
    })).radio;
    expect([down.state, degraded.state, connected.state]).toEqual([
      'unavailable', 'degraded', 'connected',
    ]);
    expect(connected.detail).toContain('No other vehicle delivery');
  });

  test('stale GPS overrides prior live labels; heading and accuracy are grounded', () => {
    const live = deriveFieldReadiness(input({dashboard: operational()})).gps;
    expect(live.state).toBe('connected');
    expect(live.heading).toBe('N · 0°');
    expect(live.accuracy).toBe('±6 m');
    expect(live.positionAge).toBe('4 s ago');
    const old = operational();
    old.gps.fix = {...old.gps.fix!, receivedAtMs: NOW - 605_000};
    const stale = deriveFieldReadiness(input({dashboard: old})).gps;
    expect(stale.state).toBe('stale');
    expect(stale.lastKnown).toBe(true);
    expect(stale.positionAge).toBe('10 min ago');
    expect(stale.detail).toContain('Last-known');
    const stopped = operational();
    stopped.gps.tracking = false;
    expect(deriveFieldReadiness(input({dashboard: stopped})).gps.state)
      .toBe('degraded');
    const inaccurate = operational();
    inaccurate.gps.fix = {...inaccurate.gps.fix!, accuracyMeters: -1};
    expect(deriveFieldReadiness(input({dashboard: inaccurate})).gps.accuracy)
      .toBe('Unknown');
    expect(deriveFieldReadiness(input({dashboard: inaccurate})).gps.state)
      .toBe('degraded');
    const imprecise = operational();
    imprecise.gps.fix = {...imprecise.gps.fix!, accuracyMeters: 250};
    const weak = deriveFieldReadiness(input({dashboard: imprecise}));
    expect(weak.gps.state).toBe('degraded');
    expect(weak.gps.accuracy).toBe('±250 m');
    expect(weak.allChecksReady).toBe(false);
  });

  test('missing, revoked or unverified membership hides remote counts and alerts', () => {
    const lost = operational();
    lost.convoy.id = null; // revoked/identity rotated by Security v1 directory
    lost.convoy.name = 'Former convoy';
    lost.alerts = [alert('secret', BushMeshQuickActionCode.Stop)];
    expect(deriveFieldReadiness(input({dashboard: lost})).convoy.name)
      .toBe('No active convoy');
    expect(deriveFieldReadiness(input({dashboard: lost})).alerts).toEqual([]);
    expect(deriveFieldReadiness(input({dashboard: lost})).convoy.remoteCount)
      .toBeNull();

    const pending = operational();
    pending.convoy.memberRosterVerified = false;
    const view = deriveFieldReadiness(input({dashboard: pending}));
    expect(view.convoy.state).toBe('degraded');
    expect(view.convoy.title).toBe('Verified roster unavailable');
    expect(view.convoy.remoteCount).toBeNull();
    expect(view.alerts).toEqual([]);
  });

  test('only verified remote positions are shown; stale count needs attention', () => {
    const view = deriveFieldReadiness(input({dashboard: operational()}));
    expect(view.convoy.remoteCount).toBe(3);
    expect(view.convoy.live).toBe(1);
    expect(view.convoy.attention).toBe(2);
    expect(view.convoy.state).toBe('stale');
    expect(view.allChecksReady).toBe(false);
  });

  test('missing map packs and download availability remain explicit', () => {
    const notInstalled = deriveFieldReadiness(input({
      packCatalog: [registeredPack('not-installed')],
      mapPackInstallSupported: true,
    }));
    expect(notInstalled.maps.state).toBe('unavailable');
    expect(notInstalled.maps.downloadLabel).toContain('download needs connectivity');
    const installing = deriveFieldReadiness(input({
      packCatalog: [registeredPack('installing')],
      mapPackInstallSupported: true,
    }));
    expect(installing.maps.downloadLabel).toContain('in progress');
    const invalid = deriveFieldReadiness(input({
      packCatalog: [registeredPack('invalid')],
    }));
    expect(invalid.maps.downloadLabel).toContain('failed verification');
  });

  test('coverage shows measured required trip points, never invented routing', () => {
    const unknown = deriveFieldReadiness(input());
    expect(unknown.maps.coverageLabel).toContain('not been reported');
    const partial = deriveFieldReadiness(input({
      coverage: {coveredPointCount: 2, totalPointCount: 5},
    }));
    expect(partial.maps.coverageLabel).toContain('2/5');
    expect(partial.maps.coverageLabel).toContain('not routing');
    const empty = deriveFieldReadiness(input({
      coverage: {coveredPointCount: 0, totalPointCount: 0},
    }));
    expect(empty.maps.coverageLabel).toContain('not checked');
    const invalid = deriveFieldReadiness(input({
      coverage: {coveredPointCount: 8, totalPointCount: 4},
    }));
    expect(invalid.maps.coverageLabel).toContain('not been reported');
  });

  test('verified archive/coverage never becomes an image-loaded claim by itself', () => {
    const props = input({
      dashboard: operational(),
      packCatalog: [registeredPack()],
    });
    expect(deriveFieldReadiness(props).maps.imagery).toBe('not-confirmed');
    expect(deriveFieldReadiness(props).maps.state).toBe('degraded');
    const loaded = deriveFieldReadiness({
      ...props,
      imageryEvidence: {
        kind: 'loaded', packId: 'alpine-map',
        packVersion: 'v1', observedAtMs: NOW - 2_000,
      },
    });
    expect(loaded.maps.imagery).toBe('loaded');
    expect(loaded.maps.state).toBe('connected');
    const staleEvidence = deriveFieldReadiness({
      ...props,
      imageryEvidence: {
        kind: 'loaded', packId: 'alpine-map',
        packVersion: 'v1', observedAtMs: NOW - 90_000,
      },
    });
    expect(staleEvidence.maps.imagery).toBe('not-confirmed');
    const futureEvidence = deriveFieldReadiness({
      ...props,
      imageryEvidence: {
        kind: 'loaded', packId: 'alpine-map',
        packVersion: 'v1', observedAtMs: NOW + 1000,
      },
    });
    expect(futureEvidence.maps.imagery).toBe('not-confirmed');
    const wrongPack = deriveFieldReadiness({
      ...props,
      imageryEvidence: {
        kind: 'loaded', packId: 'public-online',
        packVersion: 'v1', observedAtMs: NOW,
      },
    });
    expect(wrongPack.maps.state).toBe('degraded');
    const failedImage = deriveFieldReadiness({
      ...props,
      imageryEvidence: {
        kind: 'failed', packId: 'alpine-map',
        packVersion: 'v1', observedAtMs: NOW,
      },
    });
    expect(failedImage.maps.imagery).toBe('failed');
    expect(failedImage.maps.state).toBe('degraded');
  });

  test('all checks pass only with verified roster and actual raster evidence', () => {
    const safe = operational();
    safe.convoy.stale = 0;
    safe.convoy.noPosition = 0;
    safe.convoy.live = 3;
    const output = deriveFieldReadiness(input({
      dashboard: safe,
      packCatalog: [registeredPack()],
      imageryEvidence: {
        kind: 'loaded', packId: 'alpine-map',
        packVersion: 'v1', observedAtMs: NOW - 500,
      },
    }));
    expect(output.allChecksReady).toBe(true);
    expect(output.title).toBe('FIELD CHECKS COMPLETE');
    expect(output.detail).toContain('not guaranteed');
  });

  test('verified alerts are prioritized; expired or future alerts are not displayed', () => {
    const safe = operational();
    safe.alerts = [
      alert('hazard', BushMeshQuickActionCode.Hazard, -5_000),
      alert('stop', BushMeshQuickActionCode.Stop, -4_000),
      alert('expired', BushMeshQuickActionCode.Stop, -240_000),
      alert('future', BushMeshQuickActionCode.Hazard, 60_000),
    ];
    const view = deriveFieldReadiness(input({dashboard: safe}));
    expect(view.alerts.map(item => item.id)).toEqual(['stop', 'hazard']);
  });

  test('movement suppresses complex preview interactions', () => {
    expect(deriveFieldReadiness(input({
      dashboard: operational(),
      speedKmh: 35,
    })).previewAvailable).toBe(false);
    expect(deriveFieldReadiness(input({
      dashboard: operational(),
      speedKmh: 35,
    })).previewReason).toContain('Stop in a safe place');
    const poorGps = operational();
    poorGps.gps.fix = {...poorGps.gps.fix!, accuracyMeters: 250};
    expect(deriveFieldReadiness(input({
      dashboard: poorGps,
      speedKmh: 35,
    })).previewAvailable).toBe(false);
  });
});
