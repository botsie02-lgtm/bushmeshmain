import {
  BushMeshPriority,
  encodeBushMeshRoutedWire,
  encodeBushMeshTextMessage,
  encodeTextForBushMeshPeer,
} from '../protocol';
import {BushMeshNodeRuntime} from './BushMeshNodeRuntime';
import {
  BushMeshReliableSendResult,
  BushMeshReliableSender,
} from './BushMeshReliableSender';
import {
  BushMeshStoreForwardFlushResult,
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

export class BushMeshMessageDeliveryService {
  readonly storeForward: BushMeshStoreForwardRuntime;
  readonly sender: BushMeshReliableSender;

  private running = false;

  constructor(
    readonly node: BushMeshNodeRuntime,
    store?: BushMeshStoreForwardStore,
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
    this.sender.startAutoFlush(options?.flushIntervalMs ?? 5000);
    this.running = true;
    return restored;
  }

  stop(): void {
    this.running = false;
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
    return this.sender.flush();
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

    const delivery = await this.sender.sendWireOrQueue(
      channelIndex,
      routedWireBytes,
      {
        queueTtlMs: options?.queueTtlMs,
        maxQueueAttempts: options?.maxQueueAttempts,
      },
    );

    return this.toResult(delivery, messageId, innerMessageId);
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
