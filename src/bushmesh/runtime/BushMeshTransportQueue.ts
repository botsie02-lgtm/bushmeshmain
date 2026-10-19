import {assertIntegerInRange} from '../protocol';

type PendingTransportTask<T> = {
  id: number;
  priority: number;
  queuedAt: number;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export type BushMeshTransportQueueSnapshot = {
  active: boolean;
  pendingCount: number;
  nextPriority: number | null;
};

/**
 * Serialises writes to the underlying MeshCore transport and chooses the
 * highest-priority waiting frame between writes. A task already in flight is
 * never interrupted; priority applies to the next radio/BLE write.
 */
export class BushMeshTransportQueue {
  private readonly pending: Array<PendingTransportTask<unknown>> = [];
  private nextId = 1;
  private active = false;

  enqueue<T>(
    priority: number,
    task: () => Promise<T>,
    now = Date.now(),
  ): Promise<T> {
    assertIntegerInRange(priority, 0, 7, 'Transport priority');

    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        id: this.nextId++,
        priority,
        queuedAt: now,
        task: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pending.sort((a, b) =>
        a.priority !== b.priority
          ? a.priority - b.priority
          : a.queuedAt !== b.queuedAt
            ? a.queuedAt - b.queuedAt
            : a.id - b.id,
      );
      this.pump();
    });
  }

  snapshot(): BushMeshTransportQueueSnapshot {
    return {
      active: this.active,
      pendingCount: this.pending.length,
      nextPriority: this.pending[0]?.priority ?? null,
    };
  }

  cancelPending(error = new Error('BushMesh transport queue cancelled.')): number {
    const pending = this.pending.splice(0, this.pending.length);
    for (const item of pending) {
      item.reject(error);
    }
    return pending.length;
  }

  private pump(): void {
    if (this.active) {
      return;
    }

    const next = this.pending.shift();
    if (!next) {
      return;
    }

    this.active = true;
    void next
      .task()
      .then(next.resolve, next.reject)
      .finally(() => {
        this.active = false;
        this.pump();
      });
  }
}
