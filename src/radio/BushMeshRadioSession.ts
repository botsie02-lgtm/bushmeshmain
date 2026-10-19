import {
  BushMeshPosition,
  BushMeshQuickActionCode,
  BushMeshIdentityRef,
} from '../bushmesh/protocol';
import {BushMeshOutboxEntry} from '../bushmesh/outbox';
import {
  BushMeshDatagramSender,
  BushMeshTransmissionController,
  TransmissionAttemptResult,
} from './BushMeshTransmissionController';

export type BushMeshRadioSessionSnapshot = {
  transportReady: boolean;
  identityRef: BushMeshIdentityRef | null;
  queuedCount: number;
  inflightCount: number;
  acceptedCount: number;
  failedCount: number;
  lastAttempt: TransmissionAttemptResult | null;
};

export type QueueQuickActionInput = {
  channelIndex: number;
  sequence: number;
  timestampSeconds: number;
  action: BushMeshQuickActionCode;
  latitude?: number | null;
  longitude?: number | null;
  ttlSeconds?: number;
  flags?: number;
};

export type QueuePositionInput = Omit<BushMeshPosition, 'senderId'> & {
  channelIndex: number;
};

type SessionListener = () => void;

/**
 * Observable single-radio session for the React Native process.
 *
 * The active MeshCore transport will register here. UI/domain code can then
 * queue Bushmesh traffic without importing BLE or MeshCore classes. When the
 * future native foreground service lands, it can implement the same surface.
 */
export class BushMeshRadioSession {
  private readonly controller: BushMeshTransmissionController;
  private readonly listeners = new Set<SessionListener>();
  private identityRef: BushMeshIdentityRef | null = null;
  private lastAttempt: TransmissionAttemptResult | null = null;

  constructor(controller = new BushMeshTransmissionController()) {
    this.controller = controller;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): BushMeshRadioSessionSnapshot {
    const entries = this.controller.list();
    return {
      transportReady: this.controller.isTransportReady(),
      identityRef: this.identityRef,
      queuedCount: entries.filter(entry => entry.state === 'queued').length,
      inflightCount: entries.filter(entry => entry.state === 'inflight').length,
      acceptedCount: entries.filter(entry => entry.state === 'accepted').length,
      failedCount: entries.filter(entry => entry.state === 'failed').length,
      lastAttempt: this.lastAttempt,
    };
  }

  setTransport(sender: BushMeshDatagramSender | null): void {
    this.controller.setSender(sender);
    this.emit();
  }

  setIdentity(identityRef: BushMeshIdentityRef | null): void {
    this.identityRef = identityRef;
    this.emit();
  }

  queueQuickAction(input: QueueQuickActionInput): BushMeshOutboxEntry {
    const senderId = this.requireIdentity();
    const entry = this.controller.enqueueQuickAction(input.channelIndex, {
      senderId,
      sequence: input.sequence,
      timestampSeconds: input.timestampSeconds,
      action: input.action,
      latitude: input.latitude,
      longitude: input.longitude,
      ttlSeconds: input.ttlSeconds,
      flags: input.flags,
    });
    this.emit();
    return entry;
  }

  queuePosition(input: QueuePositionInput): BushMeshOutboxEntry {
    const senderId = this.requireIdentity();
    const {channelIndex, ...position} = input;
    const entry = this.controller.enqueuePosition(channelIndex, {
      ...position,
      senderId,
    });
    this.emit();
    return entry;
  }

  async drainOnce(nowMs = Date.now()): Promise<TransmissionAttemptResult> {
    this.lastAttempt = await this.controller.drainOnce(nowMs);
    this.emit();
    return this.lastAttempt;
  }

  listOutbox(): BushMeshOutboxEntry[] {
    return this.controller.list();
  }

  private requireIdentity(): BushMeshIdentityRef {
    if (!this.identityRef) {
      throw new Error(
        'Bushmesh radio identity is unavailable. Connect and identify a radio first.',
      );
    }
    return this.identityRef;
  }

  private emit(): void {
    this.listeners.forEach(listener => listener());
  }
}

export const bushMeshRadioSession = new BushMeshRadioSession();
