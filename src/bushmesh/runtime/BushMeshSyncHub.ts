import {BushMeshSyncManager} from './BushMeshSyncManager';

const sharedSyncManager = new BushMeshSyncManager();

/**
 * Shared sync inventory used by the active BushMesh node runtime and the React
 * app-state bridge. Keeping one manager means an incoming RequestSync command
 * sees the same contact/channel/message inventory the UI has populated.
 */
export function getBushMeshSyncManager(): BushMeshSyncManager {
  return sharedSyncManager;
}
