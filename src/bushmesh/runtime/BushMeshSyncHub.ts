import {BushMeshDurableSyncManager} from './BushMeshDurableSyncManager';

const sharedSyncManager = new BushMeshDurableSyncManager();
void sharedSyncManager.ensurePersistenceInitialized();

/**
 * Shared sync inventory used by the active BushMesh node runtime and the React
 * app-state bridge. Keeping one manager means an incoming RequestSync command
 * sees the same contact/channel/message inventory the UI has populated.
 *
 * The durable manager restores missing namespaces in merge mode and
 * automatically checkpoints later mutations through the native key/value store
 * when one is available.
 */
export function getBushMeshSyncManager(): BushMeshDurableSyncManager {
  return sharedSyncManager;
}
