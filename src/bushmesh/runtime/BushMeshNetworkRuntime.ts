import {
  BushMeshCarrierMode,
  BushMeshCompressionProfile,
  BushMeshInboundTransportFrame,
  BushMeshMessageIdGenerator,
  BushMeshPacketType,
  BushMeshPeerPolicy,
  BushMeshPreparedTransportFrame,
  BushMeshPriority,
  BushMeshReliabilityController,
  BushMeshTypedPacket,
  DecodedBushMeshWireMessage,
  decodeBushMeshInboundTransportFrame,
  decodeBushMeshTypedPacket,
  decodeBushMeshWire,
  encodeBushMeshTextCarrier,
  prepareBushMeshPeerTextFrames,
  prepareBushMeshTextFrames,
  prepareBushMeshWireFrames,
} from '../protocol';
import {BushMeshFragmentCheckpointRuntime} from './BushMeshFragmentCheckpointRuntime';
import {getBushMeshPersistentStore} from './BushMeshPersistentStore';
import {
  BushMeshTransportQueue,
  BushMeshTransportQueueSnapshot,
} from './BushMeshTransportQueue';

const LEGACY_DEFAULT_MAX_PAYLOAD_BYTES = 133;

export type BushMeshRuntimeTransport = {
  /**
   * Maximum payload accepted by the hardware/link adapter. New adapters should
   * always provide this explicitly. The legacy fallback remains only so the
   * current MeshCore application keeps its existing behaviour during migration.
   */
  maxPayloadBytes?: number;
  sendTextChannelMessage: (
    channelIndex: number,
    message: string,
  ) => Promise<unknown>;
  sendBinaryChannelPayload?: (
    channelIndex: number,
    payloadBytes: number[],
  ) => Promise<unknown>;
};

export type BushMeshRuntimeReceivedMessage = {
  channelIndex: number;
  decoded: DecodedBushMeshWireMessage;
  typed: BushMeshTypedPacket;
};

export type BushMeshRuntimeSendResult = {
  messageId: number;
  frameCount: number;
  fragmented: boolean;
  transport: BushMeshCarrierMode;
};

export type BushMeshRuntimeStats = {
  sentMessages: number;
  sentFrames: number;
  receivedFrames: number;
  receivedMessages: number;
  ackFramesSent: number;
  ackFramesReceived: number;
  retransmittedFrames: number;
  ignoredFrames: number;
  decodeErrors: number;
};

export type BushMeshNetworkRuntimeEvents = {
  onStatus?: (message: string) => void;
  onError?: (message: string) => void;
  onMessage?: (message: BushMeshRuntimeReceivedMessage) => void;
  onAck?: (messageId: number, missingFragments: number[]) => void;
  onStats?: (stats: BushMeshRuntimeStats) => void;
};

type OutboundFragmentedMessage = {
  channelIndex: number;
  transport: BushMeshCarrierMode;
};

export class BushMeshNetworkRuntime {
  private readonly messageIds: BushMeshMessageIdGenerator;
  private readonly reliability: BushMeshReliabilityController;
  private readonly fragmentRecovery: BushMeshFragmentCheckpointRuntime;
  private readonly transportQueue = new BushMeshTransportQueue();
  private readonly outboundFragmented = new Map<
    number,
    OutboundFragmentedMessage
  >();
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private retryFlushInProgress = false;
  private running = false;
  private statsState: BushMeshRuntimeStats = {
    sentMessages: 0,
    sentFrames: 0,
    receivedFrames: 0,
    receivedMessages: 0,
    ackFramesSent: 0,
    ackFramesReceived: 0,
    retransmittedFrames: 0,
    ignoredFrames: 0,
    decodeErrors: 0,
  };

