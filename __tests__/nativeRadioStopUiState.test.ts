import {NativeMeshCoreOwnershipSnapshot} from '../src/meshcore/NativeMeshCoreSessionCoordinator';
import {NativeRadioServiceStatus} from '../src/native/NativeRadioService';
import {isNativeRadioStopAvailable} from '../src/screens/NativeRadioSetupScreen';
import {releasedNativeOwnerStatus} from './testNativeOwnerStatus';

function coordinator(
  state: NativeMeshCoreOwnershipSnapshot['state'],
  deviceAddress: string | null = state === 'idle' ? null : 'AA:BB:CC:DD:EE:FF',
): NativeMeshCoreOwnershipSnapshot {
  return {
    state, deviceAddress, deviceLabel: deviceAddress ? 'Test Heltec' : null,
    statusMessage: null, errorMessage: null, lastFrame: null,
  };
}
function active(): NativeRadioServiceStatus {
  return {
    ...releasedNativeOwnerStatus(),
    running: true, radioRequested: true,
    ownership: 'native-service', nativeBleState: 'ready',
    deviceAddress: 'AA:BB:CC:DD:EE:FF',
    nativeBleDeviceAddress: 'AA:BB:CC:DD:EE:FF',
    persistedNativeTargetPresent: true,
  };
}

describe('Background Radio Stop visibility across ownership divergence', () => {
  it('offers Stop when Android target is ACTIVE even if React says no BLE owner', () => {
    expect(isNativeRadioStopAvailable('none', coordinator('idle'), active())).toBe(true);
  });

  it('offers Stop while native coordinator is taking over or error, including app Connecting', () => {
    expect(isNativeRadioStopAvailable('none', coordinator('taking-over'), null)).toBe(true);
    expect(isNativeRadioStopAvailable('none', coordinator('error'), null)).toBe(true);
    expect(isNativeRadioStopAvailable('android-native', coordinator('idle'), null)).toBe(true);
  });

  it('offers Stop if a persisted Android target remains after a crash', () => {
    expect(isNativeRadioStopAvailable(
      'none', coordinator('idle'),
      {...releasedNativeOwnerStatus(), persistedNativeTargetPresent: true},
    )).toBe(true);
  });

  it('does not show native Stop for an unrelated standalone JS BLE owner', () => {
    expect(isNativeRadioStopAvailable(
      'react-native', coordinator('idle'), releasedNativeOwnerStatus(),
    )).toBe(false);
  });

  it('does not infer a usable command session from native BLE ready alone', () => {
    expect(isNativeRadioStopAvailable('none', coordinator('idle'), active())).toBe(true);
    // Stop availability is independent of send authorization. The actual
    // AppRadioConnectionService.hasUsableSendSession() requires a live native
    // coordinator session identity and the app's Connected state.
  });
});
