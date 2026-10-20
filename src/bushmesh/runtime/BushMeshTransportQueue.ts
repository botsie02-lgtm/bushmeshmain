import {BushMeshPriority, assertIntegerInRange} from '../protocol';

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
  maxPending: number;
  droppedTasks: number;
};

export class BushMeshTransportQueueFullError extends Error {
  constructor(message = 'BushMesh transport queue is full.') {
    super(message);
    this.name = 'BushMeshTransportQueueFullError';
  }
}

/**
 * Serialises writes to the underlying MeshCore transport and chooses the
 * highest-priority waiting frame between writes. A task already in flight is
 * never interrupted; priority applies to the next radio/BLE write.
 *
 * The queue is deliberately bounded. When full, emergency traffic may evict
 * the newest/worst lower-priority pending task; normal traffic is rejected so
 * background sync/file bursts cannot consume unbounded memory or delay SOS.
 */
export class BushMeshTransportQueue {
  private readonly pending: Array<PendingTransportTask<unknown>> = [];
  private nextId = 1;
  private active = false;
  private droppedTasks = 0;

  constructor(private readonly maxPending = 128) {
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new Error('Transport queue capacity must be a positive integer.');
    }
  }

  enqueue<T>(
    priority: number,
    task: () => Promise<T>,
    now = Date.now(),
  ): Promise<T> {
    assertIntegerInRange(priority, 0, 7, 'Transport priority');

    return new Promise<T>((resolve, reject) => {
      if (this.pending.length >= this.maxPending) {
        if (priority === BushMeshPriority.Emergency) {
          const evicted = this.evictWorstLowerPriority(priority);
          if (!evicted) {
            this.droppedTasks += 1;
            reject(
              new BushMeshTransportQueueFullError(
                'BushMesh transport queue is full of emergency traffic.',
              ),
            );
            return;
          }
        } else {
          this.droppedTasks += 1;
          reject(
            new BushMeshTransportQueueFullError(
              'BushMesh transport queue is congested; low-priority work was not queued.',
            ),
          );
          return;
        }
      }

      this.pending.push({
        id: this.nextId++,
        priority,
        queuedAt: now,
        task: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.sortPending();
      this.pump();
    });
  }

  snapshot(): BushMeshTransportQueueSnapshot {
    return {
      active: this.active,
      pendingCount: this.pending.length,
      nextPriority: this.pending[0]?.priority ?? null,
      maxPending: this.maxPending,
      droppedTasks: this.droppedTasks,
    };
  }

  cancelPending(error = new Error('BushMesh transport queue cancelled.')): number {
    const pending = this.pending.splice(0, this.pending.length);
    for (const item of pending) {
      item.reject(error);
    }
    return pending.length;
  }

  private evictWorstLowerPriority(incomingPriority: number): boolean {
    let worstIndex = -1;

    for (let index = 0; index < this.pending.length; index += 1) {
      const candidate = this.pending[index];
      if (candidate.priority <= incomingPriority) {
        continue;
      }

      if (worstIndex < 0) {
        worstIndex = index;
        continue;
      }

      const worst = this.pending[worstIndex];
      if (
        candidate.priority > worst.priority ||
        (candidate.priority === worst.priority && candidate.queuedAt > worst.queuedAt) ||
        (candidate.priority === worst.priority &&
          candidate.queuedAt === worst.queuedAt &&
          candidate.id > worst.id)
      ) {
        worstIndex = index;
      }
    }

    if (worstIndex < 0) {
      return false;
    }

    const [evicted] = this.pending.splice(worstIndex, 1);
    this.droppedTasks += 1;
    evicted.reject(
      new BushMeshTransportQueueFullError(
        'BushMesh transport task was displaced by emergency traffic.',
      ),
    );
    return true;
  }

  private sortPending(): void {
    this.pending.sort((a, b) =>
      a.priority !== b.priority
        ? a.priority - b.priority
        : a.queuedAt !== b.queuedAt
          ? a.queuedAt - b.queuedAt
          : a.id - b.id,
    );
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
