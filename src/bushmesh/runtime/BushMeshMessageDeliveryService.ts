import {
  BushMeshPriority,
  decodeBushMeshTypedPacket,
  decodeBushMeshWire,
  encodeBushMeshRoutedWire,
  encodeBushMeshTextMessage,
  encodeTextForBushMeshPeer,
} from '../protocol';
import {BushMeshNodeRuntime} from './BushMeshNodeRuntime';
import {BushMeshOutboundPlanner} from './BushMeshOutboundPlanner';
import {BushMeshRouteDecisionEngine} from './BushMeshRouteDecisionEngine';
import {
  BushMeshReliableSendResult,
  BushMeshReliableSender,
} from './BushMeshReliableSender';
import {
  BushMeshStoreForwardFlushResult,
  BushMeshStoreForwardItem,
  BushMeshStoreForwardRuntime,
  BushMeshStoreForwardStore,
} from './BushMeshStoreForwardRuntime';

export type BushMeshMessageDeliveryResult = {
  state: 'sent' | 'queued';
  messageId: number;
  innerMessageId: number;
  frameCount: number | null;
  queueId: string | null;
};

export type BushMeshMessageDeliverySnapshot = {
  running: boolean;
  queuedMessages: number;
};

export type BushMeshMessageDeliveryFlushEvent = {
  sentMessageIds: number[];
  failedMessageIds: number[];
  expiredMessageIds: number[];
  deferredMessageIds: number[];
  raw: BushMeshStoreForwardFlushResult;
};

export type BushMeshMessageDeliveryEvents = {
  onQueued?: (queueId: string, messageId: number) => void;
  onFlush?: (event: BushMeshMessageDeliveryFlushEvent) => void;
};

export class BushMeshMessageDeliveryService {
  readonly storeForward: BushMeshStoreForwardRuntime;
  readonly sender: BushMeshReliableSender;

  private running = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly queueMessageIds = new Map<string, number>();

  constructor(
    readonly node: BushMeshNodeRuntime,
    store?: BushMeshStoreForwardStore,
    private readonly events: BushMeshMessageDeliveryEvents = {},
  ) {
    this.storeForward = new BushMeshStoreForwardRuntime(
      node.network,
      store,
      'bushmesh.messageDelivery.v1',
    );
    this.sender = new BushMeshReliableSender(node.network, this.storeForward);
  }

  async start(options?: {
    now?: number;
    flushIntervalMs?: number;
  }): Promise<number> {
    if (this.running) {
      return this.storeForward.size();
    }

    const restored = await this.storeForward.initialize(options?.now);
    this.rebuildQueueIndex();
    this.startAutoFlush(options?.flushIntervalMs ?? 5000);
    this.running = true;
    return restored;
  }

  stop(): void {
    this.running = false;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.sender.stop();
  }

  isRunning(): boolean {
    return this.running;
  }

  snapshot(): BushMeshMessageDeliverySnapshot {
    return {
      running: this.running,
      queuedMessages: this.storeForward.size(),
    };
  }

  async flush(): Promise<BushMeshStoreForwardFlushResult> {
    const queueMap = new Map(this.queueMessageIds);
    const result = await this.sender.flush({
      canSend: item => this.canFlushItem(item),
    });
    const event: BushMeshMessageDeliveryFlushEvent = {
      sentMessageIds: result.sentIds
        .map(id => queueMap.get(id))
        .filter((id): id is number => id !== undefined),
      failedMessageIds: result.failedIds
        .map(id => queueMap.get(id))
        .filter((id): id is number => id !== undefined),
      expiredMessageIds: result.expiredIds
        .map(id => queueMap.get(id))
        .filter((id): id is number => id !== undefined),
      deferredMessageIds: (result.deferredIds ?? [])
        .map(id => queueMap.get(id))
        .filter((id): id is number => id !== undefined),
      raw: result,
    };

    for (const id of [...result.sentIds, ...result.expiredIds]) {
      this.queueMessageIds.delete(id);
    }

    if (
      event.sentMessageIds.length > 0 ||
      event.failedMessageIds.length > 0 ||
      event.expiredMessageIds.length > 0 ||
      event.deferredMessageIds.length > 0
    ) {
      this.events.onFlush?.(event);
    }

    return result;
  }

