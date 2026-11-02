import {
  BushMeshOutboxEntry,
  InMemoryBushMeshOutbox,
} from '../bushmesh/outbox';
import type {OutboundDatagramEnvelope} from './OutboundDatagram';

export type BushMeshDatagramSender = (
  channelIndex: number,
  dataType: number,
  payload: Uint8Array,
) => Promise<void>;

export type TransmissionAttemptResult = {
  entry: BushMeshOutboxEntry | null;
  outcome: 'idle' | 'accepted' | 'retrying' | 'failed';
};

/**
 * Coordinates already-encoded outbound traffic independently of the
 * application protocol/runtime and the underlying radio implementation.
 *
 * A successful sender call means the radio/adapter accepted the datagram; it
 * does not imply another vehicle received it.
 */
export class BushMeshTransmissionController {
  private readonly outbox: InMemoryBushMeshOutbox;
  private sender: BushMeshDatagramSender | null = null;

  constructor(outbox = new InMemoryBushMeshOutbox()) {
    this.outbox = outbox;
  }

  setSender(sender: BushMeshDatagramSender | null): void {
    this.sender = sender;
  }

  isTransportReady(): boolean {
    return this.sender !== null;
  }

  restoreEntries(entries: BushMeshOutboxEntry[]): void {
    this.outbox.replaceEntries(entries);
  }

  enqueueOutbound(envelope: OutboundDatagramEnvelope): BushMeshOutboxEntry {
    const createdAtMs = envelope.createdAtMs ?? Date.now();
    if (
      !Number.isInteger(envelope.channelIndex) ||
      envelope.channelIndex < 0 ||
      envelope.channelIndex > 7
    ) {
      throw new Error('Bushmesh channel index must be between 0 and 7.');
    }
    if (
      !Number.isInteger(envelope.dataType) ||
      envelope.dataType < 1 ||
      envelope.dataType > 0xffff
    ) {
      throw new Error('Outbound datagram data type must be between 1 and 65535.');
    }
    if (!(envelope.payload instanceof Uint8Array)) {
      throw new Error('Outbound datagram payload must be a Uint8Array.');
    }

    return this.outbox.enqueue({
      channelIndex: envelope.channelIndex,
      dataType: envelope.dataType,
      payload: envelope.payload,
      priority: envelope.priority,
      description: envelope.description,
      identityRef: envelope.identityRef,
      expiresAtMs: envelope.expiresAtMs,
      createdAtMs,
      maxAttempts: envelope.retryPolicy.maxAttempts,
    });
  }

  cancelQueued(
    predicate: (entry: BushMeshOutboxEntry) => boolean,
  ): BushMeshOutboxEntry[] {
    const cancelled: BushMeshOutboxEntry[] = [];
    for (const entry of this.outbox.list()) {
      if (entry.state === 'queued' && predicate(entry)) {
        cancelled.push(this.outbox.cancel(entry.id));
      }
    }
    return cancelled;
  }

  list(): BushMeshOutboxEntry[] {
    return this.outbox.list();
  }

  cancelQueuedForOtherIdentities(identityRef: string): BushMeshOutboxEntry[] {
    return this.outbox.cancelQueuedForOtherIdentities(identityRef);
  }

  async drainOnce(nowMs = Date.now()): Promise<TransmissionAttemptResult> {
    const next = this.outbox.nextReady(nowMs);
    if (!next) {
      return {entry: null, outcome: 'idle'};
    }

    if (!this.sender) {
      return {entry: next, outcome: 'retrying'};
    }

    this.outbox.markAttempt(next.id, nowMs);

    try {
      await this.sender(next.channelIndex, next.dataType, next.payload);
      const accepted = this.outbox.markAccepted(next.id, nowMs);
      return {entry: accepted, outcome: 'accepted'};
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown radio transport error.';
      const updated = this.outbox.markFailed(next.id, message, nowMs);
      return {
        entry: updated,
        outcome:
          updated.state === 'failed' || updated.state === 'cancelled'
            ? 'failed'
            : 'retrying',
      };
    }
  }
}
