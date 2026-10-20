import {
  BushMeshControlledFloodForwarder,
  BushMeshFileContentType,
  BushMeshNodeHello,
  BushMeshPriority,
  BushMeshSyncFrameKind,
  BushMeshTypedPacket,
  CompactLocation,
  decodeBushMeshTypedPacket,
  decodeBushMeshWire,
  encodeBushMeshFileWire,
  encodeBushMeshNodeHelloWire,
  encodeBushMeshRoutedWire,
  encodeBushMeshTextMessage,
  encodeTextForBushMeshPeer,
} from '../protocol';
import {
  BushMeshNetworkRuntime,
  BushMeshNetworkRuntimeEvents,
  BushMeshRuntimeReceivedMessage,
  BushMeshRuntimeSendResult,
  BushMeshRuntimeTransport,
} from './BushMeshNetworkRuntime';
import {
  BushMeshCommandResponder,
  BushMeshLocationSnapshot,
} from './BushMeshCommandResponder';
import {renderBushMeshReceivedMessage} from './BushMeshDisplay';
import {
  BushMeshFileManagerResult,
  BushMeshIncomingFile,
} from './BushMeshFileTransferManager';
import {createBushMeshNodeHelloFromPublicKey} from './BushMeshIdentity';
import {subscribeMeshCorePublicKey} from './BushMeshIdentityHub';
import {
  publishBushMeshDistressAlert,
  publishBushMeshPeerLocation,
} from './BushMeshLiveStateHub';
import {BushMeshPeerRegistry} from './BushMeshPeerRegistry';
import {BushMeshPersistentFileTransferManager} from './BushMeshPersistentFileTransferManager';
import {getBushMeshPersistentStore} from './BushMeshPersistentStore';
import {getBushMeshSyncManager} from './BushMeshSyncHub';

export type BushMeshNodeRuntimeEvents = BushMeshNetworkRuntimeEvents & {
  onPeerHello?: (hello: BushMeshNodeHello) => void;
  onTypedPacket?: (packet: BushMeshTypedPacket, channelIndex: number) => void;
  onAutomaticResponse?: (kind: string, channelIndex: number) => void;
  onFileProgress?: (result: BushMeshFileManagerResult, channelIndex: number) => void;
  onFileComplete?: (file: BushMeshIncomingFile, channelIndex: number) => void;
  onForwarded?: (
    sourceNodeId: number,
    messageId: number,
    channelIndex: number,
    nextTtlHops: number,
  ) => void;
};

type RoutedDeliveryContext = {
  replyNodeId: number;
};

export class BushMeshNodeRuntime {
  readonly network: BushMeshNetworkRuntime;
  readonly sync = getBushMeshSyncManager();
  readonly files: BushMeshPersistentFileTransferManager;

