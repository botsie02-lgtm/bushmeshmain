import {BushMeshTransmissionController} from '../radio/BushMeshTransmissionController';
import {BushMeshPersistence} from './BushMeshPersistence';
import {
  createOutboxSnapshot,
  restoreOutboxSnapshot,
} from './outboxSnapshot';

export type OutboxRestoreResult = {
  restored: boolean;
  entryCount: number;
};

/**
 * Bridges the transmission controller to durable storage without coupling the
 * radio domain to SQLite or React. Production startup should restore before the
 * radio drain worker is allowed to transmit.
 */
export class OutboxPersistenceCoordinator {
  constructor(
    private readonly controller: BushMeshTransmissionController,
    private readonly persistence: BushMeshPersistence,
  ) {}

  async save(nowMs = Date.now()): Promise<void> {
    const snapshot = createOutboxSnapshot(this.controller.list(), nowMs);
    await this.persistence.saveOutbox(snapshot);
  }

  async restore(recoveredAtMs = Date.now()): Promise<OutboxRestoreResult> {
    const snapshot = await this.persistence.loadOutbox();
    if (!snapshot) {
      return {restored: false, entryCount: 0};
    }

    const entries = restoreOutboxSnapshot(snapshot, recoveredAtMs);
    this.controller.restoreEntries(entries);
    return {restored: true, entryCount: entries.length};
  }

  async clear(): Promise<void> {
    await this.persistence.clearOutbox();
    this.controller.restoreEntries([]);
  }
}
