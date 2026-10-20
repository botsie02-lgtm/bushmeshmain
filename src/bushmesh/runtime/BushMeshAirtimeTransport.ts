import {Buffer} from 'buffer';

import {
  BushMeshPriority,
  decodeBushMeshTextCarrier,
  decodeBushMeshWire,
} from '../protocol';
import {BushMeshAirtimeController, BushMeshAirtimeDecision} from './BushMeshAirtimeController';
import {BushMeshRuntimeTransport} from './BushMeshNetworkRuntime';

export type BushMeshAirtimeTransportEvents = {
  onAdmitted?: (decision: BushMeshAirtimeDecision) => void;
  onDeferred?: (decision: BushMeshAirtimeDecision) => void;
};

/**
 * Decorates the actual BushMesh transport with airtime admission. It derives the
 * packet priority from the wire envelope and uses the real transmitted payload
 * size (including Base64url overhead for text-safe transport).
 *
 * No radio profile or legal duty-cycle numbers are hard-coded here. The caller
 * supplies a configured BushMeshAirtimeController once firmware/radio settings
 * are known.
 */
export class BushMeshAirtimeTransport implements BushMeshRuntimeTransport {
  constructor(
    private readonly inner: BushMeshRuntimeTransport,
    readonly airtime: BushMeshAirtimeController,
    private readonly events: BushMeshAirtimeTransportEvents = {},
  ) {}

  async sendTextChannelMessage(
    channelIndex: number,
    message: string,
  ): Promise<unknown> {
    const bytes = Array.from(Buffer.from(message, 'utf8'));
    const priority = this.priorityFromTextCarrier(message);
    const decision = this.admit(bytes.length, priority);

    const result = await this.inner.sendTextChannelMessage(channelIndex, message);
    this.commit(bytes.length, priority, decision);
    return result;
  }

  async sendBinaryChannelPayload(
    channelIndex: number,
    payloadBytes: number[],
  ): Promise<unknown> {
    if (!this.inner.sendBinaryChannelPayload) {
      throw new Error('Binary BushMesh transport is not available.');
    }

    const priority = this.priorityFromWire(payloadBytes);
    const decision = this.admit(payloadBytes.length, priority);
    const result = await this.inner.sendBinaryChannelPayload(
      channelIndex,
      payloadBytes,
    );
    this.commit(payloadBytes.length, priority, decision);
    return result;
  }

  private admit(
    payloadBytes: number,
    priority: BushMeshPriority | number,
  ): BushMeshAirtimeDecision {
    const decision = this.airtime.evaluate(payloadBytes, priority);
    if (!decision.allowed) {
      this.events.onDeferred?.(decision);
      throw new Error(
        `BushMesh airtime budget deferred ${payloadBytes} byte packet (${decision.estimatedAirtimeMs.toFixed(1)} ms estimated).`,
      );
    }
    return decision;
  }

  private commit(
    payloadBytes: number,
    priority: BushMeshPriority | number,
    _decision: BushMeshAirtimeDecision,
  ): void {
    const recorded = this.airtime.record(payloadBytes, priority);
    this.events.onAdmitted?.(recorded);
  }

  private priorityFromTextCarrier(message: string): number {
    try {
      return this.priorityFromWire(decodeBushMeshTextCarrier(message));
    } catch {
      return BushMeshPriority.Background;
    }
  }

  private priorityFromWire(bytes: number[]): number {
    try {
      return decodeBushMeshWire(bytes).envelope.priority;
    } catch {
      return BushMeshPriority.Background;
    }
  }
}