  private peerRegistryState: BushMeshPeerRegistry | null = null;
  private responder: BushMeshCommandResponder | null = null;
  private localHelloState: BushMeshNodeHello | null = null;
  private latestLocation: BushMeshLocationSnapshot | null = null;
  private identityUnsubscribe: (() => void) | null = null;
  private forwarder = new BushMeshControlledFloodForwarder();
  private readonly forwardTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly resumedFileTransfers = new Set<number>();
  private fileResumeInProgress = false;
  private discoveryChannelIndex: number | null = null;
  private discoveryIntervalMs = 5 * 60 * 1000;
  private discoveryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly transport: BushMeshRuntimeTransport,
    private readonly events: BushMeshNodeRuntimeEvents = {},
    options?: {
      messageIdSeed?: number;
      reassemblyTimeoutMs?: number;
      retryPollMs?: number;
      autoAckFragments?: boolean;
      allowExperimentalBinary?: boolean;
    },
  ) {
    this.allowExperimentalBinary = options?.allowExperimentalBinary ?? false;
    this.files = new BushMeshPersistentFileTransferManager(
      getBushMeshPersistentStore() ?? undefined,
    );
    this.network = new BushMeshNetworkRuntime(
      transport,
      {
        onStatus: events.onStatus,
        onError: events.onError,
        onAck: events.onAck,
        onStats: events.onStats,
        onMessage: message => {
          void this.handleReceivedMessage(message);
        },
      },
      options,
    );
  }

  private readonly allowExperimentalBinary: boolean;

  start(): void {
    if (!this.identityUnsubscribe) {
      this.identityUnsubscribe = subscribeMeshCorePublicKey(publicKey => {
        const hello = createBushMeshNodeHelloFromPublicKey(publicKey);

        if (hello.nodeId !== this.localHelloState?.nodeId) {
          this.configureLocalNode(hello);
        }
      });
    }

    this.network.start();
    void this.files
      .initialize()
      .then(({outgoingTransferIds, incomingTransferIds}) => {
        if (outgoingTransferIds.length > 0 || incomingTransferIds.length > 0) {
          this.events.onStatus?.(
            `BushMesh restored ${outgoingTransferIds.length} outgoing and ${incomingTransferIds.length} incoming file transfer(s).`,
          );
        }

        if (this.discoveryChannelIndex !== null) {
          void this.resumePersistentFileTransfers(this.discoveryChannelIndex);
        }
      })
      .catch(error => {
        this.events.onError?.(
          error instanceof Error
            ? `BushMesh file recovery failed: ${error.message}`
            : 'BushMesh file recovery failed.',
        );
      });
    this.armDiscovery(true);
  }

  stop(): void {
    this.network.stop();
    this.identityUnsubscribe?.();
    this.identityUnsubscribe = null;
    this.clearDiscoveryTimer();
    void this.files.flushPersistence().catch(() => undefined);

    for (const timer of this.forwardTimers) {
      clearTimeout(timer);
    }
    this.forwardTimers.clear();
  }

  isRunning(): boolean {
    return this.network.isRunning();
  }

  configureLocalNode(hello: BushMeshNodeHello): void {
    if (
      this.localHelloState?.nodeId === hello.nodeId &&
      this.localHelloState.capabilities === hello.capabilities &&
      this.localHelloState.dictionaryVersion === hello.dictionaryVersion
    ) {
      this.localHelloState = {...hello};
      this.armDiscovery(false);
      return;
    }

    this.localHelloState = {...hello};
    this.peerRegistryState = new BushMeshPeerRegistry(hello, {
      allowExperimentalBinary: this.allowExperimentalBinary,
    });
    this.forwarder = new BushMeshControlledFloodForwarder();
    this.responder = new BushMeshCommandResponder({
      localHello: () => ({...this.requireLocalHello()}),
      currentLocation: () =>
        this.latestLocation
          ? {
              capturedAtMs: this.latestLocation.capturedAtMs,
              location: {...this.latestLocation.location},
            }
          : null,
      syncManager: this.sync,
      nextMessageId: () => this.network.nextMessageId(),
    });
    this.events.onStatus?.(
      `BushMesh local node configured as ${hello.nodeId.toString(16).padStart(8, '0')}.`,
    );
    this.armDiscovery(true);
  }

  localHello(): BushMeshNodeHello | null {
    return this.localHelloState ? {...this.localHelloState} : null;
  }

  peers(): BushMeshPeerRegistry | null {
    return this.peerRegistryState;
  }

  setDiscoveryChannel(
    channelIndex: number | null,
    intervalMs = 5 * 60 * 1000,
  ): void {
    if (
      channelIndex !== null &&
      (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 255)
    ) {
      throw new Error('BushMesh discovery channel must be an integer from 0 to 255.');
    }

    if (!Number.isFinite(intervalMs) || intervalMs < 30 * 1000) {
      throw new Error('BushMesh discovery interval must be at least 30 seconds.');
    }

    this.discoveryChannelIndex = channelIndex;
    this.discoveryIntervalMs = intervalMs;
    this.armDiscovery(true);

    if (channelIndex !== null) {
      void this.resumePersistentFileTransfers(channelIndex);
    }
  }

  setLocation(location: CompactLocation, capturedAtMs = Date.now()): void {
    this.latestLocation = {
      location: {...location},
      capturedAtMs,
    };
  }

  clearLocation(): void {
    this.latestLocation = null;
  }

  async sendText(
    channelIndex: number,
    text: string,
    options?: {
      peerNodeId?: number;
      storeAndForward?: boolean;
      ttlHops?: number;
      ackRequested?: boolean;
    },
  ): Promise<BushMeshRuntimeSendResult> {
    const peerPolicy =
      options?.peerNodeId !== undefined
        ? this.peerRegistryState?.peerPolicy(options.peerNodeId) ?? undefined
        : undefined;

    return this.network.sendText(channelIndex, text, {
      peerPolicy,
      storeAndForward: options?.storeAndForward ?? true,
      ttlHops: options?.ttlHops ?? 4,
      ackRequested: options?.ackRequested ?? true,
      semantic: true,
    });
  }

  async sendRoutedText(
    channelIndex: number,
    destinationNodeId: number | undefined,
    text: string,
    options?: {
      ttlHops?: number;
      priority?: BushMeshPriority;
    },
  ): Promise<BushMeshRuntimeSendResult> {
    const local = this.requireLocalHello();
    const innerMessageId = this.network.nextMessageId();
    const peerPolicy =
      destinationNodeId !== undefined
        ? this.peerRegistryState?.peerPolicy(destinationNodeId) ?? undefined
        : undefined;
    const innerWireBytes =
      peerPolicy?.compatible === true
        ? encodeTextForBushMeshPeer(text, innerMessageId, peerPolicy, {
            priority: options?.priority,
            ackRequested: false,
            storeAndForward: false,
          }).wireBytes
        : encodeBushMeshTextMessage(text, innerMessageId, {
            priority: options?.priority,
            ackRequested: false,
            storeAndForward: false,
            semantic: true,
          }).wireBytes;
    const routedMessageId = this.network.nextMessageId();
    const routedWire = encodeBushMeshRoutedWire(
      {
        sourceNodeId: local.nodeId,
        destinationNodeId,
        innerWireBytes,
      },
      routedMessageId,
      {
        ttlHops: options?.ttlHops ?? 4,
        priority: options?.priority ?? BushMeshPriority.DirectMessage,
      },
    );

    return this.network.sendWire(channelIndex, routedWire);
  }

  async broadcastNodeHello(channelIndex: number): Promise<void> {
    const hello = this.requireLocalHello();
    const wireBytes = encodeBushMeshNodeHelloWire(
      hello,
      this.network.nextMessageId(),
    );
    await this.sendResponseWire(channelIndex, wireBytes);
  }

  async startFileTransfer(
    channelIndex: number,
    data: number[],
    options?: {
      transferId?: number;
      chunkSize?: number;
      contentType?: BushMeshFileContentType | number;
      fileName?: string;
      initialChunkFrames?: number;
    },
  ): Promise<number> {
    const transferId = options?.transferId ?? this.network.nextMessageId();
    await this.files.createOutgoingPersistent(transferId, data, {
      chunkSize: options?.chunkSize,
      contentType: options?.contentType,
      fileName: options?.fileName,
    });
    this.resumedFileTransfers.add(transferId);
    await this.sendFileBurst(
      channelIndex,
      transferId,
      options?.initialChunkFrames ?? 8,
    );
    return transferId;
  }

  async sendFileBurst(
    channelIndex: number,
    transferId: number,
    maxChunkFrames = 8,
  ): Promise<number> {
    const fileFrames = this.files.outgoingFrames(transferId, maxChunkFrames);

    for (const fileFrame of fileFrames) {
      const wireBytes = encodeBushMeshFileWire(
        fileFrame,
        this.network.nextMessageId(),
      );
      await this.sendResponseWire(channelIndex, wireBytes);
    }

    await this.files.recordOutgoingProgress(transferId).catch(error => {
      this.events.onError?.(
        error instanceof Error
          ? `BushMesh file checkpoint update failed: ${error.message}`
          : 'BushMesh file checkpoint update failed.',
      );
    });

    return fileFrames.length;
  }

  private async handleReceivedMessage(
    message: BushMeshRuntimeReceivedMessage,
  ): Promise<void> {
    if (message.typed.kind === 'routed') {
      await this.handleRoutedMessage(message);
      return;
    }

    await this.handleLocalMessage(message);
  }

  private async handleRoutedMessage(
    message: BushMeshRuntimeReceivedMessage,
  ): Promise<void> {
    const local = this.localHelloState;

    if (!local || message.typed.kind !== 'routed') {
      this.events.onTypedPacket?.(message.typed, message.channelIndex);
      this.events.onMessage?.(message);
      return;
    }

    const routed = message.typed.value;
    const ttlHops = message.decoded.envelope.ttlHops ?? 0;
    const decision = this.forwarder.evaluate({
      sourceNodeId: routed.sourceNodeId,
      messageId: message.decoded.envelope.messageId,
      localNodeId: local.nodeId,
      destinationNodeId: routed.destinationNodeId,
      ttlHops,
    });

    if (decision.deliverLocally) {
      try {
        const innerDecoded = decodeBushMeshWire(routed.innerWireBytes);
        const innerTyped = decodeBushMeshTypedPacket(routed.innerWireBytes);

        if (innerTyped.kind === 'routed') {
          throw new Error('Nested routed BushMesh packets are not allowed.');
        }

        await this.handleLocalMessage(
          {
            channelIndex: message.channelIndex,
            decoded: innerDecoded,
            typed: innerTyped,
          },
          {replyNodeId: routed.sourceNodeId},
        );
      } catch (error) {
        this.events.onError?.(
          error instanceof Error
            ? `Routed BushMesh payload rejected: ${error.message}`
            : 'Routed BushMesh payload rejected.',
        );
      }
    }

    if (!decision.forward) {
      return;
    }

    const forwardedWire = encodeBushMeshRoutedWire(
      {
        sourceNodeId: routed.sourceNodeId,
        destinationNodeId: routed.destinationNodeId,
        innerWireBytes: routed.innerWireBytes,
      },
      message.decoded.envelope.messageId,
      {
        ttlHops: decision.nextTtlHops,
        priority: message.decoded.envelope.priority as BushMeshPriority,
      },
    );

    const timer = setTimeout(() => {
      this.forwardTimers.delete(timer);
      void this.network
        .sendWire(message.channelIndex, forwardedWire)
        .then(() => {
          this.events.onForwarded?.(
            routed.sourceNodeId,
            message.decoded.envelope.messageId,
            message.channelIndex,
            decision.nextTtlHops,
          );
        })
        .catch(error => {
          this.events.onError?.(
            error instanceof Error
              ? `BushMesh forwarding failed: ${error.message}`
              : 'BushMesh forwarding failed.',
          );
        });
    }, decision.jitterMs);
    this.forwardTimers.add(timer);
  }

  private async handleLocalMessage(
    message: BushMeshRuntimeReceivedMessage,
    routedContext?: RoutedDeliveryContext,
  ): Promise<void> {
    const {typed, channelIndex} = message;

    if (typed.kind === 'device-info' && this.peerRegistryState) {
      const localNodeId = this.localHelloState?.nodeId;
      if (typed.value.nodeId !== localNodeId) {
        this.peerRegistryState.upsertHello(typed.value);
        this.events.onPeerHello?.({...typed.value});
      }
    }

    if (routedContext && typed.kind === 'location') {
      publishBushMeshPeerLocation({
        nodeId: routedContext.replyNodeId,
        channelIndex,
        latitude: typed.value.latitude,
        longitude: typed.value.longitude,
        precision: typed.value.precision,
        batteryPercent: typed.value.batteryPercent,
        receivedAt: Date.now(),
      });
    }

    if (routedContext && typed.kind === 'distress') {
      publishBushMeshDistressAlert({
        key: `${routedContext.replyNodeId}:${message.decoded.envelope.messageId}`,
        nodeId: routedContext.replyNodeId,
        channelIndex,
        messageId: message.decoded.envelope.messageId,
        type: typed.value.type,
        latitude: typed.value.location?.latitude,
        longitude: typed.value.location?.longitude,
        precision: typed.value.location?.precision,
        batteryPercent: typed.value.batteryPercent,
        receivedAt: Date.now(),
      });
    }

    if (
      typed.kind === 'sync' &&
      typed.value.kind === BushMeshSyncFrameKind.Summary
    ) {
      this.sync.acceptRemoteSummary(typed.value);
    }

    if (typed.kind === 'file') {
      await this.handleFileFrame(typed.value, channelIndex, routedContext);
    }

    if (!message.decoded.renderedText) {
      const rendered = renderBushMeshReceivedMessage(message);
      if (rendered) {
        message.decoded.renderedText = rendered;
      }
    }

    this.events.onTypedPacket?.(typed, channelIndex);

    if (typed.kind !== 'file') {
      this.events.onMessage?.(message);
    }

    if (!this.responder) {
      return;
    }

    const responses = this.responder.respond(typed);

    for (const response of responses) {
      try {
        await this.sendAutomaticWire(
          channelIndex,
          response.wireBytes,
          routedContext?.replyNodeId,
        );
        this.events.onAutomaticResponse?.(response.kind, channelIndex);
      } catch (error) {
        this.events.onError?.(
          error instanceof Error
            ? `BushMesh automatic ${response.kind} response failed: ${error.message}`
            : `BushMesh automatic ${response.kind} response failed.`,
        );
      }
    }
  }

  private async handleFileFrame(
    fileFrame: number[],
    channelIndex: number,
    routedContext?: RoutedDeliveryContext,
  ): Promise<void> {
    try {
      const result = this.files.acceptFrame(fileFrame);
      this.events.onFileProgress?.(result, channelIndex);

      for (const responseFrame of result.responseFrames) {
        const wireBytes = encodeBushMeshFileWire(
          responseFrame,
          this.network.nextMessageId(),
        );
        await this.sendAutomaticWire(
          channelIndex,
          wireBytes,
          routedContext?.replyNodeId,
        );
      }

      if (result.completedFile) {
        this.events.onFileComplete?.(result.completedFile, channelIndex);
      }
    } catch (error) {
      this.events.onError?.(
        error instanceof Error
          ? `BushMesh file transfer failed: ${error.message}`
          : 'BushMesh file transfer failed.',
      );
    }
  }

  private async sendAutomaticWire(
    channelIndex: number,
    wireBytes: number[],
    destinationNodeId?: number,
  ): Promise<void> {
    if (destinationNodeId === undefined) {
      await this.sendResponseWire(channelIndex, wireBytes);
      return;
    }

    const local = this.requireLocalHello();
    const routedWire = encodeBushMeshRoutedWire(
      {
        sourceNodeId: local.nodeId,
        destinationNodeId,
        innerWireBytes: wireBytes,
      },
      this.network.nextMessageId(),
      {ttlHops: 4, priority: BushMeshPriority.DirectMessage},
    );
    await this.network.sendWire(channelIndex, routedWire);
  }

  private async sendResponseWire(
    channelIndex: number,
    wireBytes: number[],
  ): Promise<void> {
    await this.network.sendWire(channelIndex, wireBytes);
  }

  private async resumePersistentFileTransfers(channelIndex: number): Promise<void> {
    if (this.fileResumeInProgress || !this.network.isRunning()) {
      return;
    }

    this.fileResumeInProgress = true;
    try {
      for (const transferId of this.files.activeOutgoingTransferIds()) {
        if (this.resumedFileTransfers.has(transferId)) {
          continue;
        }

        this.resumedFileTransfers.add(transferId);
        try {
          const sent = await this.sendFileBurst(channelIndex, transferId, 8);
          if (sent > 0) {
            this.events.onStatus?.(
              `BushMesh resumed file transfer ${transferId} with ${sent} frame(s).`,
            );
          }
        } catch (error) {
          this.resumedFileTransfers.delete(transferId);
          this.events.onError?.(
            error instanceof Error
              ? `BushMesh file resume ${transferId} failed: ${error.message}`
              : `BushMesh file resume ${transferId} failed.`,
          );
        }
      }
    } finally {
      this.fileResumeInProgress = false;
    }
  }

  private armDiscovery(sendNow: boolean): void {
    this.clearDiscoveryTimer();

    const channelIndex = this.discoveryChannelIndex;
    const local = this.localHelloState;

    if (!this.network.isRunning() || channelIndex === null || !local) {
      return;
    }

    if (sendNow) {
      void this.broadcastNodeHello(channelIndex).catch(error => {
        this.events.onError?.(
          error instanceof Error
            ? `BushMesh discovery hello failed: ${error.message}`
            : 'BushMesh discovery hello failed.',
        );
      });
    }

    const staggerMs = local.nodeId % 30000;
    this.discoveryTimer = setTimeout(() => {
      this.discoveryTimer = null;
      void this.broadcastNodeHello(channelIndex)
        .catch(error => {
          this.events.onError?.(
            error instanceof Error
              ? `BushMesh discovery heartbeat failed: ${error.message}`
              : 'BushMesh discovery heartbeat failed.',
          );
        })
        .finally(() => {
          this.armDiscovery(false);
        });
    }, this.discoveryIntervalMs + staggerMs);
  }

  private clearDiscoveryTimer(): void {
    if (this.discoveryTimer) {
      clearTimeout(this.discoveryTimer);
      this.discoveryTimer = null;
    }
  }

  private requireLocalHello(): BushMeshNodeHello {
    if (!this.localHelloState) {
      throw new Error('BushMesh local node identity has not been configured.');
    }

    return this.localHelloState;
  }
}
