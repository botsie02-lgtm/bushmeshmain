import {BushMeshPacketType, encodeBushMeshTextWire} from '../bushmesh/protocol/public';
import {
  BushMeshDatagramRuntime,
  type BushMeshDatagramRuntimeOptions,
  type BushMeshInboundProtocolAccepted,
  type BushMeshInboundResult,
  type BushMeshOutboundDatagram,
  type BushMeshOutboundPreparationOptions,
  type BushMeshSecurityAssociation,
} from '../bushmesh/runtime/public';
import {
  BushMeshRadioSession,
  bushMeshRadioSession,
} from '../radio/BushMeshRadioSession';
import {
  type ReceivedDatagram,
  subscribeReceivedDatagrams,
} from '../radio/ReceivedDatagram';
import {
  bushMeshOutboundToRadioEnvelope,
  receivedDatagramToBushMeshInbound,
} from './BushMeshRadioCoreAdapter';
import {
  applicationBushMeshSecurityV1Adapter,
  bushMeshSecurityFailureCodeFromRuntimeError,
  type BushMeshSecurityIntegrationFailureCode,
} from './BushMeshSecurityV1Adapter';
import {androidBushMeshRuntimePersistence} from './RadioCoreBushMeshRuntimePersistence';
import {radioCoreBushMeshRuntimeClock} from './RadioCoreBushMeshRuntimeClock';
import {bushMeshTransportAvailability} from './RadioCoreBushMeshTransportAvailability';

export type BushMeshV1RuntimeState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'error';

export type BushMeshV1RuntimeSnapshot = {
  state: BushMeshV1RuntimeState;
  lastError: string | null;
  lastInbound: BushMeshInboundResult | null;
  lastSecurityFailure: BushMeshSecurityIntegrationFailureCode | null;
};

export type BushMeshDirectMessageProtection = {
  sessionId: string;
  peerDeviceId?: string;
  sourceNodeId: number;
  destinationNodeId: number;
};

export type BushMeshDirectMessageIntent = {
  text: string;
  messageId: number;
  channelIndex: number;
  dataType: number;
  transport: string;
  expiresAtMs?: number | null;
  label?: string;
  protection?: BushMeshDirectMessageProtection;
};

export type BushMeshDirectMessageEvent = {
  kind: 'direct-message';
  text: string;
  messageId: number;
  channelIndex: number;
  receivedAtMs: number;
  protected: boolean;
  securityAssociation: BushMeshSecurityAssociation;
  sourceNodeId?: number;
  destinationNodeId?: number;
};

type RuntimeSnapshotListener = (snapshot: BushMeshV1RuntimeSnapshot) => void;
type InboundResultListener = (result: BushMeshInboundResult) => void;
type DirectMessageListener = (event: BushMeshDirectMessageEvent) => void;
type RadioSessionPort = Pick<
  BushMeshRadioSession,
  'getSnapshot' | 'queueOutboundDatagram'
>;
type InboundSubscription = (
  listener: (datagram: ReceivedDatagram) => void,
) => () => void;

export type BushMeshV1RuntimeServiceDependencies = {
  runtime?: BushMeshDatagramRuntime;
  radioSession?: RadioSessionPort;
  subscribeInbound?: InboundSubscription;
};

/**
 * Application-lifetime owner for the canonical BushMesh v1 datagram runtime.
 * Screens do not own this object. Radio-core remains the queue/carrier owner;
 * the canonical runtime remains the sole owner of BushMesh decoding/security.
 */
export class BushMeshV1RuntimeService {
  private readonly runtime: BushMeshDatagramRuntime;
  private readonly radioSession: RadioSessionPort;
  private readonly subscribeInbound: InboundSubscription;
  private readonly snapshotListeners = new Set<RuntimeSnapshotListener>();
  private readonly inboundListeners = new Set<InboundResultListener>();
  private readonly directMessageListeners = new Set<DirectMessageListener>();
  private state: BushMeshV1RuntimeState = 'stopped';
  private lastError: string | null = null;
  private lastInbound: BushMeshInboundResult | null = null;
  private lastSecurityFailure: BushMeshSecurityIntegrationFailureCode | null = null;
  private unsubscribeInbound: (() => void) | null = null;
  private startPromise: Promise<void> | null = null;
  private inboundChain: Promise<void> = Promise.resolve();

  constructor(dependencies: BushMeshV1RuntimeServiceDependencies = {}) {
    this.runtime = dependencies.runtime ?? new BushMeshDatagramRuntime();
    this.radioSession = dependencies.radioSession ?? bushMeshRadioSession;
    this.subscribeInbound =
      dependencies.subscribeInbound ?? subscribeReceivedDatagrams;
  }

  getSnapshot(): BushMeshV1RuntimeSnapshot {
    return {
      state: this.state,
      lastError: this.lastError,
      lastInbound: this.lastInbound,
      lastSecurityFailure: this.lastSecurityFailure,
    };
  }

