import {useSyncExternalStore} from 'react';

import {
  BushMeshConvoyHubState,
  getBushMeshConvoyState,
  subscribeBushMeshConvoy,
} from '../bushmesh/runtime/BushMeshConvoyHub';

export function useBushMeshConvoyState(): BushMeshConvoyHubState {
  return useSyncExternalStore(
    subscribeBushMeshConvoy,
    () => getBushMeshConvoyState(),
    () => getBushMeshConvoyState(),
  );
}
