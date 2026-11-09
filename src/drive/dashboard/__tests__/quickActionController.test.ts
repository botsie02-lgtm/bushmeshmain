import {BushMeshQuickActionCode} from '../../../bushmesh/legacyProtocol';
import {
  decideDashboardAction,
  performDashboardAction,
  type DashboardActionPorts,
} from '../quickActionController';
import {deriveDriveDashboard} from '../driveDashboardModel';
import type {DriveDashboardInput} from '../driveDashboardModel';
import type {TransmissionAttemptResult} from '../../../radio/BushMeshTransmissionController';

const NOW = 1_800_000_000_000;

function input(): DriveDashboardInput {
  return {
    nowMs: NOW,
    activeConvoy: {
      convoyId: 'SQUAD', displayName: 'Squad',
      localIdentityRef: 'RADIO-ID',
      authorizationState: 'authorized',
      verifiedBy: 'security-v1',
      membershipRecordRef: 'verified-1',
    },
    roster: {
      convoyId: 'SQUAD', localIdentityRef: 'RADIO-ID',
      verifiedBy: 'security-v1', members: [],
    },
    verifiedAlerts: null,
    carrierBinding: {
      convoyId: 'SQUAD', localIdentityRef: 'RADIO-ID',
      verifiedBy: 'security-v1', channelIndex: 2,
    },
    radioConnectionStatus: 'Connected',
    activeCarrierChannelIndex: '2',
    radioSession: {
      transportReady: true, identityRef: 'RADIO-ID',
      queuedCount: 0, inflightCount: 0, failedCount: 0,
    },
    locationStatus: 'tracking',
    locationProviderLabel: 'Android GPS',
    latestFix: {
      latitude: -37.5, longitude: 146.1, timestampMs: NOW - 2_000,
      headingDegrees: 60,
    },
    mapCoverage: {
      complete: false, coveredPointCount: 0, totalPointCount: 0,
      missingPointIndexes: [], readyPackIds: [],
    },
    requiredTripPointCount: 0,
    packCatalog: [],
    offlineTilesAvailable: false,
    channelMessages: [],
  };
}

function ports(
  attempt: TransmissionAttemptResult = {
    entry: {id: 'queued-action'} as TransmissionAttemptResult['entry'],
    outcome: 'accepted',
  },
): DashboardActionPorts {
  return {
    identityRef: 'RADIO-ID',
    previewQuickAction: jest.fn(),
    recordLocalQuickAction: jest.fn(),
    queueDriverAction: jest.fn(() => ({id: 'queued-action'})),
    drainOnce: jest.fn(async () => attempt),
  };
}

test('all four dashboard commands use existing supported quick-action definitions', () => {
  expect(decideDashboardAction(
    BushMeshQuickActionCode.Stop, deriveDriveDashboard(input()),
  )).toEqual({
    mode: 'send', channelIndex: 2,
    position: {latitude: -37.5, longitude: 146.1}, ttlSeconds: 120,
  });
  expect(decideDashboardAction(
    BushMeshQuickActionCode.Hazard, deriveDriveDashboard(input()),
  ).mode).toBe('send');
  expect(decideDashboardAction(
    BushMeshQuickActionCode.Help, deriveDriveDashboard(input()),
  ).mode).toBe('send');
  expect(decideDashboardAction(
    BushMeshQuickActionCode.Regroup, deriveDriveDashboard(input()),
  ).mode).toBe('send');
  expect(() => decideDashboardAction(
    BushMeshQuickActionCode.Ok, deriveDriveDashboard(input()),
  )).toThrow('Unsupported');
});

test('missing operational authorisation results in local preview, no queue access', async () => {
  const model = deriveDriveDashboard({...input(), activeConvoy: null});
  const adapter = ports();
  const result = await performDashboardAction(
    BushMeshQuickActionCode.Stop, model, 10, adapter,
  );
  expect(result.kind).toBe('preview');
  expect(result.message).toContain('LOCAL PREVIEW ONLY');
  expect(adapter.queueDriverAction).not.toHaveBeenCalled();
  expect(adapter.drainOnce).not.toHaveBeenCalled();
  expect(adapter.previewQuickAction).toHaveBeenCalledWith(
    BushMeshQuickActionCode.Stop, null,
  );
});

test('accepted must refer to the just-queued entry, not another radio packet', async () => {
  const model = deriveDriveDashboard(input());
  const other = ports({
    entry: {id: 'older-packet'} as TransmissionAttemptResult['entry'],
    outcome: 'accepted',
  });
  const outcome = await performDashboardAction(
    BushMeshQuickActionCode.Hazard, model, 11, other,
  );
  expect(outcome.kind).toBe('queued');
  expect(outcome.message).not.toContain('RADIO ACCEPTED');
  expect(other.recordLocalQuickAction).toHaveBeenCalledWith(
    BushMeshQuickActionCode.Hazard,
    {latitude: -37.5, longitude: 146.1},
    'local-queued', 'RADIO-ID', 2,
  );
  const own = ports();
  const accepted = await performDashboardAction(
    BushMeshQuickActionCode.Help, model, 12, own,
  );
  expect(accepted.kind).toBe('accepted');
  expect(accepted.message).toContain('NOT been confirmed');
});

test('failed queue, failed drain and unknown drain outcome cannot claim delivery', async () => {
  const model = deriveDriveDashboard(input());
  const queueError = ports();
  (queueError.queueDriverAction as jest.Mock).mockImplementation(() => {
    throw new Error('radio down');
  });
  const failed = await performDashboardAction(
    BushMeshQuickActionCode.Regroup, model, 20, queueError,
  );
  expect(failed.kind).toBe('failed');
  expect(queueError.drainOnce).not.toHaveBeenCalled();
  const retry = ports({
    entry: {id: 'queued-action'} as TransmissionAttemptResult['entry'],
    outcome: 'retrying',
  });
  expect((await performDashboardAction(
    BushMeshQuickActionCode.Hazard, model, 21, retry,
  )).kind).toBe('queued');
  const uncertain = ports();
  (uncertain.drainOnce as jest.Mock).mockImplementation(() => {
    throw new Error('unknown timeout');
  });
  const result = await performDashboardAction(
    BushMeshQuickActionCode.Hazard, model, 22, uncertain,
  );
  expect(result.kind).toBe('queued');
  expect(result.message).toContain('outcome unknown');
});

test('invalid sequence or missing sender identity never enters the queue', async () => {
  const model = deriveDriveDashboard(input());
  const badSequence = ports();
  expect((await performDashboardAction(
    BushMeshQuickActionCode.Stop, model, 0, badSequence,
  )).kind).toBe('preview');
  expect(badSequence.queueDriverAction).not.toHaveBeenCalled();
  const noIdentity = ports();
  noIdentity.identityRef = null;
  expect((await performDashboardAction(
    BushMeshQuickActionCode.Stop, model, 1, noIdentity,
  )).kind).toBe('preview');
  expect(noIdentity.queueDriverAction).not.toHaveBeenCalled();
});
