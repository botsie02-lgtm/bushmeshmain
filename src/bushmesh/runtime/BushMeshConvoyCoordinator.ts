import {
  BushMeshConvoyRole,
  BushMeshConvoyStatus,
  CompactLocation,
  encodeBushMeshConvoyWire,
} from '../protocol';
import {
  BushMeshConvoySnapshot,
  BushMeshConvoyTracker,
} from './BushMeshConvoyTracker';
import {BushMeshNodeRuntime} from './BushMeshNodeRuntime';

export type BushMeshLocalConvoyState = {
  convoyId: number;
  orderIndex: number;
  role: BushMeshConvoyRole | number;
  location?: CompactLocation;
  speedKph?: number;
  headingDegrees?: number;
  batteryPercent?: number;
  stopped?: boolean;
  hazard?: boolean;
};

export class BushMeshConvoyCoordinator {
  readonly tracker: BushMeshConvoyTracker;

  private localState: BushMeshLocalConvoyState | null = null;
  private channelIndex: number | null = null;
  private sequence = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalMs = 10_000;
  private running = false;
  private sending = false;

  constructor(
    private readonly node: BushMeshNodeRuntime,
    tracker = new BushMeshConvoyTracker(),
  ) {
    this.tracker = tracker;
  }

  configure(state: BushMeshLocalConvoyState): void {
    if (!Number.isInteger(state.convoyId) || state.convoyId < 0 || state.convoyId > 0xffffffff) {
      throw new Error('Convoy ID must be a uint32 value.');
    }
    if (!Number.isInteger(state.orderIndex) || state.orderIndex < 0 || state.orderIndex > 0xffff) {
      throw new Error('Convoy order index must be from 0 to 65535.');
    }
    if (!Number.isInteger(state.role) || state.role < 0 || state.role > 7) {
      throw new Error('Convoy role must be from 0 to 7.');
    }

    this.localState = {
      ...state,
      location: state.location ? {...state.location} : undefined,
    };
  }

  updateTelemetry(
    update: Partial<
      Pick<
        BushMeshLocalConvoyState,
        | 'location'
        | 'speedKph'
        | 'headingDegrees'
        | 'batteryPercent'
        | 'stopped'
        | 'hazard'
      >
    >,
  ): void {
    if (!this.localState) {
      throw new Error('Convoy coordinator must be configured before telemetry updates.');
    }

    this.localState = {
      ...this.localState,
      ...update,
      location: update.location
        ? {...update.location}
        : this.localState.location
          ? {...this.localState.location}
          : undefined,
    };
  }

  start(channelIndex: number, intervalMs = 10_000): void {
    if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 255) {
      throw new Error('Convoy channel must be an integer from 0 to 255.');
    }
    if (!Number.isFinite(intervalMs) || intervalMs < 2_000) {
      throw new Error('Convoy heartbeat interval must be at least two seconds.');
    }
    if (!this.localState) {
      throw new Error('Convoy coordinator must be configured before it starts.');
    }

    this.stopTimer();
    this.channelIndex = channelIndex;
    this.intervalMs = intervalMs;
    this.running = true;
    void this.sendNow().finally(() => this.arm());
  }

  stop(): void {
    this.running = false;
    this.stopTimer();
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendNow(): Promise<void> {
    if (this.sending) {
      return;
    }

    const state = this.localState;
    const channelIndex = this.channelIndex;
    const local = this.node.localHello();

    if (!state || channelIndex === null || !local || !this.node.isRunning()) {
      return;
    }

    this.sending = true;
    try {
      const status: BushMeshConvoyStatus = {
        convoyId: state.convoyId,
        nodeId: local.nodeId,
        sequence: this.nextSequence(),
        orderIndex: state.orderIndex,
        role: state.role,
        location: state.location ? {...state.location} : undefined,
        speedKph: state.speedKph,
        headingDegrees: state.headingDegrees,
        batteryPercent: state.batteryPercent,
        stopped: state.stopped,
        hazard: state.hazard,
      };

      this.tracker.accept(status);
      const wire = encodeBushMeshConvoyWire(
        status,
        this.node.network.nextMessageId(),
      );
      await this.node.network.sendWire(channelIndex, wire, {
        allowFragmentation: false,
      });
    } finally {
      this.sending = false;
    }
  }

  acceptRemote(status: BushMeshConvoyStatus, receivedAt = Date.now()): boolean {
    const localNodeId = this.node.localHello()?.nodeId;
    if (localNodeId !== undefined && status.nodeId === localNodeId) {
      return false;
    }
    return this.tracker.accept(status, receivedAt);
  }

  snapshot(now = Date.now()): BushMeshConvoySnapshot | null {
    const convoyId = this.localState?.convoyId;
    return convoyId === undefined ? null : this.tracker.snapshot(convoyId, now);
  }

  relayCandidates(destinationNodeId: number, now = Date.now()): number[] {
    const state = this.localState;
    const localNodeId = this.node.localHello()?.nodeId;
    if (!state || localNodeId === undefined) {
      return [];
    }

    return this.tracker.relayCandidates(
      state.convoyId,
      localNodeId,
      destinationNodeId,
      now,
    );
  }

  private nextSequence(): number {
    const current = this.sequence >>> 0;
    this.sequence = (current + 1) >>> 0;
    if (this.sequence === 0) {
      this.sequence = 1;
    }
    return current === 0 ? 1 : current;
  }

  private arm(): void {
    this.stopTimer();
    if (!this.running) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sendNow().finally(() => this.arm());
    }, this.intervalMs);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
