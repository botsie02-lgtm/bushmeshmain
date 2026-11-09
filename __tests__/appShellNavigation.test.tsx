import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {AppShell, MAIN_TABS} from '../src/app/shell/AppShell';
import {ConnectedDriveDashboard} from '../src/drive/dashboard/ConnectedDriveDashboard';
import {ConnectedFieldReadinessDashboard} from '../src/drive/fieldReadiness/ConnectedFieldReadinessDashboard';
import {MapScreen} from '../src/screens/MapScreen';
import {RadioScreen} from '../src/screens/RadioScreen';

jest.mock('../src/state/LocationSessionContext', () => ({
  useLocationSession: () => ({status: 'stopped', latestFix: null}),
}));
jest.mock('../src/state/OfflineMapContext', () => ({
  useOfflineMaps: () => ({coverage: {complete: false}}),
}));
jest.mock('../src/state/BushMeshContext', () => ({
  useBushMesh: () => ({
    connectionStatus: 'Connected',
    activeChannel: {channelIndex: '0', channelName: 'Public carrier'},
    contacts: [{name: 'UNTRUSTED PUBLIC DEVICE'}],
  }),
}));
jest.mock('../src/app/activeContext/ViewedConversationContext', () => ({
  useViewedConversation: () => ({viewedConversation: null, setViewedConversation: jest.fn()}),
}));
jest.mock('../src/app/activeContext/ActiveOperationalConvoyContext', () => ({
  useActiveOperationalConvoy: () => ({
    activeConvoy: null,
    selectableConvoys: [],
    localIdentityRef: null,
    status: 'ready',
    notice: null,
    selectionDurable: false,
    selectConvoy: jest.fn(),
    clearActiveConvoy: jest.fn(),
    refresh: jest.fn(),
  }),
}));

jest.mock('../src/screens/DriveScreen', () => ({DriveScreen: () => null}));
jest.mock('../src/drive/dashboard/ConnectedDriveDashboard', () => ({ConnectedDriveDashboard: () => null}));
jest.mock('../src/drive/fieldReadiness/ConnectedFieldReadinessDashboard', () => ({ConnectedFieldReadinessDashboard: () => null}));
jest.mock('../src/screens/MapScreen', () => ({MapScreen: () => null}));
jest.mock('../src/screens/ConvoyScreen', () => ({ConvoyScreen: () => null}));
jest.mock('../src/screens/RadioScreen', () => ({RadioScreen: () => null}));
jest.mock('../src/screens/ContactsScreen', () => ({ContactsScreen: () => null}));
jest.mock('../src/screens/LocationScreen', () => ({LocationScreen: () => null}));
jest.mock('../src/components/DeviceGpsSettingsPanel', () => ({DeviceGpsSettingsPanel: () => null}));
jest.mock('../src/screens/DeviceHubScreen', () => ({DeviceHubScreen: () => null}));

jest.mock('../src/components/CarMessagingStatusBanner', () => ({CarMessagingStatusBanner: () => null}));
jest.mock('../src/components/ConvoyFormationBanner', () => ({ConvoyFormationBanner: () => null}));
jest.mock('../src/components/ConvoyFormationGapBanner', () => ({ConvoyFormationGapBanner: () => null}));
jest.mock('../src/components/ConvoyLinkWatchBanner', () => ({ConvoyLinkWatchBanner: () => null}));
jest.mock('../src/components/ConvoyLossBanner', () => ({ConvoyLossBanner: () => null}));
jest.mock('../src/components/ConvoyReacquiredBanner', () => ({ConvoyReacquiredBanner: () => null}));
jest.mock('../src/components/ConvoyRecoveryBanner', () => ({ConvoyRecoveryBanner: () => null}));
jest.mock('../src/components/ConvoyRecoveryHistoryStrip', () => ({ConvoyRecoveryHistoryStrip: () => null}));
jest.mock('../src/components/DriveNavigationBanner', () => ({DriveNavigationBanner: () => null}));
jest.mock('../src/components/FieldNavigationPrompt', () => ({FieldNavigationPrompt: () => null}));
jest.mock('../src/components/FormationProposalBanner', () => ({FormationProposalBanner: () => null}));
jest.mock('../src/components/MapTrackExportBanner', () => ({MapTrackExportBanner: () => null}));
jest.mock('../src/components/RadioSpeechStatusBanner', () => ({RadioSpeechStatusBanner: () => null}));
jest.mock('../src/components/RecoveryCheckpointBanner', () => ({RecoveryCheckpointBanner: () => null}));
jest.mock('../src/components/RecoveryEscalationNotice', () => ({RecoveryEscalationNotice: () => null}));
jest.mock('../src/components/RecoveryReferenceNotice', () => ({RecoveryReferenceNotice: () => null}));
jest.mock('../src/components/RouteGuidanceBanner', () => ({RouteGuidanceBanner: () => null}));
jest.mock('../src/components/SecureDataStatusBanner', () => ({SecureDataStatusBanner: () => null}));
jest.mock('../src/components/SpeechPttPanel', () => ({SpeechPttPanel: () => null}));
jest.mock('../src/components/SpeechStatusBanner', () => ({SpeechStatusBanner: () => null}));