  async sendRoutedText(
    channelIndex: number,
    text: string,
    destinationNodeId?: number,
    options?: {
      ttlHops?: number;
      priority?: BushMeshPriority;
      queueTtlMs?: number;
      maxQueueAttempts?: number;
    },
  ): Promise<BushMeshMessageDeliveryResult> {
    const cleanText = text.trim();
    if (!cleanText) {
      throw new Error('BushMesh message is empty.');
    }

    const local = this.node.localHello();
    if (!local) {
      throw new Error('BushMesh local node identity is not ready.');
    }
    if (destinationNodeId === local.nodeId) {
      throw new Error('BushMesh destination cannot be the local node.');
    }

    const priority = options?.priority ?? BushMeshPriority.DirectMessage;
    const innerMessageId = this.node.network.nextMessageId();
    const peerPolicy =
      destinationNodeId === undefined
        ? undefined
        : this.node.peers()?.peerPolicy(destinationNodeId) ?? undefined;

    const innerWireBytes =
      peerPolicy?.compatible === true
        ? encodeTextForBushMeshPeer(cleanText, innerMessageId, peerPolicy, {
            priority,
            ackRequested: false,
            storeAndForward: false,
          }).wireBytes
        : encodeBushMeshTextMessage(cleanText, innerMessageId, {
            priority,
            ackRequested: false,
            storeAndForward: false,
            semantic: true,
          }).wireBytes;

    const messageId = this.node.network.nextMessageId();
    const routedWireBytes = encodeBushMeshRoutedWire(
      {
        sourceNodeId: local.nodeId,
        destinationNodeId,
        innerWireBytes,
      },
      messageId,
      {
        ttlHops: options?.ttlHops ?? 4,
        priority,
      },
    );

    let delivery: BushMeshReliableSendResult;
    const peers = this.node.peers();

    if (peers) {
      const planner = new BushMeshOutboundPlanner(
        new BushMeshRouteDecisionEngine(peers),
      );
      const plan = planner.plan({
        kind: 'text',
        payloadBytes: routedWireBytes.length,
        peerPolicy,
        destinationNodeId,
        priority,
        ttlHops: options?.ttlHops ?? 4,
        storeAndForward: true,
      });

      if (!plan.payload.supported) {
        throw new Error(plan.payload.reason);
      }

      delivery = plan.shouldQueue
        ? await this.sender.queueWire(channelIndex, routedWireBytes, {
            queueTtlMs: options?.queueTtlMs,
            maxQueueAttempts: options?.maxQueueAttempts,
          })
        : await this.sender.sendWireOrQueue(channelIndex, routedWireBytes, {
            queueTtlMs: options?.queueTtlMs,
            maxQueueAttempts: options?.maxQueueAttempts,
          });
    } else {
      delivery = await this.sender.sendWireOrQueue(
        channelIndex,
        routedWireBytes,
        {
          queueTtlMs: options?.queueTtlMs,
          maxQueueAttempts: options?.maxQueueAttempts,
        },
      );
    }

    if (delivery.state === 'queued') {
      this.queueMessageIds.set(delivery.queuedId, messageId);
      this.events.onQueued?.(delivery.queuedId, messageId);
    }

    return this.toResult(delivery, messageId, innerMessageId);
  }

  private canFlushItem(item: BushMeshStoreForwardItem): boolean {
    try {
      const typed = decodeBushMeshTypedPacket(item.wireBytes);
      if (typed.kind !== 'routed') {
        return true;
      }

      const destinationNodeId = typed.value.destinationNodeId;
      if (destinationNodeId === undefined) {
        return true;
      }

      if (typed.wire.envelope.priority === BushMeshPriority.Emergency) {
        return true;
      }

      const peers = this.node.peers();
      return Boolean(peers?.bestRoute(destinationNodeId));
    } catch {
      // Let the network/runtime decoder reject malformed queued data; do not
      // permanently wedge the queue because a preflight inspection failed.
      return true;
    }
  }

  private startAutoFlush(intervalMs: number): void {
    if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
      throw new Error('Delivery flush interval must be at least one second.');
    }

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (!this.node.network.isRunning()) {
        return;
      }
      void this.flush();
    }, intervalMs);
  }

  private rebuildQueueIndex(): void {
    this.queueMessageIds.clear();

    for (const item of this.storeForward.snapshot()) {
      try {
        const decoded = decodeBushMeshWire(item.wireBytes);
        this.queueMessageIds.set(item.id, decoded.envelope.messageId);
      } catch {
        // The store-forward runtime already validates restored packets. Ignore a
        // mapping failure rather than making the whole delivery service unusable.
      }
    }
  }

  private toResult(
    delivery: BushMeshReliableSendResult,
    messageId: number,
    innerMessageId: number,
  ): BushMeshMessageDeliveryResult {
    if (delivery.state === 'queued') {
      return {
        state: 'queued',
        messageId,
        innerMessageId,
        frameCount: null,
        queueId: delivery.queuedId,
      };
    }

    return {
      state: 'sent',
      messageId,
      innerMessageId,
      frameCount: delivery.result.frameCount,
      queueId: null,
    };
  }
}
