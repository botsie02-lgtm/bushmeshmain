import type {AuthorizedConvoyMembership} from '../../../app/activeContext/operationalConvoy';
import {
  deriveDriveDashboard,
  type DriveDashboardInput,
} from '../driveDashboardModel';
import type {BushMeshMapPackCatalogEntry} from '../../../maps/mapPackCatalog';
import type {DriveAlert} from '../../../state/DriveContext';
import {BushMeshQuickActionCode} from '../../../bushmesh/legacyProtocol';

const NOW = 1_800_000_000_000;
const own = 'RADIO-A';
const convoyId = 'SECURE-CONVOY';
const active: AuthorizedConvoyMembership = {
  convoyId,
  displayName: 'Mountain Patrol',
  localIdentityRef: own,
  authorizationState: 'authorized',
  verifiedBy: 'security-v1',
  membershipRecordRef: 'verified-record-10',
};

function pack(): BushMeshMapPackCatalogEntry {
  return {
    manifest: {
      schemaVersion: 1,
      id: 'alpine-pack',
      name: 'Alpine',
      version: 'v1',
      bounds: {south: -40, west: 140, north: -36, east: 149},
      format: 'pmtiles',
      minZoom: 4,
      maxZoom: 14,
      tileSize: 256,
      expectedBytes: 64,
      sha256: 'f'.repeat(64),
      source: {kind: 'remote', url: 'https://example.test/alpine.pmtiles'},
    },
    artifact: {
      packId: 'alpine-pack',
      manifestVersion: 'v1',
      format: 'pmtiles',
      localUri: 'file:///app/private/alpine.pmtiles',
      bytes: 64,
      sha256: 'f'.repeat(64),
      verifiedAtMs: NOW,
    },
    installState: 'ready',
    lastError: null,
  };
}

function fixture(overrides: Partial<DriveDashboardInput> = {}): DriveDashboardInput {
  return {
    nowMs: NOW,
    activeConvoy: null,
    roster: null,
    verifiedAlerts: null,
    carrierBinding: null,
    radioConnectionStatus: 'Connected',
    activeCarrierChannelIndex: '2',
    radioSession: {
      identityRef: own,
      transportReady: true,
      queuedCount: 2,
      inflightCount: 1,
      failedCount: 0,
    },
    locationStatus: 'tracking',
    locationProviderLabel: 'Android GPS',
    latestFix: {
      latitude: -37.8,
      longitude: 145.1,
      timestampMs: NOW - 3_000,
      headingDegrees: 370,
      accuracyMeters: 5,
    },
    mapCoverage: {
      complete: false,
      coveredPointCount: 0,
      totalPointCount: 0,
      missingPointIndexes: [],
      readyPackIds: [],
    },
    requiredTripPointCount: 0,
    packCatalog: [],
    offlineTilesAvailable: false,
    channelMessages: [{
      id: 'public-message',
      direction: 'received',
      channelIndex: '2',
      createdAt: new Date(NOW - 30_000).toISOString(),
    }],
    ...overrides,
  };
}

function trusted(overrides: Partial<DriveDashboardInput> = {}): DriveDashboardInput {
  return fixture({
    activeConvoy: active,
    roster: {
      convoyId,
      localIdentityRef: own,
      verifiedBy: 'security-v1',
      members: [
        {id: 'LEAD', label: 'Lead', position: {
          latitude: -37.81, longitude: 145.12,
          receivedAtMs: NOW - 5_000, headingDegrees: 45,
        }},
        {id: 'TAIL', label: 'Tail', position: {
          latitude: -37.82, longitude: 145.13,
          receivedAtMs: NOW - 180_000, headingDegrees: null,
        }},
        {id: 'MISSING', label: 'No fix', position: null},
      ],
    },
    carrierBinding: {
      convoyId,
      localIdentityRef: own,
      verifiedBy: 'security-v1',
      channelIndex: 2,
    },
    ...overrides,
  });
}

