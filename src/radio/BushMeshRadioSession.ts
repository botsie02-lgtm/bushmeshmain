import {BushMeshFormationShare} from '../bushmesh/formationProtocol';
import {BushMeshPositionRequest} from '../bushmesh/positionRequestProtocol';
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
import {LegacyBushMeshOutboundAdapter} from './LegacyBushMeshOutboundAdapter';
import type {OutboundDatagramEnvelope} from './OutboundDatagram';
import {
  BushMeshRadioProfile,
  cloneBushMeshRadioProfile,
} from './RadioProfile';

export type BushMeshRadioSessionSnapshot = {
  runtimeRequested: boolean;
  transportReady: boolean;
  identityRef: BushMeshIdentityRef | null;
  radioProfile: BushMeshRadioProfile | null;
  queuedCount: number;
  inflightCount: number;
  acceptedCount: number;
  failedCount: number;
  cancelledCount: number;
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

export type QueueFormationShareInput = Omit<
  BushMeshFormationShare,
  'senderId'
> & {
  channelIndex: number;
};

export type QueuePositionRequestInput = Omit<
  BushMeshPositionRequest,
  'senderId'
> & {
  channelIndex: number;
};

export type QueueOutboundDatagramInput = Omit<
  OutboundDatagramEnvelope,
  'identityRef'
> & {
  identityRef?: string | null;
};

export type BushMeshTransportOwner = object;

type SessionListener = () => void;

/**
 * Observable single-radio session for the React Native process.
 *
 * Transport ownership prevents an old/reconnecting client from clearing or
 * reclaiming a newer connection. Protocol runtimes may enqueue already-encoded
 * datagrams through queueOutboundDatagram; legacy packet helpers remain as a
 * compatibility facade until the canonical runtime replaces them.
 */
export class BushMeshRadioSession {
  private readonly controller: BushMeshTransmissionController;
  private readonly legacyOutbound: LegacyBushMeshOutboundAdapter;
  private readonly listeners = new Set<SessionListener>();
  private readonly compatibilityOwner: BushMeshTransportOwner = {};
  private transportOwner: BushMeshTransportOwner | null = null;
  private identityRef: BushMeshIdentityRef | null = null;
  private radioProfile: BushMeshRadioProfile | null = null;
  private lastAttempt: TransmissionAttemptResult | null = null;
  private drainPromise: Promise<TransmissionAttemptResult> | null = null;

  constructor(controller = new BushMeshTransmissionController()) {
    this.controller = controller;
    this.legacyOutbound = new LegacyBushMeshOutboundAdapter(controller);
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
      runtimeRequested: this.transportOwner !== null,
      transportReady: this.controller.isTransportReady(),
      identityRef: this.identityRef,
      radioProfile: cloneBushMeshRadioProfile(this.radioProfile),
      queuedCount: entries.filter(entry => entry.state === 'queued').length,
      inflightCount: entries.filter(entry => entry.state === 'inflight').length,
      acceptedCount: entries.filter(entry => entry.state === 'accepted').length,
      failedCount: entries.filter(entry => entry.state === 'failed').length,
      cancelledCount: entries.filter(entry => entry.state === 'cancelled').length,
      lastAttempt: this.lastAttempt,
    };
  }

  claimTransport(
    owner: BushMeshTransportOwner,
    sender: BushMeshDatagramSender,
  ): void {
    this.transportOwner = owner;
    this.identityRef = null;
    this.radioProfile = null;
    this.controller.setSender(sender);
    this.emit();
  }

  suspendTransportForOwner(owner: BushMeshTransportOwner): boolean {
    if (this.transportOwner !== owner) {
      return false;
    }

    this.identityRef = null;
    this.radioProfile = null;
    this.controller.setSender(null);
    this.emit();
    return true;
  }

  resumeTransportForOwner(
    owner: BushMeshTransportOwner,
    sender: BushMeshDatagramSender,
  ): boolean {
    if (this.transportOwner !== owner) {
      return false;
    }

    this.identityRef = null;
    this.radioProfile = null;
    this.controller.setSender(sender);
    this.emit();
    return true;
  }

  releaseTransport(owner: BushMeshTransportOwner): boolean {
    if (this.transportOwner !== owner) {
      return false;
    }

    this.transportOwner = null;
    this.identityRef = null;
    this.radioProfile = null;
    this.controller.setSender(null);
    this.emit();
    return true;
  }

  setIdentityForOwner(
    owner: BushMeshTransportOwner,
    identityRef: BushMeshIdentityRef,
  ): boolean {
    if (this.transportOwner !== owner) {
      return false;
    }

    this.controller.cancelQueuedForOtherIdentities(identityRef);
    this.identityRef = identityRef;
    this.emit();
    return true;
  }

  setRadioProfileForOwner(
    owner: BushMeshTransportOwner,
    profile: BushMeshRadioProfile,
  ): boolean {
    if (this.transportOwner !== owner) {
      return false;
    }

    this.radioProfile = cloneBushMeshRadioProfile(profile);
    this.emit();
    return true;
  }

  /** @deprecated New radio integrations should use claimTransport/releaseTransport. */
  setTransport(sender: BushMeshDatagramSender | null): void {
    if (sender) {
      this.claimTransport(this.compatibilityOwner, sender);
    } else {
      this.releaseTransport(this.compatibilityOwner);
    }
  }

  /** @deprecated New radio integrations should use owner-scoped identity updates. */
  setIdentity(identityRef: BushMeshIdentityRef | null): void {
    if (identityRef) {
      this.setIdentityForOwner(this.compatibilityOwner, identityRef);
      return;
    }

    if (this.transportOwner === this.compatibilityOwner) {
      this.identityRef = null;
      this.emit();
    }
  }

  queueOutboundDatagram(input: QueueOutboundDatagramInput): BushMeshOutboxEntry {
    const identityRef =
      input.identityRef === undefined ? this.requireIdentity() : input.identityRef;
    const entry = this.controller.enqueueOutbound({...input, identityRef});
    this.emit();
    return entry;
  }

  /** @deprecated Replace with canonical-runtime encoded outbound datagrams. */
  queueQuickAction(input: QueueQuickActionInput): BushMeshOutboxEntry {
    const senderId = this.requireIdentity();
    const entry = this.legacyOutbound.enqueueQuickAction(input.channelIndex, {
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

  /** @deprecated Replace with canonical-runtime encoded outbound datagrams. */
  queuePosition(input: QueuePositionInput): BushMeshOutboxEntry {
    const senderId = this.requireIdentity();
    const {channelIndex, ...position} = input;
    const entry = this.legacyOutbound.enqueuePosition(channelIndex, {
      ...position,
      senderId,
    });
    this.emit();
    return entry;
  }

  /** @deprecated Replace with canonical-runtime encoded outbound datagrams. */
  queueFormationShare(input: QueueFormationShareInput): BushMeshOutboxEntry {
    const senderId = this.requireIdentity();
    const {channelIndex, ...share} = input;
    const entry = this.legacyOutbound.enqueueFormationShare(channelIndex, {
      ...share,
      senderId,
    });
    this.emit();
    return entry;
  }

  /** @deprecated Replace with canonical-runtime encoded outbound datagrams. */
  queuePositionRequest(input: QueuePositionRequestInput): BushMeshOutboxEntry {
    const senderId = this.requireIdentity();
    const {channelIndex, ...request} = input;
    const entry = this.legacyOutbound.enqueuePositionRequest(channelIndex, {
      ...request,
      senderId,
    });
    this.emit();
    return entry;
  }

  restoreOutbox(entries: BushMeshOutboxEntry[]): void {
    this.controller.restoreEntries(entries);
    this.lastAttempt = null;
    this.emit();
  }

  drainOnce(nowMs = Date.now()): Promise<TransmissionAttemptResult> {
    if (!this.identityRef) {
      return Promise.resolve({entry: null, outcome: 'idle'});
    }

    if (this.drainPromise) {
      return this.drainPromise;
    }

    this.drainPromise = this.controller
      .drainOnce(nowMs)
      .then(result => {
        this.lastAttempt = result;
        this.emit();
        return result;
      })
      .finally(() => {
        this.drainPromise = null;
      });

    return this.drainPromise;
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
