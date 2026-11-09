import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {StyleSheet} from 'react-native';
import {BushMeshQuickActionCode} from '../../../bushmesh/legacyProtocol';
import {DriveDashboard} from '../DriveDashboard';
import type {DriveDashboardModel} from '../driveDashboardModel';
import {ConvoyMap} from '../../../maps/ConvoyMap';

jest.mock('../../../maps/ConvoyMap', () => ({
  ConvoyMap: () => null,
}));

function model(allowed = false): DriveDashboardModel {
  return {
    status: allowed ? 'ready' : 'attention',
    statusTitle: allowed ? 'DRIVE SETUP READY' : 'DRIVE SETUP INCOMPLETE',
    statusDetail: allowed ? 'Verified prerequisites' : 'Choose an authorised convoy.',
    radioStatus: 'ready',
    connectionDetail: 'MeshCore transport ready; peer delivery unconfirmed.',
    convoy: {
      id: allowed ? 'VERIFIED-CONVOY' : null,
      name: allowed ? 'Verified Convoy' : 'No active convoy',
      memberRosterVerified: allowed,
      verifiedMemberCount: allowed ? 1 : null,
      live: allowed ? 1 : 0,
      recent: 0,
      stale: 0,
      lost: 0,
      noPosition: 0,
    },
    gps: {
      fix: null,
      freshness: 'unknown',
      ageLabel: 'No valid fix',
      latitudeLabel: '—',
      longitudeLabel: '—',
      headingLabel: '—',
      accuracyLabel: '—',
      simulated: false,
    },
    maps: {
      status: 'no-tiles',
      label: 'Offline tiles unavailable',
      detail: 'Map archive reader not installed.',
    },
    incomingCarrierMessages: 4,
    outgoingPending: 2,
    outgoingFailed: 0,
    alerts: [],
    alertsAvailable: false,
    actionAvailability: {
      canTransmit: allowed,
      reason: allowed ? '' : 'No authorised carrier binding.',
      channelIndex: allowed ? 2 : null,
    },
    mapMembers: allowed ? [{
      id: 'VERIFIED-PEER',
      label: 'Verified lead',
      position: null,
    }] : [],
  };
}

function press(tree: TestRenderer.ReactTestRenderer, label: string): void {
  const found = tree.root.findAllByProps({accessibilityLabel: label})
    .find(node => typeof node.props.onPress === 'function');
  if (!found) {
    throw new Error('No button named ' + label);
  }
  found.props.onPress();
}

function create(
  current: DriveDashboardModel,
  overrides: Record<string, unknown> = {},
) {
  const onQuickAction = jest.fn();
  const onOpenMap = jest.fn();
  const onOpenConvoy = jest.fn();
  const element = (
    <DriveDashboard
      model={current}
      packCatalog={[]}
      onOpenMap={onOpenMap}
      onOpenConvoy={onOpenConvoy}
      onQuickAction={onQuickAction}
      {...overrides}
    />
  );
  return {element, onQuickAction, onOpenMap, onOpenConvoy};
}

test('cold state clearly says no convoy, no verified roster or alerts', async () => {
  const item = create(model());
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {tree = TestRenderer.create(item.element);});
  const snapshot = JSON.stringify(tree.toJSON());
  expect(snapshot).toContain('No active convoy');
  expect(snapshot).toContain('Unknown');
  expect(snapshot).toContain('Verified convoy alerts are not connected');
  expect(snapshot).toContain('LOCAL PREVIEW ONLY');
  expect(snapshot).not.toContain('VERIFIED-PEER');
  await act(async () => {press(tree, 'STOP');});
  expect(item.onQuickAction).toHaveBeenCalledWith(BushMeshQuickActionCode.Stop);
  await act(async () => {tree.unmount();});
});

test('critical radio STOP / HELP require a second explicit confirmation', async () => {
  const item = create(model(true));
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {tree = TestRenderer.create(item.element);});
  await act(async () => {press(tree, 'STOP');});
  expect(item.onQuickAction).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain('Confirm STOP radio');
  await act(async () => {press(tree, 'Cancel');});
  expect(item.onQuickAction).not.toHaveBeenCalled();
  await act(async () => {press(tree, 'HELP');});
  await act(async () => {press(tree, 'Confirm HELP');});
  expect(item.onQuickAction).toHaveBeenCalledWith(BushMeshQuickActionCode.Help);
  await act(async () => {press(tree, 'HAZARD');});
  expect(item.onQuickAction).toHaveBeenCalledWith(BushMeshQuickActionCode.Hazard);
  await act(async () => {tree.unmount();});
});

test('map control opens host and inline map only receives explicitly scoped members', async () => {
  const item = create(model());
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <DriveDashboard
        model={model()}
        packCatalog={[]}
        onOpenMap={item.onOpenMap}
        onOpenConvoy={item.onOpenConvoy}
        onQuickAction={item.onQuickAction}
        showInlineMap
      />,
    );
  });
  await act(async () => {press(tree, 'Open ConvoyMap');});
  expect(item.onOpenMap).toHaveBeenCalledTimes(1);
  const map = tree.root.findByType(ConvoyMap);
  expect(map.props.activeConvoyId).toBeNull();
  expect(map.props.authorisedMembers).toEqual([]);
  await act(async () => {tree.unmount();});
});

test('buttons have 56px+ standard targets and quick actions have 94px targets', async () => {
  const item = create(model());
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {tree = TestRenderer.create(item.element);});
  const mapButton = tree.root.findAllByProps({accessibilityLabel: 'Open ConvoyMap'})
    .find(node => typeof node.props.onPress === 'function');
  const hazardButton = tree.root.findAllByProps({accessibilityLabel: 'HAZARD'})
    .find(node => typeof node.props.onPress === 'function');
  expect(StyleSheet.flatten(mapButton!.props.style).minHeight).toBeGreaterThanOrEqual(56);
  expect(StyleSheet.flatten(hazardButton!.props.style).minHeight).toBeGreaterThanOrEqual(94);
  await act(async () => {tree.unmount();});
});
