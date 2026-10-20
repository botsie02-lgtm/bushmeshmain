import {useSyncExternalStore} from 'react';

import {
  getBushMeshLiveStateSnapshot,
  subscribeBushMeshLiveState,
} from '../bushmesh/runtime/BushMeshLiveStateHub';

export function useBushMeshLiveState() {
  return useSyncExternalStore(
    subscribeBushMeshLiveState,
    getBushMeshLiveStateSnapshot,
    getBushMeshLiveStateSnapshot,
  );
}
