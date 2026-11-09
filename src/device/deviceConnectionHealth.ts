import {AppRadioConnectionSnapshot} from '../radio/AppRadioConnectionService';
import {NativeMeshCoreOwnershipState} from '../meshcore/NativeMeshCoreSessionCoordinator';

export type DeviceConnectionPhase = 'disconnected' | 'connecting' | 'ready' | 'busy' | 'error';

export function deviceConnectionPhase(
  snapshot: Pick<AppRadioConnectionSnapshot, 'status' | 'connectionOwner' | 'isWriting'>,
  nativeState: NativeMeshCoreOwnershipState,
): DeviceConnectionPhase {
  if (snapshot.status === 'Error' || nativeState === 'error') return 'error';
  if (snapshot.isWriting || nativeState === 'stopping') return 'busy';
  if (
    snapshot.status === 'Connecting' ||
    snapshot.status === 'Requesting permissions' ||
    nativeState === 'taking-over'
  ) return 'connecting';
  if (snapshot.status === 'Connected' &&
      snapshot.connectionOwner !== 'none' &&
      (snapshot.connectionOwner !== 'android-native' || nativeState === 'active')) {
    return 'ready';
  }
  return 'disconnected';
}

export function canManageRadio(
  phase: DeviceConnectionPhase,
  snapshot: Pick<AppRadioConnectionSnapshot, 'connectionOwner'>,
): boolean {
  return phase === 'ready' && snapshot.connectionOwner !== 'none';
}
