import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {StyleSheet} from 'react-native';
import type {BushMeshMapPackCatalogEntry} from '../src/maps/mapPackCatalog';
import type {FieldPulseInput} from '../src/app/fieldExperience/fieldPulseModel';
import {deriveFieldPulse} from '../src/app/fieldExperience/fieldPulseModel';
import {FieldPulseStrip} from '../src/app/fieldExperience/FieldPulseStrip';

const NOW = 1_800_000_000_000;
const verifiedPack: BushMeshMapPackCatalogEntry = {
  manifest: {
    schemaVersion: 1, id: 'melbourne-roads', name: 'Road pack',
    version: '1', bounds: {south: -39, north: -36, west: 144, east: 146},
    format: 'mbtiles', minZoom: 8, maxZoom: 15, tileSize: 256,
    expectedBytes: 4096, sha256: 'c'.repeat(64),
    source: {kind: 'import', displayName: 'offline-roads.mbtiles'},
  },
  installState: 'ready', lastError: null,
  artifact: {
    packId: 'melbourne-roads', manifestVersion: '1',
    format: 'mbtiles', localUri: 'file:///private/road.mbtiles',
    bytes: 4096, sha256: 'c'.repeat(64), verifiedAtMs: NOW - 10000,
  },
};

const membership = {
  convoyId: 'convoy-1',
  displayName: 'High Country',
  localIdentityRef: 'bm1_verified',
  authorizationState: 'authorized' as const,
  verifiedBy: 'security-v1' as const,
  membershipRecordRef: 'security-v1:bmg1_12345678:2',
};

function source(override: Partial<FieldPulseInput> = {}): FieldPulseInput {
  return {
    nowMs: NOW,
    radioConnected: false, channelSendAvailable: false,
    channelName: null, protocolTransportReady: false,
    locationStatus: 'stopped', locationProvider: null,
    fix: null, packCatalog: [], tilesReaderAvailable: false,
    mapRestore: 'ready', coveredTripPoints: 0, requiredTripPoints: 0,
    activeConvoy: null, convoyStatus: 'ready',
    ...override,
  };
}

test('field pulse starts with honest empty states and no membership or position', () => {
  const result = deriveFieldPulse(source());
  expect(result.map(item => [item.key, item.state])).toEqual([
    ['radio', 'unavailable'], ['gps', 'unavailable'],
    ['maps', 'unavailable'], ['convoy', 'unavailable'],
  ]);
  expect(result[3].detail).toContain('do not grant membership');
  expect(result[1].headline).toBe('Fix unavailable');
});

test('companion connected does not automatically mean carrier TX or Security verified', () => {
  const linkOnly = deriveFieldPulse(source({
    radioConnected: true, channelName: 'Public carrier',
    channelSendAvailable: false,
  }));
  expect(linkOnly[0].state).toBe('attention');
  expect(linkOnly[0].headline).toBe('Link only');
  const carrierOnly = deriveFieldPulse(source({
    radioConnected: true, channelName: 'Public carrier',
    channelSendAvailable: true, protocolTransportReady: false,
  }));
  expect(carrierOnly[0].state).toBe('attention');
  expect(carrierOnly[0].detail).toContain('Delivery unconfirmed');
  const ready = deriveFieldPulse(source({
    radioConnected: true, channelName: 'Public carrier',
    channelSendAvailable: true, protocolTransportReady: true,
  }));
  expect(ready[0].state).toBe('ready');
  expect(ready[0].detail).toContain('never assumed');
  expect(ready[3].state).toBe('unavailable');
});

test('GPS freshness and Android native source determine status', () => {
  const fix = {
    latitude: -37.8, longitude: 144.96,
    timestampMs: NOW - 4000, accuracyMeters: 7, headingDegrees: 90,
  };
  const live = deriveFieldPulse(source({
    locationStatus: 'tracking', locationProvider: 'Android GPS', fix,
  }));
  expect(live[1].state).toBe('ready');
  expect(live[1].detail).toContain('±7 m');
  const simulated = deriveFieldPulse(source({
    locationStatus: 'tracking', locationProvider: 'Simulated GPS', fix,
  }));
  expect(simulated[1].state).toBe('attention');
  const stale = deriveFieldPulse(source({
    locationStatus: 'tracking', locationProvider: 'Android GPS',
    fix: {...fix, timestampMs: NOW - 300000},
  }));
  expect(stale[1].headline).toBe('Last known only');
  const future = deriveFieldPulse(source({
    locationStatus: 'tracking', locationProvider: 'Android GPS',
    fix: {...fix, timestampMs: NOW + 60_000},
  }));
  expect(future[1].state).toBe('unavailable');
});

test('verified map archive is not proof that raster tiles rendered', () => {
  const ready = deriveFieldPulse(source({
    packCatalog: [verifiedPack], tilesReaderAvailable: true,
    requiredTripPoints: 3, coveredTripPoints: 3,
  }));
  expect(ready[2].headline).toBe('Pack verified');
  expect(ready[2].state).toBe('attention');
  expect(ready[2].detail).toContain('3/3');
  expect(ready[2].detail).toContain('Actual imagery not confirmed');
  const noReader = deriveFieldPulse(source({
    packCatalog: [verifiedPack], tilesReaderAvailable: false,
  }));
  expect(noReader[2].headline).toBe('Reader unavailable');
  const uncovered = deriveFieldPulse(source({
    packCatalog: [verifiedPack], tilesReaderAvailable: true,
    requiredTripPoints: 5, coveredTripPoints: 2,
  }));
  expect(uncovered[2].headline).toBe('Coverage incomplete');
});

test('convoy pulse derives only from Security v1 selected directory membership', () => {
  const verifying = deriveFieldPulse(source({
    convoyStatus: 'checking', activeConvoy: membership,
  }));
  expect(verifying[3].state).toBe('attention');
  expect(verifying[3].headline).toBe('Checking access');
  const verified = deriveFieldPulse(source({activeConvoy: membership}));
  expect(verified[3].state).toBe('ready');
  expect(verified[3].headline).toBe('High Country');
  expect(verified[3].detail).toContain('member positions not supplied');
  const bad = deriveFieldPulse(source({activeConvoy: membership, convoyStatus: 'error'}));
  expect(bad[3].state).toBe('unavailable');
});

test('field status cards expose five-tab navigation with accessible touch sizes', async () => {
  const open = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <FieldPulseStrip items={deriveFieldPulse(source())} onOpen={open} compact />,
    );
  });
  // Accessible labels identify the destination and actual readiness.
  const forwarded = renderer.root.findAll(node =>
    node.props.accessibilityRole === 'button' &&
    typeof node.props.onPress === 'function' &&
    typeof node.props.accessibilityLabel === 'string' &&
    node.props.accessibilityLabel.startsWith('Open '),
  );
  // TouchableOpacity forwards accessibility props to its host node. Count
  // distinct destinations, not both React Native wrapper instances.
  const cards = forwarded.filter((node, index) =>
    forwarded.findIndex(other =>
      other.props.accessibilityLabel === node.props.accessibilityLabel) === index,
  );
  expect(cards).toHaveLength(4);
  expect(StyleSheet.flatten(cards[0].props.style).minHeight).toBeGreaterThanOrEqual(94);
  await act(async () => {cards[3].props.onPress();});
  expect(open).toHaveBeenCalledWith('convoy');
  await act(async () => {renderer.unmount();});
});