function alert(atMs: number, id = 'alert-1'): DriveAlert {
  return {
    id,
    senderId: 'LEAD',
    action: BushMeshQuickActionCode.Hazard,
    label: 'HAZARD',
    description: 'Hazard on route.',
    channelIndex: 2,
    latitude: -37.81,
    longitude: 145.12,
    packetTimestampSeconds: Math.floor(atMs / 1000),
    receivedAtMs: atMs,
    expiresAtMs: atMs + 200_000,
    snrDb: null,
    pathLength: null,
    source: 'radio',
  };
}

describe('Drive dashboard trust separation', () => {
  test('public MeshCore traffic cannot create a verified convoy or member count', () => {
    const output = deriveDriveDashboard(fixture());
    expect(output.convoy.id).toBeNull();
    expect(output.convoy.verifiedMemberCount).toBeNull();
    expect(output.mapMembers).toEqual([]);
    expect(output.alerts).toEqual([]);
    expect(output.status).toBe('attention');
    expect(output.actionAvailability.canTransmit).toBe(false);
    expect(output.incomingCarrierMessages).toBe(1);
  });

  test('active membership without a verified roster is not enough', () => {
    const output = deriveDriveDashboard(fixture({activeConvoy: active}));
    expect(output.convoy.name).toBe(active.displayName);
    expect(output.convoy.verifiedMemberCount).toBeNull();
    expect(output.status).toBe('attention');
  });

  test('verified remote members are counted and aged without inferred discovery', () => {
    const output = deriveDriveDashboard(trusted());
    expect(output.convoy.verifiedMemberCount).toBe(3);
    expect(output.convoy.live).toBe(1);
    expect(output.convoy.stale).toBe(1);
    expect(output.convoy.noPosition).toBe(1);
    expect(output.mapMembers.map(item => item.id)).toEqual([
      'LEAD', 'TAIL', 'MISSING',
    ]);
    expect(output.gps.headingLabel).toBe('10°');
    expect(output.gps.freshness).toBe('live');
    expect(output.actionAvailability.canTransmit).toBe(true);
    expect(output.status).toBe('ready');
  });

  test('mismatched roster and carrier binding cannot authorise transmission', () => {
    const wrongRoster = trusted({
      roster: {
        convoyId: 'OTHER',
        localIdentityRef: own,
        verifiedBy: 'security-v1',
        members: [{id: 'PUBLIC', label: 'Public', position: null}],
      },
    });
    expect(deriveDriveDashboard(wrongRoster).convoy.verifiedMemberCount).toBeNull();
    expect(deriveDriveDashboard(wrongRoster).mapMembers).toEqual([]);
    expect(deriveDriveDashboard(wrongRoster).actionAvailability.canTransmit).toBe(false);

    const wrongCarrier = trusted({activeCarrierChannelIndex: '1'});
    expect(deriveDriveDashboard(wrongCarrier).actionAvailability.canTransmit).toBe(false);
    expect(deriveDriveDashboard(wrongCarrier).status).toBe('attention');
    const rotatedIdentity = trusted({
      radioSession: {...trusted().radioSession, identityRef: 'OTHER'},
    });
    expect(deriveDriveDashboard(rotatedIdentity).convoy.id).toBeNull();
  });

  test('lost, invalid and simulated GPS never grant driving setup readiness', () => {
    const stale = deriveDriveDashboard(trusted({
      latestFix: {...trusted().latestFix!, timestampMs: NOW - 601_000},
    }));
    expect(stale.gps.freshness).toBe('lost');
    expect(stale.status).toBe('attention');
    expect(stale.actionAvailability.canTransmit).toBe(false);

    const simulated = deriveDriveDashboard(trusted({
      locationProviderLabel: 'Simulated route',
    }));
    expect(simulated.gps.simulated).toBe(true);
    expect(simulated.actionAvailability.canTransmit).toBe(false);

    const invalid = deriveDriveDashboard(trusted({
      latestFix: {...trusted().latestFix!, latitude: 999},
    }));
    expect(invalid.gps.fix).toBeNull();
    expect(invalid.actionAvailability.canTransmit).toBe(false);
    const future = deriveDriveDashboard(trusted({
      latestFix: {...trusted().latestFix!, timestampMs: NOW + 90_000},
    }));
    expect(future.gps.fix).toBeNull();
    const stopped = deriveDriveDashboard(trusted({
      locationStatus: 'stopped',
    }));
    expect(stopped.gps.fix).not.toBeNull();
    expect(stopped.gps.tracking).toBe(false);
    expect(stopped.status).toBe('attention');
    expect(stopped.actionAvailability.canTransmit).toBe(false);
    const unverifiedProvider = deriveDriveDashboard(trusted({
      locationProviderLabel: 'Unknown provider',
    }));
    expect(unverifiedProvider.gps.nativeSource).toBe(false);
    expect(unverifiedProvider.actionAvailability.canTransmit).toBe(false);
  });

  test('verified archive metadata is not mistaken for readable tiles or a route', () => {
    const archiveOnly = deriveDriveDashboard(trusted({packCatalog: [pack()]}));
    expect(archiveOnly.maps.status).toBe('no-tiles');
    const withoutRoute = deriveDriveDashboard(trusted({
      packCatalog: [pack()], offlineTilesAvailable: true,
    }));
    expect(withoutRoute.maps.status).toBe('no-route');
    const uncovered = deriveDriveDashboard(trusted({
      packCatalog: [pack()], offlineTilesAvailable: true,
      requiredTripPointCount: 2,
      mapCoverage: {
        complete: false, coveredPointCount: 1, totalPointCount: 2,
        missingPointIndexes: [1], readyPackIds: ['alpine-pack'],
      },
    }));
    expect(uncovered.maps.status).toBe('uncovered');
    expect(uncovered.status).toBe('attention');
    const covered = deriveDriveDashboard(trusted({
      packCatalog: [pack()], offlineTilesAvailable: true,
      requiredTripPointCount: 2,
      mapCoverage: {
        complete: true, coveredPointCount: 2, totalPointCount: 2,
        missingPointIndexes: [], readyPackIds: ['alpine-pack'],
      },
    }));
    expect(covered.maps.status).toBe('ready');
    expect(covered.status).toBe('ready');
  });

  test('unverified, expired and future alerts remain hidden', () => {
    expect(deriveDriveDashboard(trusted()).alertsAvailable).toBe(false);
    const payload = {
      convoyId, localIdentityRef: own,
      verifiedBy: 'security-v1' as const,
      alerts: [
        alert(NOW - 100_000),
        alert(NOW - 500_000, 'expired'),
        alert(NOW + 90_000, 'future'),
      ],
    };
    const out = deriveDriveDashboard(trusted({verifiedAlerts: payload}));
    expect(out.alertsAvailable).toBe(true);
    expect(out.alerts.map(item => item.id)).toEqual(['alert-1']);
    const wrongScope = deriveDriveDashboard(trusted({
      verifiedAlerts: {...payload, convoyId: 'other'},
    }));
    expect(wrongScope.alerts).toEqual([]);
  });

  test('unrelated radio messages cannot become verified alerts or unread counts', () => {
    const output = deriveDriveDashboard(trusted({
      channelMessages: [
        {id: 'wrong', direction: 'received', channelIndex: '1',
          createdAt: new Date(NOW).toISOString()},
        {id: 'old', direction: 'received', channelIndex: '2',
          createdAt: new Date(NOW - 1_000_000).toISOString()},
        {id: 'outbound', direction: 'sent', channelIndex: '2',
          createdAt: new Date(NOW).toISOString()},
      ],
    }));
    expect(output.incomingCarrierMessages).toBe(0);
    expect(output.alerts).toEqual([]);
    expect(output.outgoingPending).toBe(3);
  });
});
