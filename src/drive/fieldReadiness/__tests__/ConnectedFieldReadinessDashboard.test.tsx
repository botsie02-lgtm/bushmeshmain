import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {BushMeshQuickActionCode} from '../../../bushmesh/legacyProtocol';
import {useDriveDashboardController} from '../../dashboard/useDriveDashboardController';
import type {DriveDashboardModel} from '../../dashboard/driveDashboardModel';
import {ConnectedFieldReadinessDashboard} from '../ConnectedFieldReadinessDashboard';

jest.mock('../../dashboard/useDriveDashboardController', () => ({
  useDriveDashboardController: jest.fn(),
}));
jest.mock('../../../state/OfflineMapContext', () => ({
  useOfflineMaps: () => ({
    mapPackInstallSupported: false,
    mapPersistenceStatus: 'ready',
  }),
}));
jest.mock('../../../state/LocationSessionContext', () => ({
  useLocationSession: () => ({
    latestFix: {
      latitude: -37.8, longitude: 146.1,
      timestampMs: Date.now(), speedKmh: 0,
    },
  }),
}));

function authorizedDashboard(): DriveDashboardModel {
  const now = Date.now();
  return {
    status: 'ready',
    statusTitle: 'DRIVE SETUP READY',
    statusDetail: 'Source contracts validated.',
    radioStatus: 'ready',
    connectionDetail: 'Transport available.',
    convoy: {
      id: 'VERIFIED', name: 'Authorised convoy',
      memberRosterVerified: true, verifiedMemberCount: 1,
      live: 1, recent: 0, stale: 0, lost: 0, noPosition: 0,
    },
    gps: {
      fix: {
        latitude: -37.8, longitude: 146.1,
        receivedAtMs: now - 1_000,
        headingDegrees: 0, accuracyMeters: 4,
      },
      freshness: 'live', ageLabel: '1s ago',
      latitudeLabel: '-37.80000', longitudeLabel: '146.10000',
      headingLabel: '0°', accuracyLabel: '±4 m',
      simulated: false, nativeSource: true, tracking: true,
    },
    maps: {
      status: 'no-pack', label: 'No verified pack',
      detail: 'Install a pack.',
    },
    incomingCarrierMessages: 0, outgoingPending: 0, outgoingFailed: 0,
    alerts: [], alertsAvailable: true,
    actionAvailability: {
      canTransmit: true, reason: '', channelIndex: 2,
    },
    mapMembers: [{id: 'VERIFIED-PEER', label: 'Peer', position: null}],
  };
}

function press(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const node = renderer.root.findAllByProps({accessibilityLabel: label})
    .find(item => typeof item.props.onPress === 'function');
  if (!node) throw new Error('Missing ' + label);
  node.props.onPress();
}

test('connected field readiness NEVER calls v2 radio action even with verified binding', async () => {
  const performAction = jest.fn(async (_code: BushMeshQuickActionCode) => ({
    kind: 'accepted' as const,
    message: 'Radio accepted',
  }));
  (useDriveDashboardController as jest.Mock).mockReturnValue({
    model: authorizedDashboard(),
    packCatalog: [],
    busyAction: null,
    actionResult: null,
    performAction,
  });
  const openMap = jest.fn();
  const managePacks = jest.fn();

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ConnectedFieldReadinessDashboard
        onOpenMap={openMap}
        onManageMapPacks={managePacks}
        onOpenConvoy={jest.fn()}
        onOpenRadio={jest.fn()}
        onOpenGpsSettings={jest.fn()}
      />,
    );
  });
  await act(async () => {press(renderer, 'Preview STOP');});
  await act(async () => {press(renderer, 'Confirm local STOP preview');});
  await act(async () => {press(renderer, 'Preview HAZARD');});
  expect(performAction).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain('NOT TRANSMITTED');
  await act(async () => {
    press(renderer, 'Open ConvoyMap');
    press(renderer, 'Manage offline map packs');
  });
  expect(openMap).toHaveBeenCalledTimes(1);
  expect(managePacks).toHaveBeenCalledTimes(1);
  await act(async () => {renderer.unmount();});
});
