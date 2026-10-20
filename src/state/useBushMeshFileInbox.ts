import {useSyncExternalStore} from 'react';

import {
  getBushMeshFileInboxSnapshot,
  subscribeBushMeshFileInbox,
} from '../bushmesh/runtime/BushMeshFileInboxHub';

export function useBushMeshFileInbox() {
  return useSyncExternalStore(
    subscribeBushMeshFileInbox,
    getBushMeshFileInboxSnapshot,
    getBushMeshFileInboxSnapshot,
  );
}
