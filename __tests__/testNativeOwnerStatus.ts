import {NativeRadioServiceStatus} from '../src/native/NativeRadioService';

/** A fully released Android target, unlike a missing status response. */
export function releasedNativeOwnerStatus(): NativeRadioServiceStatus {
  return {
    running: false, radioRequested: false, locationRequested: false,
    deviceLabel: null, deviceAddress: null, startedAtMs: 0,
    ownership: 'react-native-session', nativeBleState: 'disconnected',
    nativeBleDeviceAddress: null, nativeBleDeviceLabel: null,
    nativeBleMtu: 0, nativeBleReconnectAttempt: 0,
    nativeBleConnectedAtMs: 0, nativeBleLastError: null,
    nativeBleQueuedWrites: 0, nativeBleBufferedFrames: 0,
    persistedNativeTargetPresent: false,
  };
}
