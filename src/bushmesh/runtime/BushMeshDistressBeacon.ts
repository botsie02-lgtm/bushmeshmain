import {
  BushMeshDistress,
  BushMeshPriority,
  encodeBushMeshDistressWire,
  encodeBushMeshRoutedWire,
} from '../protocol';
import {BushMeshNetworkRuntime} from './BushMeshNetworkRuntime';

export type BushMeshDistressBeaconOptions = {
  destinationNodeId?: number;
  ttlHops?: number;
  repeatDelaysMs?: number[];
};

export type BushMeshDistressBeaconState = {
  active: boolean;
  messageId: number | null;
  transmissions: number;
  remainingRepeats: number;
};

export class BushMeshDistressBeacon {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private activeMessageId: number | null = null;
  private transmissions = 0;
  private remainingRepeats = 0;

  constructor(
    private readonly network: BushMeshNetworkRuntime,
    private readonly localNodeId: () => number,
  ) {}

  async start(
    channelIndex: number,
    distress: BushMeshDistress,
    options?: BushMeshDistressBeaconOptions,
  ): Promise<number> {
    this.stop();

    const sourceNodeId = this.localNodeId();
    const innerMessageId = this.network.nextMessageId();
    const routedMessageId = this.network.nextMessageId();
    const innerWireBytes = encodeBushMeshDistressWire(
      distress,
      innerMessageId,
      {ttlHops: options?.ttlHops ?? 6},
    );
    const routedWireBytes = encodeBushMeshRoutedWire(
      {
        sourceNodeId,
        destinationNodeId: options?.destinationNodeId,
        innerWireBytes,
      },
      routedMessageId,
      {
        ttlHops: options?.ttlHops ?? 6,
        priority: BushMeshPriority.Emergency,
      },
    );

    const repeatDelays = options?.repeatDelaysMs ?? [15000, 45000, 90000];
    this.validateRepeatDelays(repeatDelays);
    this.activeMessageId = routedMessageId;
    this.transmissions = 0;
    this.remainingRepeats = repeatDelays.length;

    await this.transmit(channelIndex, routedWireBytes);

    for (const delayMs of repeatDelays) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void this.transmit(channelIndex, routedWireBytes).finally(() => {
          this.remainingRepeats = Math.max(0, this.remainingRepeats - 1);
          if (this.remainingRepeats === 0) {
            this.activeMessageId = null;
          }
        });
      }, delayMs + this.jitterMs(sourceNodeId, routedMessageId, delayMs));
      this.timers.add(timer);
    }

    return routedMessageId;
  }

  stop(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.activeMessageId = null;
    this.remainingRepeats = 0;
  }

  state(): BushMeshDistressBeaconState {
    return {
      active: this.activeMessageId !== null,
      messageId: this.activeMessageId,
      transmissions: this.transmissions,
      remainingRepeats: this.remainingRepeats,
    };
  }

  private async transmit(channelIndex: number, wireBytes: number[]): Promise<void> {
    await this.network.sendWire(channelIndex, wireBytes);
    this.transmissions += 1;
  }

  private validateRepeatDelays(delays: number[]): void {
    if (delays.length > 8) {
      throw new Error('Distress beacon supports at most eight repeats.');
    }

    let previous = 0;
    for (const delay of delays) {
      if (!Number.isFinite(delay) || delay < 1000 || delay <= previous) {
        throw new Error(
          'Distress repeat delays must be increasing and at least one second.',
        );
      }
      previous = delay;
    }
  }

  private jitterMs(sourceNodeId: number, messageId: number, delayMs: number): number {
    let value = (sourceNodeId ^ messageId ^ delayMs) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
    value ^= value >>> 16;
    return value % 1500;
  }
}