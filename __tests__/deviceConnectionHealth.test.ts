import {
  canManageRadio, deviceConnectionPhase,
} from '../src/device/deviceConnectionHealth';

describe('Device connection and native ownership states', () => {
  const base = {status: 'Disconnected' as const,
    connectionOwner: 'none' as const, isWriting: false};

  it('does not treat Android reconnect or shutdown as a ready second BLE owner', () => {
    expect(deviceConnectionPhase(base, 'idle')).toBe('disconnected');
    expect(deviceConnectionPhase({...base, status: 'Connecting'}, 'taking-over'))
      .toBe('connecting');
    expect(deviceConnectionPhase({
      status: 'Connected', connectionOwner: 'android-native', isWriting: false,
    }, 'taking-over')).toBe('connecting');
    expect(deviceConnectionPhase({
      status: 'Connected', connectionOwner: 'android-native', isWriting: false,
    }, 'active')).toBe('ready');
    expect(deviceConnectionPhase({
      status: 'Connected', connectionOwner: 'android-native', isWriting: true,
    }, 'active')).toBe('busy');
    expect(deviceConnectionPhase({
      status: 'Connected', connectionOwner: 'android-native', isWriting: false,
    }, 'stopping')).toBe('busy');
    expect(deviceConnectionPhase({...base, status: 'Error'}, 'error')).toBe('error');
  });

  it('makes management available only for a ready existing owner', () => {
    expect(canManageRadio('ready', {connectionOwner: 'android-native'})).toBe(true);
    expect(canManageRadio('ready', {connectionOwner: 'react-native'})).toBe(true);
    expect(canManageRadio('ready', {connectionOwner: 'none'})).toBe(false);
    expect(canManageRadio('busy', {connectionOwner: 'android-native'})).toBe(false);
  });
});