  subscribe(listener: RuntimeSnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  /** Diagnostic/result stream. It intentionally includes fragment-pending. */
  subscribeInboundResults(listener: InboundResultListener): () => void {
    this.inboundListeners.add(listener);
    return () => {
      this.inboundListeners.delete(listener);
    };
  }

  /** Application delivery stream. Intermediate fragments are never emitted. */
  subscribeDirectMessageEvents(listener: DirectMessageListener): () => void {
    this.directMessageListeners.add(listener);
    return () => {
      this.directMessageListeners.delete(listener);
    };
  }

  start(): Promise<void> {
    if (this.state === 'ready') {
      return Promise.resolve();
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.state = 'starting';
    this.lastError = null;
    this.emitSnapshot();

    this.startPromise = this.runtime
      .initialize()
      .then(() => {
        if (!this.unsubscribeInbound) {
          this.unsubscribeInbound = this.subscribeInbound(datagram => {
            void this.acceptInbound(datagram).catch(() => undefined);
          });
        }
        this.state = 'ready';
        this.emitSnapshot();
      })
      .catch(error => {
        this.state = 'error';
        this.lastError = this.errorMessage(error);
        this.emitSnapshot();
        throw error;
      })
      .finally(() => {
        this.startPromise = null;
      });

    return this.startPromise;
  }

  async dispose(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }
    const unsubscribeInbound = this.unsubscribeInbound;
    this.unsubscribeInbound = null;
    unsubscribeInbound?.();
    await this.inboundChain.catch(() => undefined);
    await this.runtime.flush();
    this.state = 'stopped';
    this.emitSnapshot();
  }

  acceptInbound(datagram: ReceivedDatagram): Promise<BushMeshInboundResult> {
    const task = this.inboundChain.then(async () => {
      const result = await this.runtime.acceptInbound(
        receivedDatagramToBushMeshInbound(datagram),
      );
      this.lastInbound = result;
      this.lastError = null;
      this.lastSecurityFailure =
        result.status === 'rejected' && result.reason === 'security-failed'
          ? bushMeshSecurityFailureCodeFromRuntimeError(result.error)
          : null;
      this.inboundListeners.forEach(listener => listener(result));
      this.emitDirectMessageEvent(result);
      this.emitSnapshot();
      return result;
    });

    this.inboundChain = task.then(
      () => undefined,
      error => {
        this.lastError = this.errorMessage(error);
        this.emitSnapshot();
      },
    );
    return task;
  }

  async sendDirectMessage(intent: BushMeshDirectMessageIntent) {
    if (!intent.text.trim()) {
      throw new Error('Canonical BushMesh direct message text cannot be empty.');
    }
    const encoded = encodeBushMeshTextWire(intent.text, intent.messageId, {
      ackRequested: true,
    });
    const protection = intent.protection;
    return this.prepareAndQueue(encoded.wireBytes, {
      channelIndex: intent.channelIndex,
      dataType: intent.dataType,
      transport: intent.transport,
      expiresAtMs: intent.expiresAtMs,
      label: intent.label ?? `BushMesh direct message ${intent.messageId}`,
      ...(protection
        ? {
            trafficClass: 'direct-message' as const,
            identityAssociation: {
              kind: 'direct-session' as const,
              sessionId: protection.sessionId,
              peerDeviceId: protection.peerDeviceId,
            },
            securityRouting: {
              sourceNodeId: protection.sourceNodeId,
              destinationNodeId: protection.destinationNodeId,
            },
          }
        : {}),
    });
  }

  async prepareAndQueue(
    wireBytes: number[] | Uint8Array,
    options: BushMeshOutboundPreparationOptions,
  ): Promise<ReturnType<RadioSessionPort['queueOutboundDatagram']>> {
    const datagram = await this.runtime.prepareOutbound(wireBytes, options);
    return this.queuePreparedOutbound(datagram);
  }

  queuePreparedOutbound(
    datagram: BushMeshOutboundDatagram,
  ): ReturnType<RadioSessionPort['queueOutboundDatagram']> {
    const radioIdentityRef = this.radioSession.getSnapshot().identityRef;
    return this.radioSession.queueOutboundDatagram(
      bushMeshOutboundToRadioEnvelope(datagram, radioIdentityRef),
    );
  }

  private emitDirectMessageEvent(result: BushMeshInboundResult): void {
    if (!this.isDeliveredDirectMessage(result)) {
      return;
    }
    const text = result.decoded.renderedText;
    if (text === undefined) {
      return;
    }
    const event: BushMeshDirectMessageEvent = {
      kind: 'direct-message',
      text,
      messageId: result.decoded.envelope.messageId,
      channelIndex: result.datagram.channelIndex,
      receivedAtMs: result.datagram.receivedAtMs,
      protected: result.protected,
      securityAssociation: result.securityAssociation,
      sourceNodeId: result.securityRouting?.sourceNodeId,
      destinationNodeId: result.securityRouting?.destinationNodeId,
    };
    this.directMessageListeners.forEach(listener => listener(event));
  }

  private isDeliveredDirectMessage(
    result: BushMeshInboundResult,
  ): result is BushMeshInboundProtocolAccepted {
    return (
      result.status === 'accepted' &&
      result.kind === 'protocol' &&
      result.decoded.envelope.type === BushMeshPacketType.Message
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot();
    this.snapshotListeners.forEach(listener => listener(snapshot));
  }
}

export function createBushMeshV1RuntimeService(
  options: BushMeshDatagramRuntimeOptions = {},
): BushMeshV1RuntimeService {
  return new BushMeshV1RuntimeService({
    runtime: new BushMeshDatagramRuntime({
      clock: radioCoreBushMeshRuntimeClock,
      persistence: androidBushMeshRuntimePersistence,
      transportAvailability: bushMeshTransportAvailability,
      security: applicationBushMeshSecurityV1Adapter,
      ...options,
    }),
  });
}

export const bushMeshV1RuntimeService = createBushMeshV1RuntimeService();
