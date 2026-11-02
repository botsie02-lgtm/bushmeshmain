import {
  BushMeshDatagramRuntime,
  type BushMeshDatagramRuntimeOptions,
  type BushMeshInboundResult,
  type BushMeshOutboundDatagram,
  type BushMeshOutboundPreparationOptions,
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
import {androidBushMeshRuntimePersistence} from './RadioCoreBushMeshRuntimePersistence';
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
};

type RuntimeSnapshotListener = (snapshot: BushMeshV1RuntimeSnapshot) => void;
type InboundResultListener = (result: BushMeshInboundResult) => void;
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
  private state: BushMeshV1RuntimeState = 'stopped';
  private lastError: string | null = null;
  private lastInbound: BushMeshInboundResult | null = null;
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
    };
  }

  subscribe(listener: RuntimeSnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  subscribeInboundResults(listener: InboundResultListener): () => void {
    this.inboundListeners.add(listener);
    return () => {
      this.inboundListeners.delete(listener);
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
    this.unsubscribeInbound?.();
    this.unsubscribeInbound = null;
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
      this.inboundListeners.forEach(listener => listener(result));
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
    runtime: new BushMeshDatagramRuntime(options),
  });
}

export const bushMeshV1RuntimeService = createBushMeshV1RuntimeService({
  persistence: androidBushMeshRuntimePersistence,
  transportAvailability: bushMeshTransportAvailability,
});
