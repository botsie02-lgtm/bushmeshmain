import {useEffect, useState} from 'react';

import {
  BushMeshConvoyHubState,
  getBushMeshConvoyState,
  subscribeBushMeshConvoy,
} from '../bushmesh/runtime/BushMeshConvoyHub';

export function useBushMeshConvoyState(): BushMeshConvoyHubState {
  const [state, setState] = useState<BushMeshConvoyHubState>(() =>
    getBushMeshConvoyState(),
  );

  useEffect(() => {
    return subscribeBushMeshConvoy(() => {
      setState(getBushMeshConvoyState());
    });
  }, []);

  return state;
}