  constructor(
    private readonly transport: BushMeshRuntimeTransport,
    private readonly events: BushMeshNetworkRuntimeEvents = {},
    options?: {
      messageIdSeed?: number;
      reassemblyTimeoutMs?: number;
      retryPollMs?: number;
      autoAckFragments?: boolean;
    },
  ) {
    this.messageIds = new BushMeshMessageIdGenerator(options?.messageIdSeed);
    this.reliability = new BushMeshReliabilityController({
      reassemblyTimeoutMs: options?.reassemblyTimeoutMs,
    });
    this.fragmentRecovery = new BushMeshFragmentCheckpointRuntime(
      getBushMeshPersistentStore() ?? undefined,
    );
    this.retryPollMs = options?.retryPollMs ?? 1000;
    this.autoAckFragments = options?.autoAckFragments ?? true;
  }

  private readonly retryPollMs: number;
  private readonly autoAckFragments: boolean;

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    void this.fragmentRecovery
      .initialize(this.reliability)
      .then(restored => {
        for (const checkpoint of restored) {
          if (this.reliability.retransmissions.isComplete(checkpoint.messageId)) {
            void this.fragmentRecovery.remove(checkpoint.messageId);
            continue;
          }

          this.outboundFragmented.set(checkpoint.messageId, {
            channelIndex: checkpoint.channelIndex,
            transport: checkpoint.transport,
          });
        }

        if (restored.length > 0) {
          this.events.onStatus?.(
            `BushMesh restored ${restored.length} fragmented message recovery job(s).`,
          );
          void this.flushDueRetransmissions();
        }
      })
      .catch(error => {
        this.events.onError?.(
          error instanceof Error
            ? `BushMesh fragmented-message recovery failed: ${error.message}`
            : 'BushMesh fragmented-message recovery failed.',
        );
      });