function visibleText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  // React Native test-renderer host node; not a DOM JSX intrinsic type.
  const textNodes = renderer.root.findAllByType('Text' as unknown as React.ElementType);
  return textNodes.map(node => node.props.children).flat(Infinity).join(' ');
}

function renderedTabs(renderer: ReactTestRenderer.ReactTestRenderer) {
  // RN TouchableOpacity forwards accessibility props to multiple nested test
  // nodes, so one label/role represents one tab, not one renderer node.
  return MAIN_TABS.map(tab => {
    const match = renderer.root.findAllByProps({accessibilityLabel: tab.label})
      .find(node => node.props.accessibilityRole === 'tab' &&
        node.props.accessibilityState !== undefined);
    if (!match) throw new Error(`Missing main tab ${tab.label}`);
    return match;
  });
}

function pressByLabel(renderer: ReactTestRenderer.ReactTestRenderer, label: string): void {
  const match = renderer.root.findAllByProps({accessibilityLabel: label})
    .find(node => typeof node.props.onPress === 'function');
  if (!match) throw new Error(`Missing interactive action ${label}`);
  match.props.onPress();
}

test('five top tabs start on safe Drive, with no automatic public contacts or map', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<AppShell />);
  });

  const tabs = renderedTabs(renderer);
  expect(MAIN_TABS.map(tab => tab.key)).toEqual([
    'drive', 'radio', 'convoy', 'contacts', 'device',
  ]);
  expect(tabs).toHaveLength(5);
  expect(tabs[0].props.accessibilityState.selected).toBe(true);
  expect(visibleText(renderer)).toContain('No active convoy');
  const field = renderer.root.findByType(ConnectedFieldReadinessDashboard);
  expect(field.props.roster).toBeNull();
  expect(field.props.verifiedAlerts).toBeNull();
  expect(field.props.carrierBinding).toBeNull();
  expect(field.props.imageryEvidence).toBeUndefined();
  expect(typeof field.props.onManageMapPacks).toBe('function');
  expect(typeof field.props.onOpenGpsSettings).toBe('function');
  expect(visibleText(renderer)).not.toContain('UNTRUSTED PUBLIC DEVICE');

  await ReactTestRenderer.act(() => {
    field.props.onOpenMap();
  });
  expect(visibleText(renderer)).toMatch(/Map\s*:\s*unverified legacy telemetry/);
  const map = renderer.root.findByType(MapScreen);
  expect(map.props.activeConvoyId).toBeNull();
  expect(map.props.authorisedMembers).toEqual([]);
  expect(renderedTabs(renderer)).toHaveLength(5);

  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'Back to Drive');
  });
  await ReactTestRenderer.act(() => {
    renderer.root.findByType(ConnectedFieldReadinessDashboard).props.onManageMapPacks();
  });
  expect(renderedTabs(renderer)[4].props.accessibilityState.selected).toBe(true);
  expect(visibleText(renderer)).toContain('Offline map packs');

  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'Drive');
  });
  await ReactTestRenderer.act(() => {
    renderer.root.findByType(ConnectedFieldReadinessDashboard).props.onOpenGpsSettings();
  });
  expect(renderedTabs(renderer)[4].props.accessibilityState.selected).toBe(true);
  expect(visibleText(renderer)).toContain('GPS settings');
  expect(visibleText(renderer)).toContain('GPS controls');

  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'Drive');
  });
  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'Detailed Drive dashboard');
  });
  const dashboard = renderer.root.findByType(ConnectedDriveDashboard);
  expect(dashboard.props.roster).toBeNull();
  expect(dashboard.props.verifiedAlerts).toBeNull();
  expect(dashboard.props.carrierBinding).toBeNull();
  expect(typeof dashboard.props.onOpenMap).toBe('function');
  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'Back to Drive');
  });
  expect(renderer.root.findAllByType(ConnectedFieldReadinessDashboard)).toHaveLength(1);
  expect(renderer.root.findAllByType(ConnectedDriveDashboard)).toHaveLength(0);

  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'Device');
  });
  // Returning from Drive preserves the last Device subsection; it does not
  // remount providers or silently replace manually selected GPS preferences.
  expect(visibleText(renderer)).toContain('GPS settings');
  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'Back to Device');
  });
  expect(visibleText(renderer)).toContain('GPS and location');

  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'GPS and location');
  });
  expect(visibleText(renderer)).toContain('GPS settings');
  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'GPS preferences');
  });
  expect(visibleText(renderer)).toContain('GPS controls');
  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'GPS controls');
  });
  expect(visibleText(renderer)).toContain('GPS preferences');

  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'Back to Device');
  });
  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'Offline map packs');
  });
  expect(visibleText(renderer)).toContain('Offline map packs');
  expect(renderedTabs(renderer)[4].props.accessibilityState.selected).toBe(true);

  await ReactTestRenderer.act(() => {
    pressByLabel(renderer, 'Radio');
  });
  const radio = renderer.root.findByType(RadioScreen);
  expect(typeof radio.props.onOpenCarrierDetails).toBe('function');
  await ReactTestRenderer.act(() => {
    radio.props.onOpenCarrierDetails();
  });
  expect(visibleText(renderer)).toContain('Back to convoy selection');

  await ReactTestRenderer.act(() => {renderer.unmount();});
});
