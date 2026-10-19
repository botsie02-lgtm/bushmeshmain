import {
  BushMeshOutboxSnapshotV1,
  decodeOutboxSnapshot,
  encodeOutboxSnapshot,
} from './outboxSnapshot';

/**
 * Durable storage boundary for Bushmesh state that must survive process death.
 *
 * The production implementation is expected to be backed by SQLite. Keeping
 * this interface independent of React and radio transports lets the Android
 * foreground service and the UI share the same persistence semantics later.
 */
export interface BushMeshPersistence {
  loadOutbox(): Promise<BushMeshOutboxSnapshotV1 | null>;
  saveOutbox(snapshot: BushMeshOutboxSnapshotV1): Promise<void>;
  clearOutbox(): Promise<void>;
}

/**
 * Test/development implementation only. This does not provide durability and
 * must never be used to claim store-and-forward survives an app restart.
 */
export class MemoryBushMeshPersistence implements BushMeshPersistence {
  private serializedOutbox: string | null = null;

  async loadOutbox(): Promise<BushMeshOutboxSnapshotV1 | null> {
    return this.serializedOutbox === null
      ? null
      : decodeOutboxSnapshot(this.serializedOutbox);
  }

  async saveOutbox(snapshot: BushMeshOutboxSnapshotV1): Promise<void> {
    this.serializedOutbox = encodeOutboxSnapshot(snapshot);
  }

  async clearOutbox(): Promise<void> {
    this.serializedOutbox = null;
  }
}
