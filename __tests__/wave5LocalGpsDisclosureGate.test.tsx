import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {LocationSessionProvider, useLocationSession, LEGACY_AUTOMATIC_LOCATION_DISCLOSURE_ALLOWED} from '../src/state/LocationSessionContext';
import type {LocationFixHandler} from '../src/location/LocationProvider';

const mockQueue = jest.fn();
const mockDrain = jest.fn(async () => undefined);
const mockSetLocal = jest.fn();
jest.mock('../src/state/BushMeshContext', () => ({useBushMesh: () => ({activeChannel: {channelIndex: '4'}})}));
jest.mock('../src/state/ConvoyContext', () => ({useConvoy: () => ({vehicles: [], setLocalPosition: mockSetLocal})}));
jest.mock('../src/state/RadioSessionContext', () => ({useRadioSession: () => ({
  snapshot: {transportReady: true, identityRef: '123456789ABC'}, queuePosition: mockQueue, drainOnce: mockDrain,
})}));
jest.mock('../src/persistence/AndroidTrackPersistence', () => ({androidTrackPersistence: {isSupported: () => false}}));
jest.mock('../src/location/AndroidGpsLocationProvider', () => ({androidGpsLocationProvider: {isSupported: () => false}}));
jest.mock('../src/native/NativeFileExport', () => ({nativeFileExport: {isSupported: () => false}}));

test('even a ready raw link cannot auto-broadcast GPS or answer legacy requests; local recording remains', async () => {
  let value!: ReturnType<typeof useLocationSession>;
  let emit!: LocationFixHandler;
  const stop = jest.fn();
  function Observer() {value = useLocationSession(); return null;}
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {renderer = TestRenderer.create(<LocationSessionProvider><Observer /></LocationSessionProvider>);});
  await act(async () => {
    value.startProvider({id: 'test', label: 'Android GPS', start: handler => {emit = handler; return stop;}});
  });
  const now = Date.now();
  await act(async () => {emit({latitude: -37.8, longitude: 144.9, timestampMs: now, accuracyMeters: 8});});
  expect(LEGACY_AUTOMATIC_LOCATION_DISCLOSURE_ALLOWED).toBe(false);
  expect(value.latestFix?.latitude).toBe(-37.8);
  expect(value.trackPoints).toHaveLength(1);
  expect(mockSetLocal).toHaveBeenCalled();
  expect(value.transmittedPlanCount).toBe(0);
  expect(value.respondToPositionRequest(4, now)).toMatchObject({queued: false, entryId: null});
  expect(mockQueue).not.toHaveBeenCalled();
  expect(mockDrain).not.toHaveBeenCalled();
  await act(async () => {renderer.unmount();});
  expect(stop).toHaveBeenCalled();
});
