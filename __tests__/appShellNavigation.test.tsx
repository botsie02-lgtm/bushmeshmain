import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {AppShell, MAIN_TABS} from '../src/app/shell/AppShell';

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
jest.mock('../src/screens/MapScreen', () => ({MapScreen: () => null}));
jest.mock('../src/screens/ConvoyScreen', () => ({ConvoyScreen: () => null}));
jest.mock('../src/screens/RadioScreen', () => ({RadioScreen: () => null}));
jest.mock('../src/screens/ContactsScreen', () => ({ContactsScreen: () => null}));
jest.mock('../src/screens/LocationScreen', () => ({LocationScreen: () => null}));
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
  const textNodes = renderer.root.findAllByType('Text');
  return textNodes.map(node => node.props.children).flat(Infinity).join(' ');
}

test('five top tabs start on safe Drive, with no automatic public contacts or map', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<AppShell />);
  });

  const tabs = renderer.root.findAllByProps({accessibilityRole: 'tab'});
  expect(MAIN_TABS.map(tab => tab.key)).toEqual([
    'drive', 'radio', 'convoy', 'contacts', 'device',
  ]);
  expect(tabs).toHaveLength(5);
  expect(tabs[0].props.accessibilityState.selected).toBe(true);
  expect(visibleText(renderer)).toContain('No active convoy');
  expect(visibleText(renderer)).toContain('Choose a convoy');
  expect(visibleText(renderer)).toContain('Carrier: Public carrier');
  expect(visibleText(renderer)).not.toContain('UNTRUSTED PUBLIC DEVICE');
  expect(visibleText(renderer)).not.toContain('Convoy map');

  await ReactTestRenderer.act(() => {
    const openMap = renderer.root.findByProps({accessibilityLabel: 'Open map'});
    openMap.props.onPress();
  });
  expect(visibleText(renderer)).toContain('Map: unverified legacy telemetry');
  expect(renderer.root.findAllByProps({accessibilityRole: 'tab'})).toHaveLength(5);

  await ReactTestRenderer.act(() => {
    const goDevice = renderer.root.findByProps({accessibilityLabel: 'Device'});
    goDevice.props.onPress();
  });
  expect(visibleText(renderer)).toContain('GPS and location');

  await ReactTestRenderer.act(() => {
    renderer.root.findByProps({accessibilityLabel: 'GPS and location'}).props.onPress();
  });
  expect(visibleText(renderer)).toContain('GPS settings');

  await ReactTestRenderer.act(() => {
    renderer.root.findByProps({accessibilityLabel: 'Back to Device'}).props.onPress();
  });
  await ReactTestRenderer.act(() => {
    renderer.root.findByProps({accessibilityLabel: 'Offline map packs'}).props.onPress();
  });
  expect(visibleText(renderer)).toContain('Offline map packs');
  expect(renderer.root.findAllByProps({accessibilityRole: 'tab'})[4].props.accessibilityState.selected).toBe(true);

  await ReactTestRenderer.act(() => {renderer.unmount();});
});
