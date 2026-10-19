import {
  BUSHMESH_MESHCORE_DEV_DATA_TYPE,
  BushMeshPosition,
  BushMeshQuickAction,
  BushMeshQuickActionCode,
  encodeBushMeshPosition,
  encodeBushMeshQuickAction,
} from '../bushmesh/protocol';
import {
  BushMeshOutboxEntry,
  BushMeshOutboxPriority,
  InMemoryBushMeshOutbox,
} from '../bushmesh/outbox';
import {getQuickActionDefinition} from '../drive/quickActions';

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
 * Coordinates Bushmesh application traffic independently of the underlying
 * radio implementation. A successful sender call means the radio/adapter
 * accepted the packet; it does not imply another vehicle received it.
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

  enqueuePosition(
    channelIndex: number,
    position: BushMeshPosition,
    createdAtMs = Date.now(),
  ): BushMeshOutboxEntry {
    return this.enqueue(
      channelIndex,
      encodeBushMeshPosition(position),
      'position',
      `Position ${position.sequence} from ${position.senderId}`,
      position.senderId,
      createdAtMs,
      3,
    );
  }

  enqueueQuickAction(
    channelIndex: number,
    action: BushMeshQuickAction,
    createdAtMs = Date.now(),
  ): BushMeshOutboxEntry {
    const definition = getQuickActionDefinition(action.action);
    const priority: BushMeshOutboxPriority =
      definition.priority === 'safety'
        ? 'safety'
        : definition.priority === 'control'
          ? 'control'
          : 'message';

    return this.enqueue(
      channelIndex,
      encodeBushMeshQuickAction(action),
      priority,
      `${definition.label} from ${action.senderId}`,
      action.senderId,
      createdAtMs,
      action.action === BushMeshQuickActionCode.Ok ? 3 : 5,
    );
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
        outcome: updated.state === 'failed' ? 'failed' : 'retrying',
      };
    }
  }

  private enqueue(
    channelIndex: number,
    payload: Uint8Array,
    priority: BushMeshOutboxPriority,
    description: string,
    identityRef: string | null,
    createdAtMs: number,
    maxAttempts: number,
  ): BushMeshOutboxEntry {
    if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 7) {
      throw new Error('Bushmesh channel index must be between 0 and 7.');
    }

    return this.outbox.enqueue({
      channelIndex,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload,
      priority,
      description,
      identityRef,
      createdAtMs,
      maxAttempts,
    });
  }
}
