import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {StyleSheet} from 'react-native';
import {MapScreen} from '../src/screens/MapScreen';
import {ConvoyMap} from '../src/maps/ConvoyMap';

const mockNavigateToVehicle = jest.fn();
const mockClearMapState = jest.fn();
const onManageMapPacks = jest.fn();

jest.mock('../src/maps/ConvoyMap', () => ({
  ConvoyMap: () => null,
}));
jest.mock('../src/state/ConvoyContext', () => ({
  useConvoy: () => ({
    vehicles: [{
      id: 'UNVERIFIED-1', name: 'UNVERIFIED CHANNEL VEHICLE',
      latitude: -37.8, longitude: 144.95,
      altitudeMeters: null, speedKmh: 0,
      headingDegrees: null, accuracyMeters: null,
      sequence: 1, packetTimestampSeconds: 1800000000,
      receivedAtMs: Date.now(), snrDb: null, pathLength: null,
    }],
    buddyTails: [], localPosition: null,
    navigationTargetVehicleId: null, navigationTargetVehicle: null,
    navigationFieldTarget: null,
    setNavigationTarget: mockNavigateToVehicle,
    setNavigationFieldTarget: jest.fn(),
    clearNavigationTarget: jest.fn(),
  }),
}));
jest.mock('../src/state/DriveContext', () => ({
  useDrive: () => ({operationalMarkers: []}),
}));
jest.mock('../src/state/LocationSessionContext', () => ({
  useLocationSession: () => ({
    latestFix: null, trackPoints: [], trackDistanceMeters: 0,
    trackStartedAtMs: null, clearTrack: jest.fn(),
  }),
}));
jest.mock('../src/state/OfflineMapContext', () => ({
  useOfflineMaps: () => ({
    packs: [], packCatalog: [],
    coverage: {
      complete: false, readyPackIds: [], missingPointIndexes: [],
      coveredPointCount: 0, totalPointCount: 0,
    },
    requiredTripPoints: [],
    loadDemoHighCountryPack: jest.fn(),
    clearMapState: mockClearMapState,
  }),
}));

function press(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const node = renderer.root.findAllByProps({accessibilityLabel: label})
    .find(item => typeof item.props.onPress === 'function');
  if (!node) throw new Error('Missing ' + label);
  node.props.onPress();
}

test('only supplied verified members are sent to the real map; carrier locations stay hidden', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<MapScreen
      activeConvoyId="verified-convoy"
      authorisedMembers={[]}
      onManageMapPacks={onManageMapPacks}
    />);
  });
  const map = renderer.root.findByType(ConvoyMap);
  expect(map.props.activeConvoyId).toBe('verified-convoy');
  expect(map.props.authorisedMembers).toEqual([]);
  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain('No verified member-position feed supplied');
  expect(text).not.toContain('UNVERIFIED CHANNEL VEHICLE');
  expect(text).toContain('TRIP NOT CHECKED');
  await act(async () => {renderer.unmount();});
});

test('unverified carrier position list is deliberate opt-in and cannot populate verified map', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<MapScreen
      authorisedMembers={[]}
    />);
  });
  await act(async () => {press(renderer, 'Show unverified radio positions');});
  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain('UNVERIFIED CHANNEL VEHICLE');
  expect(text).toContain('NOT VERIFIED');
  expect(renderer.root.findByType(ConvoyMap).props.authorisedMembers).toEqual([]);
  await act(async () => {press(renderer, 'Hide unverified radio positions');});
  expect(JSON.stringify(renderer.toJSON())).not.toContain('UNVERIFIED CHANNEL VEHICLE');
  expect(mockNavigateToVehicle).not.toHaveBeenCalled();
  await act(async () => {renderer.unmount();});
});

test('real map-pack management is a 56dp route action; destructive clear needs confirmation', async () => {
  onManageMapPacks.mockClear();
  mockClearMapState.mockClear();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<MapScreen
      onManageMapPacks={onManageMapPacks}
    />);
  });
  const manager = renderer.root.findAllByProps({
    accessibilityLabel: 'Manage offline map packs in Device',
  }).find(item => typeof item.props.onPress === 'function');
  expect(StyleSheet.flatten(manager?.props.style).minHeight).toBeGreaterThanOrEqual(56);
  await act(async () => {press(renderer, 'Manage offline map packs in Device');});
  expect(onManageMapPacks).toHaveBeenCalledTimes(1);

  await act(async () => {press(renderer, 'Show advanced map diagnostics');});
  await act(async () => {press(renderer, 'Review clear map state');});
  expect(mockClearMapState).not.toHaveBeenCalled();
  await act(async () => {press(renderer, 'Cancel clear map data');});
  expect(mockClearMapState).not.toHaveBeenCalled();
  await act(async () => {renderer.unmount();});
});
