import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {AppState, type AppStateStatus} from 'react-native';
import {ConnectedChannelFieldLocation} from '../src/convoy/fieldLocation/ConnectedChannelFieldLocation';
import type {ChannelFieldRadioPort} from '../src/convoy/fieldLocation/ChannelFieldLocationSession';
import {encodeUnverifiedChannelPosition} from '../src/convoy/fieldLocation/channelFieldWire';

const mockChannel = {channelIndex: '4', channelName: 'Field test', secret: 'Configured (redacted)'};
const mockSend = jest.fn(async (_index: number, _text: string) => {});
let mockConnected = true;
let mockAddress = 'radio-A';
let mockFixTime = 1800000000000;
const mockConnections = new Set<() => void>();
const mockIncoming = new Set<Parameters<ChannelFieldRadioPort['subscribeMessages']>[0]>();
jest.mock('../src/state/BushMeshContext', () => ({useBushMesh: () => ({activeChannel: mockChannel})}));
jest.mock('../src/state/LocationSessionContext', () => ({useLocationSession: () => ({
  status: 'tracking', providerLabel: 'Android GPS',
  latestFix: {latitude: -37.81, longitude: 144.95, timestampMs: mockFixTime, accuracyMeters: 8},
})}));
jest.mock('../src/radio/AppRadioConnectionService', () => ({appRadioConnectionService: {
  getSnapshot: () => ({connectionOwner: 'android-native', connectedDeviceAddress: mockAddress, channels: [mockChannel]}),
}}));
jest.mock('../src/convoy/fieldLocation/existingPorts', () => ({
  createExistingMeshCoreChannelPort: () => ({
    isConnected: () => mockConnected,
    isPrivateChannel: (index: number) => index === 4,
    currentModem: () => ({spreadingFactor: 9, bandwidthKhz: 125, codingRate: 5}),
    sendChannelMessage: mockSend,
    randomBytes: async () => Uint8Array.from(Array(12).fill(17)),
    subscribeMessages: (listener: Parameters<ChannelFieldRadioPort['subscribeMessages']>[0]) => {
      mockIncoming.add(listener); return () => mockIncoming.delete(listener);
    },
    subscribeConnection: (listener: () => void) => {
      mockConnections.add(listener); return () => mockConnections.delete(listener);
    },
  }),
  readRealAndroidLocation: (view: {latestFix: unknown; status: string}) =>
    ({providerId: 'android-gps', status: view.status, fix: view.latestFix}),
}));

function control(renderer: TestRenderer.ReactTestRenderer, label: string, prop = 'onPress') {
  const node = renderer.root.findAllByProps({accessibilityLabel: label})
    .find(n => typeof n.props[prop] === 'function');
  if (!node) throw new Error('Missing control ' + label);
  return node;
}

test('mounted field control needs explicit consent; projects only unverified positions; radio switch and background stop it', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(mockFixTime);
  const original = AppState.currentState;
  AppState.currentState = 'active';
  let onAppState: ((state: AppStateStatus) => void) | undefined;
  const stateSubscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    onAppState = listener;
    return {remove: jest.fn()} as ReturnType<typeof AppState.addEventListener>;
  });
  const onPositions = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => {renderer = TestRenderer.create(<ConnectedChannelFieldLocation onPositions={onPositions} />);});
    expect(control(renderer, 'Start unverified channel sharing').props.disabled).toBe(true);
    expect(mockConnections.size).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    await act(async () => {control(renderer, 'Unverified vehicle label', 'onChangeText').props.onChangeText('CarA');});
    expect(control(renderer, 'Start unverified channel sharing').props.disabled).toBe(true);
    await act(async () => {control(renderer, 'Accept unverified location sharing warning').props.onPress();});
    expect(control(renderer, 'Start unverified channel sharing').props.disabled).toBe(false);
    await act(async () => {control(renderer, 'Start unverified channel sharing').props.onPress();});
    expect(mockConnections.size).toBe(1);
    expect(mockSend).not.toHaveBeenCalled();
    await act(async () => {jest.advanceTimersByTime(10000);});
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toBe(4);
    expect(mockSend.mock.calls[0][1]).toMatch(/^BMFL1\|/);
    const now = Date.now();
    const text = encodeUnverifiedChannelPosition({
      session: 'ab'.repeat(12), sequence: 1, issuedAtMs: now,
      latitude: -37.82, longitude: 144.96, claimedLabel: 'CarB',
    });
    await act(async () => {
      mockIncoming.forEach(listener => listener({
        message: {packetType: 'channel', channelIndex: '4', text, timestamp: null, pathLength: null, textType: 0, snr: null},
        receivedAtMs: now,
      }));
    });
    expect(onPositions).toHaveBeenLastCalledWith([expect.objectContaining({
      trust: 'unverified-channel', label: 'CHANNEL · CarB', simulated: false,
    })]);
    await act(async () => {
      mockAddress = 'radio-B';
      [...mockConnections].forEach(listener => listener());
    });
    expect(mockConnections.size).toBe(0);
    expect(onPositions).toHaveBeenLastCalledWith([]);
    expect(control(renderer, 'Start unverified channel sharing').props.disabled).toBe(true);
    await act(async () => {jest.advanceTimersByTime(60000);});
    expect(mockSend).toHaveBeenCalledTimes(1);
    mockFixTime = Date.now();
    await act(async () => {renderer.update(<ConnectedChannelFieldLocation onPositions={onPositions} />);});
    await act(async () => {control(renderer, 'Accept unverified location sharing warning').props.onPress();});
    await act(async () => {control(renderer, 'Start unverified channel sharing').props.onPress();});
    expect(mockConnections.size).toBe(1);
    await act(async () => {
      AppState.currentState = 'background';
      onAppState?.('background');
    });
    expect(mockConnections.size).toBe(0);
    expect(mockIncoming.size).toBe(0);
    await act(async () => {jest.advanceTimersByTime(60000);});
    expect(mockSend).toHaveBeenCalledTimes(1);
  } finally {
    if (renderer) await act(async () => {renderer.unmount();});
    stateSubscription.mockRestore();
    AppState.currentState = original;
    jest.useRealTimers();
  }
});
