import {BushMeshPeerRegistry} from './BushMeshPeerRegistry';

export type BushMeshPeerMaintenanceEvents = {
  onPeersPruned?: (nodeIds: number[]) => void;
};

export class BushMeshPeerMaintenance {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly registry: BushMeshPeerRegistry,
    private readonly events: BushMeshPeerMaintenanceEvents = {},
  ) {}

  start(intervalMs = 60 * 1000): void {
    if (!Number.isFinite(intervalMs) || intervalMs < 5000) {
      throw new Error('Peer maintenance interval must be at least five seconds.');
    }

    this.stop();
    this.timer = setInterval(() => {
      this.run();
    }, intervalMs);
  }

  run(now = Date.now()): number[] {
    const removed = this.registry.prune(now);

    if (removed.length > 0) {
      this.events.onPeersPruned?.(removed);
    }

    return removed;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
