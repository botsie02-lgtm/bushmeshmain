import {useSyncExternalStore} from 'react';

import {
  getBushMeshPeerTrackSnapshot,
  subscribeBushMeshPeerTracks,
} from '../bushmesh/runtime/BushMeshPeerTrackHub';

export function useBushMeshPeerTracks() {
  return useSyncExternalStore(
    subscribeBushMeshPeerTracks,
    getBushMeshPeerTrackSnapshot,
    getBushMeshPeerTrackSnapshot,
  );
}