    this.retryTimer = setInterval(() => {
      void this.flushDueRetransmissions();
    }, this.retryPollMs);
    this.events.onStatus?.('BushMesh networking runtime started.');
  }

  stop(): void {
    this.running = false;

    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }

    void this.fragmentRecovery.flush().catch(() => undefined);
    this.transportQueue.cancelPending(
      new Error('BushMesh networking runtime stopped.'),
    );
    this.events.onStatus?.('BushMesh networking runtime stopped.');
  }

  isRunning(): boolean {
    return this.running;
  }

  nextMessageId(): number {
    return this.messageIds.next();
  }

  stats(): BushMeshRuntimeStats {
    return {...this.statsState};
  }

  transportQueueSnapshot(): BushMeshTransportQueueSnapshot {
    return this.transportQueue.snapshot();
  }

  async sendText(
    channelIndex: number,
    text: string,
    options?: {
      messageId?: number;
      priority?: BushMeshPriority;
      ackRequested?: boolean;
      storeAndForward?: boolean;
      ttlHops?: number;
      semantic?: boolean;
      peerPolicy?: BushMeshPeerPolicy;
      maxPayloadBytes?: number;
    },
  ): Promise<BushMeshRuntimeSendResult> {
    const cleanText = text.trim();

    if (!cleanText) {
      throw new Error('BushMesh message is empty.');
    }

    const messageId = options?.messageId ?? this.nextMessageId();
    const maxPayloadBytes = this.maxPayloadBytes(options?.maxPayloadBytes);
    const frames = options?.peerPolicy
      ? prepareBushMeshPeerTextFrames(
          cleanText,
          messageId,
          options.peerPolicy,
          {
            priority: options.priority,
            ackRequested: options.ackRequested,
            storeAndForward: options.storeAndForward,
            ttlHops: options.ttlHops,
            maxPayloadBytes,
          },
        )
      : prepareBushMeshTextFrames(cleanText, messageId, {
          carrier: 'text-safe',
          priority: options?.priority,
          ackRequested: options?.ackRequested,
          storeAndForward: options?.storeAndForward,
          ttlHops: options?.ttlHops,
          semantic: options?.semantic,
          maxPayloadBytes,
        });

    return this.sendPreparedFrames(channelIndex, messageId, frames, 'message');
  }

  async sendWire(
    channelIndex: number,
    wireBytes: number[],
    options?: {
      transport?: BushMeshCarrierMode;
      maxPayloadBytes?: number;
      allowFragmentation?: boolean;
    },
  ): Promise<BushMeshRuntimeSendResult> {
    const decoded = decodeBushMeshWire(wireBytes);
    const messageId = decoded.envelope.messageId;
    const priority = decoded.envelope.priority as BushMeshPriority;
    const frames = prepareBushMeshWireFrames(wireBytes, messageId, {
      carrier: options?.transport ?? 'text-safe',
      priority,
      maxPayloadBytes: this.maxPayloadBytes(options?.maxPayloadBytes),
      allowFragmentation: options?.allowFragmentation,
    });

    return this.sendPreparedFrames(channelIndex, messageId, frames, 'wire packet');
  }

  /**
   * Accepts a BushMesh payload extracted by a hardware/link adapter. The core
   * runtime does not parse MeshCore, BLE, serial, or any other vendor framing.
   */
  async acceptFrame(
    frame: BushMeshInboundTransportFrame,
    now = Date.now(),
  ): Promise<boolean> {
    const inbound = decodeBushMeshInboundTransportFrame(frame);

    if (!inbound) {
      this.statsState.ignoredFrames += 1;
      this.emitStats();
      return false;
    }

    this.statsState.receivedFrames += 1;

    try {
      const isFragmentAck =
        inbound.decoded.envelope.type === BushMeshPacketType.Ack &&
        inbound.decoded.envelope.compression === BushMeshCompressionProfile.Raw;

      if (isFragmentAck) {
        const ack = this.reliability.acceptAckWire(
          inbound.decoded.wireBytes,
        );
        this.statsState.ackFramesReceived += 1;

        void this.fragmentRecovery
          .applyAcknowledgement(
            ack.messageId,
            ack.receivedFragments,
            ack.missingFragments,
          )
          .catch(error => {
            this.events.onError?.(
              error instanceof Error
                ? `BushMesh fragment checkpoint update failed: ${error.message}`
                : 'BushMesh fragment checkpoint update failed.',
            );
          });

        if (this.reliability.retransmissions.isComplete(ack.messageId)) {
          this.outboundFragmented.delete(ack.messageId);
        }

        this.events.onAck?.(ack.messageId, ack.missingFragments);
        this.events.onStatus?.(
          ack.missingFragments.length === 0
            ? `BushMesh message ${ack.messageId} fully acknowledged.`
            : `BushMesh message ${ack.messageId} missing ${ack.missingFragments.length} fragment(s).`,
        );
        this.emitStats();
        return true;
      }

      const received = this.reliability.acceptIncomingWire(
        inbound.decoded.wireBytes,
        now,
      );

      if (received.ackWireBytes && this.autoAckFragments) {
        await this.sendWireBytes(
          inbound.channelIndex,
          received.ackWireBytes,
          inbound.carrier ?? 'text-safe',
        );
        this.statsState.ackFramesSent += 1;
      }

      if (received.receive.complete && received.receive.decoded) {
        const decoded = received.receive.decoded;
        const typed = decodeBushMeshTypedPacket(decoded.wireBytes);
        this.statsState.receivedMessages += 1;
        this.events.onMessage?.({
          channelIndex: inbound.channelIndex,
          decoded,
          typed,
        });
      }

      this.emitStats();
      return true;
    } catch (error) {
      this.statsState.decodeErrors += 1;
      this.emitStats();
      this.events.onError?.(
        error instanceof Error
          ? `BushMesh frame decode failed: ${error.message}`
          : 'BushMesh frame decode failed.',
      );
      return false;
    }
  }

  async flushDueRetransmissions(now = Date.now()): Promise<number> {
    if (this.retryFlushInProgress) {
      return 0;
    }

    const due = this.reliability.dueRetransmissions(now);

    if (due.length === 0) {
      return 0;
    }

    this.retryFlushInProgress = true;
    let sent = 0;

    try {
      for (const retry of due) {
        const outbound = this.outboundFragmented.get(retry.messageId);

        if (!outbound) {
          continue;
        }

        try {
          await this.sendWireBytes(
            outbound.channelIndex,
            retry.bytes,
            outbound.transport,
          );
          this.reliability.markFragmentSent(
            retry.messageId,
            retry.fragmentIndex,
            now,
          );
          sent += 1;
          this.statsState.retransmittedFrames += 1;
        } catch (error) {
          this.events.onError?.(
            error instanceof Error
              ? `BushMesh retransmission failed: ${error.message}`
              : 'BushMesh retransmission failed.',
          );
        }
      }
    } finally {
      this.retryFlushInProgress = false;
      this.emitStats();
    }

    return sent;
  }

  cancelMessage(messageId: number): boolean {
    this.outboundFragmented.delete(messageId);
    void this.fragmentRecovery.remove(messageId);
    return this.reliability.cancel(messageId);
  }

  private async sendPreparedFrames(
    channelIndex: number,
    messageId: number,
    frames: BushMeshPreparedTransportFrame[],
    label: string,
  ): Promise<BushMeshRuntimeSendResult> {
    const fragmented = frames.some(frame => frame.fragmented);

    if (fragmented) {
      const transport = frames[0]?.carrier ?? 'text-safe';
      this.reliability.registerOutgoingFragments(
        messageId,
        frames.map(frame => frame.wireBytes),
      );
      this.outboundFragmented.set(messageId, {
        channelIndex,
        transport,
      });

      try {
        await this.fragmentRecovery.register(
          messageId,
          channelIndex,
          transport,
          frames.map(frame => frame.wireBytes),
        );
      } catch (error) {
        this.events.onError?.(
          error instanceof Error
            ? `BushMesh fragment checkpoint save failed: ${error.message}`
            : 'BushMesh fragment checkpoint save failed.',
        );
      }
    }

    for (let index = 0; index < frames.length; index += 1) {
      await this.sendPreparedFrame(channelIndex, frames[index]);

      if (fragmented) {
        this.reliability.markFragmentSent(messageId, index);
      }
    }

    this.statsState.sentMessages += 1;
    this.statsState.sentFrames += frames.length;
    this.emitStats();

    const transport = frames[0]?.carrier ?? 'text-safe';
    this.events.onStatus?.(
      `BushMesh ${label} ${messageId} sent as ${frames.length} ${transport} frame(s).`,
    );

    return {
      messageId,
      frameCount: frames.length,
      fragmented,
      transport,
    };
  }

  private async sendPreparedFrame(
    channelIndex: number,
    frame: BushMeshPreparedTransportFrame,
  ): Promise<void> {
    const priority = decodeBushMeshWire(frame.wireBytes).envelope.priority;

    await this.transportQueue.enqueue(priority, async () => {
      if (frame.carrier === 'binary') {
        if (!this.transport.sendBinaryChannelPayload) {
          throw new Error('Binary BushMesh transport is not available.');
        }

        await this.transport.sendBinaryChannelPayload(
          channelIndex,
          frame.payloadBytes,
        );
        return;
      }

      if (!frame.text) {
        throw new Error('Text-safe BushMesh frame is missing carrier text.');
      }

      await this.transport.sendTextChannelMessage(channelIndex, frame.text);
    });
  }

  private async sendWireBytes(
    channelIndex: number,
    wireBytes: number[],
    transport: BushMeshCarrierMode,
  ): Promise<void> {
    const priority = decodeBushMeshWire(wireBytes).envelope.priority;

    await this.transportQueue.enqueue(priority, async () => {
      if (transport === 'binary' && this.transport.sendBinaryChannelPayload) {
        await this.transport.sendBinaryChannelPayload(channelIndex, wireBytes);
        return;
      }

      await this.transport.sendTextChannelMessage(
        channelIndex,
        encodeBushMeshTextCarrier(wireBytes),
      );
    });
  }

  private maxPayloadBytes(override?: number): number {
    const value =
      override ??
      this.transport.maxPayloadBytes ??
      LEGACY_DEFAULT_MAX_PAYLOAD_BYTES;

    if (!Number.isInteger(value) || value < 1) {
      throw new Error('BushMesh transport payload limit must be a positive integer.');
    }

    return value;
  }

  private emitStats(): void {
    this.events.onStats?.(this.stats());
  }
}
