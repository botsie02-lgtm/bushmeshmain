import {
  BUSHMESH_WIRE_MAGIC,
  BushMeshMessageIdGenerator,
  BushMeshPacketType,
  BushMeshPeerPolicy,
  BushMeshPriority,
  BushMeshReliabilityController,
  BushMeshTypedPacket,
  DecodedBushMeshWireMessage,
  decodeBushMeshTypedPacket,
  encodeBushMeshTextCarrier,
} from '../protocol';
import {
  BushMeshChannelTransport,
  PreparedBushMeshChannelFrame,
  prepareBushMeshPeerTextChannelFrames,
  prepareBushMeshTextChannelFrames,
  tryDecodeBushMeshChannelFrame,
} from '../../meshcore/meshcoreBushMeshBridge';

export type BushMeshRuntimeTransport = {
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
  transport: BushMeshChannelTransport;
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
  transport: BushMeshChannelTransport;
};

export class BushMeshNetworkRuntime {
  private readonly messageIds: BushMeshMessageIdGenerator;
  private readonly reliability: BushMeshReliabilityController;
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
    const frames = options?.peerPolicy
      ? prepareBushMeshPeerTextChannelFrames(
          cleanText,
          messageId,
          options.peerPolicy,
          {
            priority: options.priority,
            ackRequested: options.ackRequested,
            storeAndForward: options.storeAndForward,
            ttlHops: options.ttlHops,
            maxPayloadBytes: options.maxPayloadBytes,
          },
        )
      : prepareBushMeshTextChannelFrames(cleanText, messageId, {
          transport: 'text-safe',
          priority: options?.priority,
          ackRequested: options?.ackRequested,
          storeAndForward: options?.storeAndForward,
          ttlHops: options?.ttlHops,
          semantic: options?.semantic,
          maxPayloadBytes: options?.maxPayloadBytes,
        });

    const fragmented = frames.some(frame => frame.fragmented);

    if (fragmented) {
      this.reliability.registerOutgoingFragments(
        messageId,
        frames.map(frame => frame.wireBytes),
      );
      this.outboundFragmented.set(messageId, {
        channelIndex,
        transport: frames[0]?.transport ?? 'text-safe',
      });
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

    const transport = frames[0]?.transport ?? 'text-safe';
    this.events.onStatus?.(
      `BushMesh message ${messageId} queued as ${frames.length} ${transport} frame(s).`,
    );

    return {
      messageId,
      frameCount: frames.length,
      fragmented,
      transport,
    };
  }

  async acceptMeshCoreFrame(bytes: number[], now = Date.now()): Promise<boolean> {
    const channelFrame = tryDecodeBushMeshChannelFrame(bytes);

    if (!channelFrame) {
      this.statsState.ignoredFrames += 1;
      this.emitStats();
      return false;
    }

    this.statsState.receivedFrames += 1;

    try {
      if (channelFrame.decoded.envelope.type === BushMeshPacketType.Ack) {
        const ack = this.reliability.acceptAckWire(
          channelFrame.decoded.wireBytes,
        );
        this.statsState.ackFramesReceived += 1;

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
        channelFrame.decoded.wireBytes,
        now,
      );

      if (received.ackWireBytes && this.autoAckFragments) {
        const incomingTransport = this.detectIncomingTransport(
          channelFrame.payloadBytes,
        );
        await this.sendWireBytes(
          channelFrame.channelIndex,
          received.ackWireBytes,
          incomingTransport,
        );
        this.statsState.ackFramesSent += 1;
      }

      if (received.receive.complete && received.receive.decoded) {
        const decoded = received.receive.decoded;
        const typed = decodeBushMeshTypedPacket(decoded.wireBytes);
        this.statsState.receivedMessages += 1;
        this.events.onMessage?.({
          channelIndex: channelFrame.channelIndex,
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
    return this.reliability.cancel(messageId);
  }

  private async sendPreparedFrame(
    channelIndex: number,
    frame: PreparedBushMeshChannelFrame,
  ): Promise<void> {
    if (frame.transport === 'binary') {
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
  }

  private async sendWireBytes(
    channelIndex: number,
    wireBytes: number[],
    transport: BushMeshChannelTransport,
  ): Promise<void> {
    if (transport === 'binary' && this.transport.sendBinaryChannelPayload) {
      await this.transport.sendBinaryChannelPayload(channelIndex, wireBytes);
      return;
    }

    await this.transport.sendTextChannelMessage(
      channelIndex,
      encodeBushMeshTextCarrier(wireBytes),
    );
  }

  private detectIncomingTransport(
    payloadBytes: number[],
  ): BushMeshChannelTransport {
    return payloadBytes[0] === BUSHMESH_WIRE_MAGIC[0] &&
      payloadBytes[1] === BUSHMESH_WIRE_MAGIC[1]
      ? 'binary'
      : 'text-safe';
  }

  private emitStats(): void {
    this.events.onStats?.(this.stats());
  }
}
