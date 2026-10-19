import {getTripReadiness} from '../src/drive/tripReadiness';

describe('trip readiness', () => {
  test('blocks a convoy start until core radio/location requirements are ready', () => {
    const report = getTripReadiness({
      radioConnected: true,
      radioTransportReady: false,
      radioIdentityReady: false,
      channelSelected: true,
      localPositionReady: false,
      convoyMembersKnown: false,
      offlineMapReady: false,
    });

    expect(report.canStartConvoy).toBe(false);
    expect(report.blockers.map(item => item.key)).toEqual([
      'radio',
      'identity',
      'position',
    ]);
  });

  test('unknown remote convoy members warn without blocking radio operation', () => {
    const report = getTripReadiness({
      radioConnected: true,
      radioTransportReady: true,
      radioIdentityReady: true,
      channelSelected: true,
      localPositionReady: true,
      convoyMembersKnown: false,
      offlineMapReady: false,
    });

    expect(report.canStartConvoy).toBe(true);
    expect(report.canNavigateOffline).toBe(false);
    expect(report.warnings.map(item => item.key)).toEqual([
      'convoy',
      'offline-map',
    ]);
  });

  test('offline navigation can be made mandatory for a trip', () => {
    const report = getTripReadiness({
      radioConnected: true,
      radioTransportReady: true,
      radioIdentityReady: true,
      channelSelected: true,
      localPositionReady: true,
      convoyMembersKnown: true,
      offlineMapReady: false,
      navigationRequired: true,
    });

    expect(report.canStartConvoy).toBe(true);
    expect(report.canNavigateOffline).toBe(false);
    expect(report.blockers.map(item => item.key)).toEqual(['offline-map']);
  });

  test('fully prepared trips are navigation ready', () => {
    const report = getTripReadiness({
      radioConnected: true,
      radioTransportReady: true,
      radioIdentityReady: true,
      channelSelected: true,
      localPositionReady: true,
      convoyMembersKnown: true,
      offlineMapReady: true,
      navigationRequired: true,
    });

    expect(report.canStartConvoy).toBe(true);
    expect(report.canNavigateOffline).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
});
